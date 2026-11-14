import { z } from "zod";
import { prisma } from "@weatherly/db";
import { getDocument } from "@weatherly/documents";
import { requireMatter, audit } from "@weatherly/matters";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import { aiConfigured } from "../gateway";
import { assertLegacyReviewAllowed } from "./compatibility";

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
    const current = await requireMatter(actor, matter.id, true, tx);
    await assertLegacyReviewAllowed(tx, current);
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
        sourceRevision: current.revision,
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
export async function listReviews(actor: Principal, matterId?: string) {
  assertCoordinator(actor);
  return prisma.aIProposal.findMany({
    where: { kind: "contract", ...(matterId ? { matterId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
