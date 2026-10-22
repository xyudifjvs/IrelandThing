import { Router } from "express";
import { prisma } from "@weatherly/db";
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

export function createOperationsRouter() {
  const router = Router();
  router.get(
    "/",
    asyncHandler(async (req, res) =>
      res.json(await operationStatus(principal(req))),
    ),
  );
  return router;
}
