import type { Prisma } from "@weatherly/db";
/** Only newly submitted files carry this marker; historical matters are unchanged. */
export function fileReviewPending(matter: {
  stage: string;
  details: Prisma.JsonValue;
}) {
  const details = matter.details as { fileReview?: { status?: string } } | null;
  return (
    matter.stage === "pending_review" ||
    details?.fileReview?.status === "pending"
  );
}
