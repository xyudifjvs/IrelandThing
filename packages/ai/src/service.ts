import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import { getDocument } from "@weatherly/documents";
import { requireMatter, applyReviewedFacts, audit } from "@weatherly/matters";
import {
  assertCoordinator,
  HttpError,
  type Principal,
  validDate,
} from "@weatherly/platform";
import { aiConfigured, generateStructured } from "./gateway";
import { extractionSchema } from "./contracts";
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
export async function processReview(proposalId: string) {
  const proposal = await prisma.aIProposal.findUniqueOrThrow({
    where: { id: proposalId },
  });
  if (!["queued", "processing"].includes(proposal.status)) return;
  const refs = proposal.sourceRefs as {
    documentId: string;
    versionId: string;
    checksum: string;
  }[];
  const user = await prisma.user.findUnique({
    where: { id: proposal.requestedById },
  });
  if (!user || user.role !== "coordinator")
    throw new Error("Review access revoked");
  const actor: Principal = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: "coordinator",
    sessionId: "worker",
  };
  const document = await getDocument(actor, refs[0].documentId);
  const version = document.versions.find((v) => v.id === refs[0].versionId);
  if (!version?.extractedText || version.checksum !== refs[0].checksum)
    throw new Error("Review source unavailable");
  await prisma.aIProposal.updateMany({
    where: { id: proposalId, status: "queued" },
    data: { status: "processing" },
  });
  const result = await generateStructured({
    purpose: "document_extraction",
    instructions:
      "Extract stated transaction facts and explicitly stated deadline dates. Do not calculate a deadline unless the text explicitly states the resulting date. Dates must be YYYY-MM-DD or null. Every fact/date requires a short exact verbatim quote found in the supplied pages and a matching page number if available. If conflicting amendments or ambiguous dates exist, use null, state uncertainty, and warn the reviewer. Return only supported facts. No legal conclusions.",
    data: {
      name: document.name,
      pages: version.pages,
      text: version.extractedText,
    },
    schema: extractionSchema,
  });
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
  await prisma.aIProposal.updateMany({
    where: { id: proposalId, status: "processing" },
    data: {
      status: "pending",
      result: { ...result.data, deadlines, facts, warnings },
      model: result.model,
      provider: result.provider,
      tokenUsage: result.usage,
    },
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
    const claimed = await tx.aIProposal.updateMany({
      where: { id, status: "pending" },
      data: {
        status: "approved",
        reviewedById: actor.id,
        reviewedAt: new Date(),
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
      { expectedRevision: input.revision, ...input.changes },
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
