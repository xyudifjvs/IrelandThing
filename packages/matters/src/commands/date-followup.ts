import type { Prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import { audit } from "../access";

export async function resolveDateFollowup(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
  deadlineId: string,
) {
  const deadline = await tx.deadline.findUnique({ where: { id: deadlineId } });
  if (!deadline || deadline.status !== "confirmed" || !deadline.date) return;
  const done = await tx.task.updateMany({
    where: {
      matterId,
      kind: "unresolved_date",
      details: { path: ["deadlineId"], equals: deadlineId },
      status: { not: "completed" },
    },
    data: { status: "completed", revision: { increment: 1 } },
  });
  const matter = await tx.matter.findUniqueOrThrow({ where: { id: matterId } });
  const details =
    matter.details &&
    typeof matter.details === "object" &&
    !Array.isArray(matter.details)
      ? matter.details
      : {};
  const fileReview =
    details.fileReview &&
    typeof details.fileReview === "object" &&
    !Array.isArray(details.fileReview)
      ? details.fileReview
      : {};
  if (Array.isArray(fileReview.unresolvedDates))
    await tx.matter.update({
      where: { id: matterId },
      data: {
        details: {
          ...details,
          fileReview: {
            ...fileReview,
            unresolvedDates: fileReview.unresolvedDates.filter(
              (item) =>
                !(
                  item &&
                  typeof item === "object" &&
                  !Array.isArray(item) &&
                  item.deadlineId === deadlineId
                ),
            ),
          },
        },
      },
    });
  if (done.count)
    await audit(
      tx,
      actor,
      "deadline.unresolved_followup_resolved",
      "Deadline",
      deadlineId,
      matterId,
      { date: deadline.date, taskCount: done.count },
    );
}
