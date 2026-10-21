import "dotenv/config";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { prisma } from "@weatherly/db";
import {
  createCommunicationsService,
  createCommunicationJobHandlers,
} from "@weatherly/communications";
import { processReview } from "@weatherly/ai";
import { recordIntakeGift } from "@weatherly/billing";
import {
  claimJob,
  executeJob,
  workerIdentity,
  type JobRegistry,
} from "../../../packages/platform/src/jobs";
const id = workerIdentity();
let stopping = false;
let lastPoll = Date.now();
const handlers: JobRegistry = {
  ...createCommunicationJobHandlers(createCommunicationsService()),
  "ai.extract": async (payload) => {
    const input = z.object({ proposalId: z.string() }).parse(payload);
    await processReview(input.proposalId);
  },
  "intake.submitted": async (payload) => {
    const input = z
      .object({ matterId: z.string(), submissionId: z.string() })
      .parse(payload);
    await recordIntakeGift(input.matterId, input.submissionId);
  },
};
const health = createServer(async (req, res) => {
  if (req.url !== "/health") {
    res.writeHead(404).end();
    return;
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    const ok = !stopping && Date.now() - lastPoll < 180000;
    res
      .writeHead(ok ? 200 : 503, { "Content-Type": "application/json" })
      .end(JSON.stringify({ status: ok ? "ok" : "stale" }));
  } catch {
    res.writeHead(503).end('{"status":"unavailable"}');
  }
});
health.listen(
  Number(process.env.WORKER_PORT || 5000),
  process.env.NODE_ENV === "production" ? "::" : "127.0.0.1",
);
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
console.log("Weatherly worker started");
while (!stopping) {
  try {
    const job = await claimJob(id);
    lastPoll = Date.now();
    if (job) await executeJob(id, job, handlers);
    else await delay(1000);
  } catch {
    console.warn("Worker database temporarily unavailable");
    await delay(5000);
  }
}
health.close();
await prisma.$disconnect();
