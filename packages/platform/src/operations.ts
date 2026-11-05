import { Router } from "express";
import { prisma, Prisma } from "@weatherly/db";
import {
  asyncHandler,
  principal,
  assertCoordinator,
  type Principal,
} from "./index";

export async function operationStatus(actor: Principal, now = new Date()) {
  assertCoordinator(actor);
  const [
    heartbeat,
    failed,
    overdue,
    expiredLeases,
    unreviewed,
    connections,
    recentFailures,
  ] = await Promise.all([
    prisma.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" } }),
    prisma.outboxJob.count({ where: { state: "failed" } }),
    prisma.outboxJob.count({
      where: {
        state: "pending",
        availableAt: { lt: new Date(now.valueOf() - 15 * 60000) },
      },
    }),
    prisma.outboxJob.count({
      where: { state: "running", leaseUntil: { lt: now } },
    }),
    prisma.inquiry.count({ where: { status: "new" } }),
    prisma.integrationConnection.findMany({
      where: { ownerId: actor.id },
      select: { provider: true, status: true, lastSyncedAt: true },
    }),
    prisma.outboxJob.findMany({
      where: { state: "failed" },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        topic: true,
        state: true,
        attempts: true,
        error: true,
        updatedAt: true,
      },
    }),
  ]);
  return {
    checkedAt: now.toISOString(),
    worker: {
      status: !heartbeat
        ? "unseen"
        : now.valueOf() - heartbeat.lastSeenAt.valueOf() < 180000
          ? "healthy"
          : "stale",
      lastSeenAt: heartbeat?.lastSeenAt.toISOString() || null,
    },
    jobs: { failed, overdue, expiredLeases },
    inquiries: { unreviewed },
    integrations: connections.map((connection) => ({
      ...connection,
      stale:
        connection.status === "connected" &&
        (!connection.lastSyncedAt ||
          now.valueOf() - connection.lastSyncedAt.valueOf() > 24 * 60 * 60000),
    })),
    // Only machine error codes may leave the queue; never expose job payloads or provider text.
    recentFailures: recentFailures.map((job) => ({
      ...job,
      error:
        job.error && /^[A-Z][A-Z0-9_]{0,79}$/.test(job.error)
          ? job.error
          : "JOB_FAILED",
    })),
  };
}

/** Business-wide counts use the database, not the first page of matter records.
 * The optional transaction permits consistent composition and isolated tests. */
export async function portfolioStatus(
  actor: Principal,
  now = new Date(),
  db?: Prisma.TransactionClient,
) {
  assertCoordinator(actor);
  const read = async (tx: Prisma.TransactionClient) => {
    const inactive = ["closed", "terminated", "archived"];
    const [
      total,
      open,
      pendingReview,
      unresolvedDates,
      emailStates,
      inboxReview,
      failedSendJobs,
      unpaid,
    ] = await Promise.all([
      tx.matter.count(),
      tx.matter.count({ where: { stage: { notIn: inactive } } }),
      tx.matter.count({
        where: {
          stage: { notIn: inactive },
          OR: [
            { stage: "pending_review" },
            { details: { path: ["fileReview", "status"], equals: "pending" } },
          ],
        },
      }),
      tx.task.count({
        where: {
          kind: "unresolved_date",
          status: { notIn: ["completed", "signed", "not_applicable"] },
          matter: { stage: { notIn: inactive } },
        },
      }),
      tx.emailDraft.groupBy({ by: ["status"], _count: { _all: true } }),
      tx.emailThread.count({
        where: { status: { in: ["unassigned", "review_required"] } },
      }),
      tx.outboxJob.count({ where: { topic: "gmail.send", state: "failed" } }),
      tx.$queryRaw<
        { count: bigint }[]
      >`SELECT COUNT(*) AS count FROM "PaymentOrder" p JOIN "Matter" m ON m."id"=p."matterId" WHERE p."kind"='service' AND p."status" IN ('creating','pending','failed') AND m."stage" <> 'terminated'`,
    ]);
    const count = (...statuses: string[]) =>
      emailStates
        .filter((row) => statuses.includes(row.status))
        .reduce((sum, row) => sum + row._count._all, 0);
    return {
      checkedAt: now.toISOString(),
      scope: "all_transactions" as const,
      transactions: { total, active: open - pendingReview, pendingReview },
      tasks: { unresolvedDates },
      email: {
        draft: count("draft"),
        queued: count("queued", "sending"),
        failed: count("failed"),
        deliveryUnknown: count("delivery_unknown"),
        inboxReview,
        failedSendJobs,
      },
      servicePayments: { unpaidOrders: Number(unpaid[0]?.count || 0) },
    };
  };
  return db
    ? read(db)
    : prisma.$transaction(read, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
}

export function createOperationsRouter() {
  const router = Router();
  router.get(
    "/portfolio",
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "private, no-store");
      res.json(await portfolioStatus(principal(req)));
    }),
  );
  router.get(
    "/",
    asyncHandler(async (req, res) =>
      res.json(await operationStatus(principal(req))),
    ),
  );
  return router;
}
