import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@weatherly/db";
import { HttpError } from "./index";
export type JobHandler = (payload: unknown) => Promise<unknown>;
export type JobRegistry = Record<string, JobHandler>;
export async function claimJob(workerId: string, leaseMs = 120000) {
  const now = new Date();
  const leaseUntil = new Date(now.valueOf() + leaseMs);
  const rows = await prisma.$queryRaw<
    { id: string; topic: string; payload: Prisma.JsonValue; attempts: number }[]
  >`
    UPDATE "OutboxJob" SET state='running', "lockedBy"=${workerId}, "leaseUntil"=${leaseUntil}, attempts=attempts+1,"updatedAt"=${now}
    WHERE id=(SELECT id FROM "OutboxJob" WHERE (state='pending' AND "availableAt"<=${now}) OR (state='running' AND "leaseUntil"<${now}) ORDER BY "availableAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id,topic,payload,attempts`;
  return rows[0] || null;
}
export async function executeJob(
  workerId: string,
  job: NonNullable<Awaited<ReturnType<typeof claimJob>>>,
  handlers: JobRegistry,
) {
  const heartbeat = setInterval(() => {
    void prisma.outboxJob
      .updateMany({
        where: { id: job.id, state: "running", lockedBy: workerId },
        data: { leaseUntil: new Date(Date.now() + 120000) },
      })
      .catch(() => {});
  }, 20000);
  try {
    const handler = handlers[job.topic];
    if (!handler)
      throw new HttpError(
        422,
        "UNKNOWN_JOB",
        "No handler is registered for this job.",
      );
    await handler(job.payload);
    await prisma.outboxJob.updateMany({
      where: { id: job.id, state: "running", lockedBy: workerId },
      data: {
        state: "complete",
        leaseUntil: null,
        lockedBy: null,
        error: null,
        ...(job.topic === "system.email"
          ? { payload: { redacted: true, purpose: "password_reset" } }
          : {}),
      },
    });
  } catch (error) {
    const permanent =
      error instanceof HttpError &&
      error.status < 500 &&
      ![408, 429].includes(error.status);
    const failed = permanent || job.attempts >= 6;
    const code = error instanceof HttpError ? error.code : "JOB_FAILED";
    await prisma.outboxJob.updateMany({
      where: { id: job.id, state: "running", lockedBy: workerId },
      data: {
        state: failed ? "failed" : "pending",
        error: code,
        leaseUntil: null,
        lockedBy: null,
        availableAt: new Date(
          Date.now() + Math.min(3600000, 5000 * 2 ** job.attempts),
        ),
      },
    });
    if (failed && job.topic === "ai.extract") {
      const proposalId = (job.payload as { proposalId?: string }).proposalId;
      if (proposalId)
        await prisma.aIProposal.updateMany({
          where: { id: proposalId, status: { in: ["queued", "processing"] } },
          data: {
            status: "failed",
            result: {
              error:
                "Review could not be completed. Check source readability and the approved route before retrying.",
            },
          },
        });
    }
    console.warn("Worker job requires retry or review", {
      jobId: job.id,
      topic: job.topic,
      code,
      attempts: job.attempts,
      state: failed ? "failed" : "pending",
    });
  } finally {
    clearInterval(heartbeat);
  }
}
export const workerIdentity = () => `worker-${randomUUID()}`;
