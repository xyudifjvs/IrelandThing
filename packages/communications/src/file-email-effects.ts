import type { Prisma } from "@weatherly/db";

export async function invalidateFileEmailWork(
  tx: Prisma.TransactionClient,
  matterId: string,
  action: "close_out" | "terminate" | "delete",
) {
  const drafts = await tx.emailDraft.findMany({
    where: { matterId },
    select: { id: true, sendKey: true, status: true },
  });
  const cancellable = drafts.filter(({ status }) =>
    ["draft", "queued"].includes(status),
  );
  const sendKeys = (action === "delete" ? drafts : cancellable).flatMap(
    ({ sendKey }) => (sendKey ? [sendKey] : []),
  );
  if (sendKeys.length)
    await tx.outboxJob.updateMany({
      where: {
        topic: "gmail.send",
        idempotencyKey: { in: sendKeys },
        state: { in: ["pending", "running"] },
      },
      data: { state: "cancelled", lockedBy: null, leaseUntil: null },
    });
  await tx.emailWork.updateMany({
    where: {
      matterId,
      OR: [{ laterAt: { not: null } }, { remindOn: { not: null } }],
    },
    data: { laterAt: null, remindOn: null, revision: { increment: 1 } },
  });
  if (action === "delete") {
    await tx.emailDraft.deleteMany({ where: { matterId } });
    await tx.emailThread.deleteMany({ where: { matterId } });
  } else if (cancellable.length) {
    await tx.emailDraft.updateMany({
      where: {
        id: { in: cancellable.map(({ id }) => id) },
        status: { in: ["draft", "queued"] },
      },
      data: { status: "cancelled", revision: { increment: 1 } },
    });
  }
}
