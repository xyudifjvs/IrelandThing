import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import { getDocument } from "@weatherly/documents";
import {
  requireMatter,
  applyReviewedFacts,
  recalculateWorkflow,
  audit,
} from "@weatherly/matters";
import {
  assertCoordinator,
  HttpError,
  type Principal,
  validDate,
} from "@weatherly/platform";
import { aiConfigured, generateStructured } from "./gateway";
import { extractionSchema } from "./contracts";
import {
  factField,
  timingFindings,
  findSourceConflicts,
  deadlineKey,
  type SourceConflict,
} from "./findings";
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
export async function requestReview(actor: Principal, raw: unknown) {
  assertCoordinator(actor);
  if (!aiConfigured())
    throw new HttpError(
      503,
      "AI_UNAVAILABLE",
      "Configure an approved OpenRouter ZDR route before requesting a review.",
    );
  const input = z
    .object({ matterId: z.string(), documentId: z.string() })
    .strict()
    .parse(raw);
  const matter = await requireMatter(actor, input.matterId);
  const document = await getDocument(actor, input.documentId);
  if (document.matterId !== matter.id)
    throw new HttpError(
      422,
      "DOCUMENT_MISMATCH",
      "Choose a document from this transaction.",
    );
  const version = document.versions[0];
  if (!version?.extractedText?.trim())
    throw new HttpError(
      422,
      "DOCUMENT_NOT_READABLE",
      "This document has no readable text. Upload a text PDF or DOCX; scanned pages need transcription through the approved route.",
    );
  return prisma.$transaction(async (tx) => {
    const proposal = await tx.aIProposal.create({
      data: {
        matterId: matter.id,
        kind: "contract",
        status: "queued",
        result: {},
        sourceRefs: [
          {
            documentId: document.id,
            versionId: version.id,
            checksum: version.checksum,
          },
        ],
        sourceRevision: matter.revision,
        requestedById: actor.id,
      },
    });
    await tx.outboxJob.create({
      data: {
        topic: "ai.extract",
        payload: { proposalId: proposal.id },
        idempotencyKey: `extract:${proposal.id}`,
      },
    });
    await audit(
      tx,
      actor,
      "ai.review_requested",
      "AIProposal",
      proposal.id,
      matter.id,
      { documentId: document.id, versionId: version.id },
    );
    return proposal;
  });
}
async function currentReviewOwner(
  proposalId: string,
  requestedById: string,
  metadata?: {
    model: string;
    provider: string;
    usage: { promptTokens: number; completionTokens: number };
  },
): Promise<Principal> {
  const user = await prisma.user.findUnique({ where: { id: requestedById } });
  const access = await prisma.auditEvent.findFirst({
    where: {
      entityType: "User",
      entityId: requestedById,
      action: { in: ["identity.access_revoked", "identity.access_restored"] },
    },
    orderBy: { createdAt: "desc" },
  });
  const code =
    !user || user.role !== "coordinator"
      ? "REVIEW_ACCESS_REVOKED"
      : access?.action === "identity.access_revoked"
        ? "ACCOUNT_REVOKED"
        : null;
  if (code) {
    await prisma.$transaction(async (tx) => {
      await tx.aIProposal.updateMany({
        where: { id: proposalId, status: { in: ["queued", "processing"] } },
        data: {
          status: "failed",
          result: { errorCode: code, requiresReview: true },
          ...(metadata
            ? {
                model: metadata.model,
                provider: metadata.provider,
                tokenUsage: metadata.usage,
              }
            : {}),
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: requestedById,
          action: "ai.review_access_denied",
          entityType: "AIProposal",
          entityId: proposalId,
          details: { code },
        },
      });
    });
    throw new HttpError(
      403,
      code,
      "The requesting coordinator no longer satisfies the access requirements for AI processing",
    );
  }
  return {
    id: user!.id,
    email: user!.email,
    name: user!.name,
    role: "coordinator",
    sessionId: "worker",
  };
}
export async function processReview(
  proposalId: string,
  deps: { generate?: typeof generateStructured } = {},
) {
  const proposal = await prisma.aIProposal.findUniqueOrThrow({
    where: { id: proposalId },
  });
  if (!["queued", "processing"].includes(proposal.status)) return;
  if (proposal.kind !== "contract")
    throw new HttpError(
      422,
      "REVIEW_KIND_MISMATCH",
      "Only document proposals may use the document extraction worker",
    );
  const refs = proposal.sourceRefs as {
    documentId: string;
    versionId: string;
    checksum: string;
  }[];
  const actor = await currentReviewOwner(proposalId, proposal.requestedById);
  const document = await getDocument(actor, refs[0].documentId);
  const version = document.versions.find((v) => v.id === refs[0].versionId);
  if (!version?.extractedText || version.checksum !== refs[0].checksum)
    throw new Error("Review source unavailable");
  await prisma.aIProposal.updateMany({
    where: { id: proposalId, status: "queued" },
    data: { status: "processing" },
  });
  await currentReviewOwner(proposalId, proposal.requestedById);
  if (!aiConfigured())
    throw new HttpError(
      503,
      "AI_UNAVAILABLE",
      "An approved OpenRouter ZDR route is required before processing source data",
    );
  const result = await (deps.generate || generateStructured)({
    purpose: "document_extraction",
    instructions:
      "Extract stated transaction facts, explicitly stated deadline dates, and actual contract timing clauses into timingRules. Do not calculate dates yourself. For each X-days-from-anchor clause quote the exact count, direction, day-count definition and anchor date evidence; use unclear/null when the source does not define them. Never supply standard brokerage/state offsets or holiday calendars. Explicit calendar-day calculations and explicitly defined business-day calendars are proposed deterministically later and always require Ireland approval. Report all conflicting names, addresses, prices, dates or amendments as conflicts with each exact quoted alternative; do not select the latest or preferred source. Every fact/date/rule/anchor requires a short exact quote from the supplied source and page if available. No legal conclusions.",
    data: {
      name: document.name,
      pages: version.pages,
      text: version.extractedText,
    },
    schema: extractionSchema,
  });
  await currentReviewOwner(proposalId, proposal.requestedById, result);
  const source = normalize(version.extractedText);
  const warnings = [...result.data.warnings];
  const pages = Array.isArray(version.pages)
    ? (version.pages as { page?: number; text?: string }[])
    : [];
  const sourcePage = (quote: string) => {
    const matches = pages.filter(
      (p) => p.text && normalize(p.text).includes(normalize(quote)),
    );
    return matches.length === 1 ? matches[0].page || null : null;
  };
  const deadlines = result.data.deadlines
    .filter((d) => {
      const valid =
        d.sourceQuote.trim() &&
        source.includes(normalize(d.sourceQuote)) &&
        (!d.date || validDate(d.date));
      if (!valid) warnings.push(`Removed unsupported deadline: ${d.label}`);
      return valid;
    })
    .map((d) => ({
      ...d,
      page: sourcePage(d.sourceQuote),
      sourceDocumentId: document.id,
      sourceVersionId: version.id,
    }));
  const facts = result.data.facts
    .filter(
      (f) => f.sourceQuote.trim() && source.includes(normalize(f.sourceQuote)),
    )
    .map((f) => ({
      ...f,
      page: sourcePage(f.sourceQuote),
      sourceDocumentId: document.id,
      sourceVersionId: version.id,
    }));
  const rules = timingFindings(
    result.data.timingRules || [],
    version.extractedText,
    document.id,
    version.id,
  );
  for (const rule of rules)
    if (rule.proposedDate)
      deadlines.push({
        label: rule.label,
        date: rule.proposedDate,
        sourceQuote: rule.sourceQuote,
        page: sourcePage(rule.sourceQuote),
        confidence: rule.confidence,
        uncertainty: rule.uncertainty || rule.calculationNote,
        sourceDocumentId: document.id,
        sourceVersionId: version.id,
      });
  await prisma.$transaction(async (tx) => {
    const current = await requireMatter(actor, proposal.matterId, true, tx);
    const currentDeadlines = await tx.deadline.findMany({
      where: { matterId: proposal.matterId },
    });
    const conflicts = findSourceConflicts({
      facts,
      deadlines,
      reported: result.data.conflicts || [],
      matter: { ...current, deadlines: currentDeadlines },
      text: version.extractedText!,
      documentId: document.id,
      versionId: version.id,
    });
    const previous =
      current.details &&
      typeof current.details === "object" &&
      !Array.isArray(current.details)
        ? current.details
        : {};
    const markers = Array.isArray(previous.sourceConflicts)
      ? previous.sourceConflicts
      : [];
    const added = conflicts
      .filter(
        (conflict) =>
          !markers.some(
            (marker) =>
              marker &&
              typeof marker === "object" &&
              !Array.isArray(marker) &&
              marker.key === conflict.key &&
              marker.proposalId === proposal.id,
          ),
      )
      .map(({ key, kind, field, label }) => ({
        key,
        kind,
        field,
        label,
        proposalId: proposal.id,
      }));
    let sourceRevision = current.revision;
    if (added.length) {
      const updated = await tx.matter.update({
        where: { id: current.id },
        data: {
          details: { ...previous, sourceConflicts: [...markers, ...added] },
          revision: { increment: 1 },
        },
      });
      sourceRevision = updated.revision;
      await audit(
        tx,
        actor,
        "ai.source_conflicts_flagged",
        "AIProposal",
        proposal.id,
        current.id,
        { keys: added.map((marker) => marker.key) },
      );
    }
    await tx.aIProposal.updateMany({
      where: { id: proposalId, status: "processing" },
      data: {
        status: "pending",
        sourceRevision,
        result: {
          ...(proposal.result as Record<string, Prisma.InputJsonValue>),
          ...result.data,
          deadlines,
          facts,
          timingRules: rules,
          conflicts,
          warnings: [
            ...warnings,
            ...conflicts.map(
              (conflict) =>
                "Source conflict: " +
                conflict.label +
                ". Ireland must choose or correct the value.",
            ),
          ],
        },
        model: result.model,
        provider: result.provider,
        tokenUsage: result.usage,
      },
    });
  });
}
export async function listReviews(actor: Principal) {
  assertCoordinator(actor);
  return prisma.aIProposal.findMany({
    where: { kind: "contract" },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
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
    const current = await requireMatter(actor, proposal.matterId, true, tx);
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
