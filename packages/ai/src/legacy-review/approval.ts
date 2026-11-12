import { z } from "zod";
import { prisma, type Prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  type Principal,
  validDate,
} from "@weatherly/platform";
import { assertLegacyReviewAllowed } from "./compatibility";
import { requireMatter, applyReviewedFacts, audit } from "@weatherly/matters";
import { normalizeEvidenceText as normalize } from "../creation-extraction/evidence";
import { factField, deadlineKey, type SourceConflict } from "../findings";

export async function approveReview(
  actor: Principal,
  id: string,
  raw: unknown,
) {
  assertCoordinator(actor);
  const input = z
    .object({
      revision: z.number().int().positive(),
      changes: z
        .object({
          deadlines: z
            .array(
              z.object({
                label: z.string().min(1).max(200),
                date: z.string().refine(validDate),
                sourceDocumentId: z.string(),
                sourceQuote: z.string().min(1).max(5000),
                overrideManual: z.boolean().optional(),
              }),
            )
            .max(80),
          facts: z
            .array(
              z
                .object({
                  field: factField,
                  value: z.string().min(1).max(5000),
                  sourceDocumentId: z.string(),
                  sourceQuote: z.string().min(1).max(5000),
                })
                .strict(),
            )
            .max(80)
            .default([]),
          conflictResolutions: z
            .array(
              z
                .object({
                  key: z.string().min(1).max(300),
                  value: z.string().min(1).max(5000),
                  reason: z.string().min(1).max(1000),
                })
                .strict(),
            )
            .max(80)
            .default([]),
          reason: z.string().min(1).max(1000).optional(),
        })
        .strict(),
    })
    .strict()
    .parse(raw);
  // This transaction also holds the domain write: a crash cannot apply dates without marking the proposal reviewed.
  return prisma.$transaction(async (tx) => {
    const proposal = await tx.aIProposal.findUnique({ where: { id } });
    if (!proposal) throw new HttpError(404, "NOT_FOUND", "Review not found.");
    if (proposal.kind !== "contract")
      throw new HttpError(
        422,
        "REVIEW_KIND_MISMATCH",
        "Only document reviews can apply contract facts.",
      );
    if (proposal.status !== "pending")
      throw new HttpError(
        409,
        "REVIEW_NOT_PENDING",
        "This review has already been handled or is still processing.",
      );
    if (proposal.sourceRevision !== input.revision)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "Review the current transaction before applying these changes.",
      );
    const current = await requireMatter(actor, proposal.matterId, true, tx);
    await assertLegacyReviewAllowed(tx, current);
    const refs = proposal.sourceRefs as {
      documentId: string;
      versionId: string;
    }[];
    for (const ref of refs) {
      await tx.$queryRaw`SELECT id FROM "Document" WHERE id = ${ref.documentId} FOR UPDATE`;
      const latest = await tx.documentVersion.findFirst({
        where: { documentId: ref.documentId },
        orderBy: { version: "desc" },
      });
      if (latest?.id !== ref.versionId)
        throw new HttpError(
          409,
          "SOURCE_CHANGED",
          "A newer document version exists. Request a fresh review.",
        );
    }
    if (
      input.changes.deadlines.some(
        (d) => !refs.some((r) => r.documentId === d.sourceDocumentId),
      )
    )
      throw new HttpError(
        422,
        "INVALID_SOURCE",
        "Review changes must cite the reviewed document.",
      );
    if (current.revision !== input.revision)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "The transaction changed; review the current source conflicts.",
      );
    const findings = proposal.result as unknown as {
      conflicts?: SourceConflict[];
    };
    const conflicts = Array.isArray(findings.conflicts)
      ? findings.conflicts
      : [];
    const resolutions = new Map(
      input.changes.conflictResolutions.map((item) => [item.key, item]),
    );
    if (resolutions.size !== input.changes.conflictResolutions.length)
      throw new HttpError(
        422,
        "DUPLICATE_RESOLUTION",
        "Choose one resolution per source conflict.",
      );
    for (const conflict of conflicts) {
      const resolution = resolutions.get(conflict.key);
      if (!resolution)
        throw new HttpError(
          409,
          "SOURCE_CONFLICT_REVIEW_REQUIRED",
          "Choose or correct every flagged source conflict and provide a reason.",
        );
      if (conflict.kind === "deadline") {
        const chosen = input.changes.deadlines.filter(
          (d) => deadlineKey(d.label) === conflict.key,
        );
        if (
          resolution.value === "omit"
            ? chosen.length > 0
            : chosen.length !== 1 || chosen[0].date !== resolution.value
        )
          throw new HttpError(
            422,
            "CONFLICT_SELECTION_MISMATCH",
            "The selected deadline must match its explicit source-conflict resolution.",
          );
      } else if (resolution.value === "omit")
        throw new HttpError(
          422,
          "FACT_VALUE_REQUIRED",
          "Choose or correct the actual fact value.",
        );
    }
    for (const resolution of resolutions.values())
      if (!conflicts.some((conflict) => conflict.key === resolution.key))
        throw new HttpError(
          422,
          "UNKNOWN_CONFLICT",
          "Resolve only conflicts saved with this review.",
        );
    const acceptedFacts: Record<string, string> = {};
    for (const fact of input.changes.facts) {
      if (!refs.some((ref) => ref.documentId === fact.sourceDocumentId))
        throw new HttpError(
          422,
          "INVALID_SOURCE",
          "Reviewed facts must cite the reviewed document.",
        );
      const latest = await tx.documentVersion.findFirst({
        where: { documentId: fact.sourceDocumentId },
        orderBy: { version: "desc" },
      });
      if (
        !latest?.extractedText ||
        !normalize(latest.extractedText).includes(normalize(fact.sourceQuote))
      )
        throw new HttpError(
          422,
          "SOURCE_QUOTE_MISMATCH",
          "Fact evidence must match stored document text.",
        );
      if (
        Object.hasOwn(acceptedFacts, fact.field) &&
        acceptedFacts[fact.field] !== fact.value
      )
        throw new HttpError(
          422,
          "SOURCE_CONFLICT_REVIEW_REQUIRED",
          "Choose one value for each fact.",
        );
      acceptedFacts[fact.field] = fact.value;
    }
    for (const conflict of conflicts)
      if (conflict.kind === "fact")
        acceptedFacts[conflict.field] = resolutions.get(conflict.key)!.value;
    const previous =
      current.details &&
      typeof current.details === "object" &&
      !Array.isArray(current.details)
        ? current.details
        : {};
    if (conflicts.length) {
      const markers = Array.isArray(previous.sourceConflicts)
        ? previous.sourceConflicts
        : [];
      await tx.matter.update({
        where: { id: current.id },
        data: {
          details: {
            ...previous,
            sourceConflicts: markers.filter(
              (marker) =>
                !(
                  marker &&
                  typeof marker === "object" &&
                  !Array.isArray(marker) &&
                  marker.proposalId === proposal.id &&
                  typeof marker.key === "string" &&
                  resolutions.has(marker.key)
                ),
            ),
          },
        },
      });
    }
    const claimed = await tx.aIProposal.updateMany({
      where: { id, status: "pending" },
      data: {
        status: "approved",
        reviewedById: actor.id,
        reviewedAt: new Date(),
        result: {
          ...(proposal.result as Record<string, Prisma.InputJsonValue>),
          conflictResolutions: input.changes.conflictResolutions,
          approvedFacts: input.changes.facts,
        },
      },
    });
    if (!claimed.count)
      throw new HttpError(
        409,
        "REVIEW_ALREADY_HANDLED",
        "Another reviewer handled this result.",
      );
    await applyReviewedFacts(
      actor,
      proposal.matterId,
      {
        expectedRevision: input.revision,
        deadlines: input.changes.deadlines,
        ...(Object.keys(acceptedFacts).length ? { facts: acceptedFacts } : {}),
        ...(input.changes.reason ? { reason: input.changes.reason } : {}),
      },
      tx,
    );
    await audit(
      tx,
      actor,
      "ai.review_approved",
      "AIProposal",
      id,
      proposal.matterId,
      { changes: input.changes },
    );
    return tx.aIProposal.findUniqueOrThrow({ where: { id } });
  });
}
/** An explicit coordinator correction can resolve stale-source conflicts without
 * pretending that an old document is the latest reviewed version. */
