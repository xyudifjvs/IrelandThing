import { prisma, type Prisma } from "@weatherly/db";
import { getDocument } from "@weatherly/documents";
import { requireMatter, audit } from "@weatherly/matters";
import { HttpError, type Principal, validDate } from "@weatherly/platform";
import { aiConfigured, generateStructured } from "../gateway";
import { extractionSchema } from "../contracts";
import { timingFindings, findSourceConflicts } from "../findings";
import { normalizeEvidenceText as normalize } from "../creation-extraction/evidence";
import { retireLegacyReview } from "./compatibility";

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
  await currentReviewOwner(proposalId, proposal.requestedById);
  const canProcess = await prisma.$transaction(async (tx) => {
    const current = await requireMatter(actor, proposal.matterId, true, tx);
    if (await retireLegacyReview(tx, current, proposal.id)) return false;
    const claimed = await tx.aIProposal.updateMany({
      where: { id: proposal.id, status: { in: ["queued", "processing"] } },
      data: { status: "processing" },
    });
    return claimed.count > 0;
  });
  if (!canProcess) return;
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
    if (await retireLegacyReview(tx, current, proposal.id)) return;
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
