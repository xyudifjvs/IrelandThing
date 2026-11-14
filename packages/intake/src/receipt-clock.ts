import type { Prisma } from "@weatherly/db";

const receiptWindowLock = 1547291368;

export async function intakeDatabaseClock(db: Prisma.TransactionClient) {
  const [{ now }] = await db.$queryRaw<{ now: Date }[]>`
    SELECT date_trunc('milliseconds', clock_timestamp()) AS now
  `;
  return now;
}

export async function intakeReceiptTime(tx: Prisma.TransactionClient) {
  // Concurrent submissions can proceed. The digest's exclusive lock waits
  // for every receipt already stamped in an open transaction to commit.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${receiptWindowLock})`;
  return intakeDatabaseClock(tx);
}

export async function lockIntakeReceiptWindow(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${receiptWindowLock})`;
}
