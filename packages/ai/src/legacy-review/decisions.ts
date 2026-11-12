import { z } from "zod";
import { prisma, type Prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  type Principal,
  validDate,
} from "@weatherly/platform";
import { assertLegacyReviewAllowed } from "./compatibility";
import { requireMatter, recalculateWorkflow, audit } from "@weatherly/matters";
import { factField, type SourceConflict } from "../findings";

export async function resolveReviewConflicts(
  actor: Principal,
  id: string,
  raw: unknown,
) {
  assertCoordinator(actor);
  const input = z
    .object({
      expectedRevision: z.number().int().positive(),
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
        .min(1)
        .max(80),
    })
    .strict()
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    const proposal = await tx.aIProposal.findUniqueOrThrow({ where: { id } });
    if (proposal.kind !== "contract")
      throw new HttpError(
        422,
        "REVIEW_KIND_MISMATCH",
        "Resolve conflicts on a contract source review.",
      );
    if (proposal.status !== "pending")
      throw new HttpError(
        409,
        "REVIEW_NOT_PENDING",
        "Only unresolved pending source conflicts can be corrected.",
      );
    const manualSources = [];
    for (const ref of proposal.sourceRefs as { documentId: string }[]) {
      const version = await tx.documentVersion.findFirst({
        where: { documentId: ref.documentId },
        orderBy: { version: "desc" },
      });
      if (version)
        manualSources.push({
          documentId: ref.documentId,
          versionId: version.id,
          checksum: version.checksum,
        });
    }
    const matter = await requireMatter(actor, proposal.matterId, true, tx);
    await assertLegacyReviewAllowed(tx, matter);
    const result = proposal.result as unknown as {
      conflicts?: SourceConflict[];
    };
    const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
    const resolutions = new Map(
      input.conflictResolutions.map((item) => [item.key, item]),
    );
    if (
      !conflicts.length ||
      resolutions.size !== conflicts.length ||
      resolutions.size !== input.conflictResolutions.length ||
      conflicts.some((conflict) => !resolutions.has(conflict.key))
    )
      throw new HttpError(
        422,
        "SOURCE_CONFLICT_REVIEW_REQUIRED",
        "Choose or correct every conflict saved with this source review.",
      );
    const details =
      matter.details &&
      typeof matter.details === "object" &&
      !Array.isArray(matter.details)
        ? matter.details
        : {};
    const facts =
      details.confirmedFacts &&
      typeof details.confirmedFacts === "object" &&
      !Array.isArray(details.confirmedFacts)
        ? { ...details.confirmedFacts }
        : {};
    for (const conflict of conflicts) {
      const resolution = resolutions.get(conflict.key)!;
      if (conflict.kind === "fact") {
        if (
          !factField.safeParse(conflict.field).success ||
          resolution.value === "omit"
        )
          throw new HttpError(
            422,
            "FACT_VALUE_REQUIRED",
            "Choose or correct the actual recognized fact value.",
          );
        facts[conflict.field] = resolution.value;
      } else if (resolution.value !== "omit") {
        if (!validDate(resolution.value))
          throw new HttpError(
            422,
            "INVALID_DATE",
            "Use a real date or explicitly omit the source proposal.",
          );
        const previous = await tx.deadline.findFirst({
          where: { matterId: matter.id, label: conflict.label },
          orderBy: { createdAt: "desc" },
        });
        const previousDetails =
          previous?.details &&
          typeof previous.details === "object" &&
          !Array.isArray(previous.details)
            ? previous.details
            : {};
        const reviewed = {
          ...previousDetails,
          manualOverride: true,
          conflictProposalId: proposal.id,
          resolutionSourceVersionIds: manualSources.map(
            (source) => source.versionId,
          ),
          reviewedById: actor.id,
          reviewedAt: new Date().toISOString(),
          reason: resolution.reason,
        };
        const date = previous
          ? await tx.deadline.update({
              where: { id: previous.id },
              data: {
                date: resolution.value,
                status: "confirmed",
                details: reviewed,
                revision: { increment: 1 },
              },
            })
          : await tx.deadline.create({
              data: {
                matterId: matter.id,
                label: conflict.label,
                date: resolution.value,
                status: "confirmed",
                details: { ...reviewed, visibility: "coordinator" },
              },
            });
        await audit(
          tx,
          actor,
          "deadline.source_conflict_corrected",
          "Deadline",
          date.id,
          matter.id,
          {
            before: previous ? JSON.parse(JSON.stringify(previous)) : null,
            resolution,
          },
        );
      }
    }
    const markers = Array.isArray(details.sourceConflicts)
      ? details.sourceConflicts
      : [];
    const changed = await tx.matter.updateMany({
      where: { id: matter.id, revision: input.expectedRevision },
      data: {
        details: {
          ...details,
          confirmedFacts: facts,
          sourceConflicts: markers.filter(
            (marker) =>
              !(
                marker &&
                typeof marker === "object" &&
                !Array.isArray(marker) &&
                marker.proposalId === id &&
                typeof marker.key === "string" &&
                resolutions.has(marker.key)
              ),
          ),
        },
        revision: { increment: 1 },
      },
    });
    if (!changed.count)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "The file changed; review the current facts before correcting source conflicts.",
      );
    await recalculateWorkflow(tx, actor, matter.id);
    const saved = await tx.aIProposal.update({
      where: { id },
      data: {
        status: "resolved",
        reviewedById: actor.id,
        reviewedAt: new Date(),
        result: {
          ...(proposal.result as Record<string, Prisma.InputJsonValue>),
          conflictResolutions: input.conflictResolutions,
          manualConflictResolution: true,
          manualResolutionSources: manualSources,
        },
      },
    });
    await audit(
      tx,
      actor,
      "ai.source_conflicts_corrected",
      "AIProposal",
      id,
      matter.id,
      { resolutions: input.conflictResolutions },
    );
    return saved;
  });
}

export async function rejectReview(
  actor: Principal,
  id: string,
  reason: string,
) {
  assertCoordinator(actor);
  z.string().min(1).max(1000).parse(reason);
  return prisma.$transaction(async (tx) => {
    const p = await tx.aIProposal.findUnique({ where: { id } });
    if (!p) throw new HttpError(404, "NOT_FOUND", "Review not found.");
    if (
      Array.isArray((p.result as { conflicts?: unknown }).conflicts) &&
      (p.result as { conflicts: unknown[] }).conflicts.length
    )
      throw new HttpError(
        409,
        "SOURCE_CONFLICT_REVIEW_REQUIRED",
        "Choose or correct the source conflicts before completing this review.",
      );
    const changed = await tx.aIProposal.updateMany({
      where: { id, status: "pending" },
      data: {
        status: "rejected",
        reviewedById: actor.id,
        reviewedAt: new Date(),
      },
    });
    if (!changed.count)
      throw new HttpError(
        409,
        "REVIEW_NOT_PENDING",
        "Only pending reviews can be rejected.",
      );
    await audit(tx, actor, "ai.review_rejected", "AIProposal", id, p.matterId, {
      reason,
    });
    return { id, status: "rejected" };
  });
}
