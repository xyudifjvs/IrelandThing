import type { Prisma } from "@weatherly/db";
import { HttpError } from "@weatherly/platform";

type ReviewMatter = { id: string; checklistVersion: number | null };
const canonicalCode = "CANONICAL_REVIEW_REQUIRED";

/** Call with the Matter row locked to serialize against creation review. */
export async function hasCanonicalReview(
  tx: Prisma.TransactionClient,
  matter: ReviewMatter,
) {
  return (
    matter.checklistVersion !== null ||
    Boolean(
      await tx.creationReview.findFirst({
        where: { state: "open", intake: { matterId: matter.id } },
        select: { id: true },
      }),
    )
  );
}

export async function assertLegacyReviewAllowed(
  tx: Prisma.TransactionClient,
  matter: ReviewMatter,
) {
  if (await hasCanonicalReview(tx, matter)) {
    throw new HttpError(
      409,
      canonicalCode,
      "Use the creation review or checklist to apply contract terms.",
    );
  }
}

export async function retireLegacyReview(
  tx: Prisma.TransactionClient,
  matter: ReviewMatter,
  proposalId: string,
) {
  if (!(await hasCanonicalReview(tx, matter))) return false;
  await tx.aIProposal.updateMany({
    where: { id: proposalId, status: { in: ["queued", "processing"] } },
    data: { status: "failed", result: { errorCode: canonicalCode } },
  });
  return true;
}
