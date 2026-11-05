import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@weatherly/db";
import { prepareIntakeReview } from "../src/intake-review";
import { processReview } from "../src/service";
import type { generateStructured } from "../src/gateway";
const suffix = randomUUID(),
  ownerId = "prepare-owner-" + suffix,
  agentId = "prepare-agent-" + suffix,
  matterIds: string[] = [];
const originalEnv = Object.fromEntries(
  [
    "OPENROUTER_API_KEY",
    "OPENROUTER_MODEL",
    "OPENROUTER_APPROVED_PROVIDERS",
    "OPENROUTER_ZDR_APPROVED",
    "OPENROUTER_ACCOUNT_PRIVACY_VERIFIED",
    "AI_REVIEW_OWNER_ID",
  ].map((key) => [key, process.env[key]]),
);
beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      {
        id: ownerId,
        name: "Synthetic Ireland",
        email: ownerId + "@example.test",
        role: "coordinator",
      },
      {
        id: agentId,
        name: "Synthetic agent",
        email: agentId + "@example.test",
        role: "agent",
      },
    ],
  });
  process.env.AI_REVIEW_OWNER_ID = ownerId;
});
afterAll(async () => {
  const proposals = await prisma.aIProposal.findMany({
    where: { matterId: { in: matterIds } },
    select: { id: true },
  });
  await prisma.outboxJob.deleteMany({
    where: {
      OR: proposals.map((p) => ({
        payload: { path: ["proposalId"], equals: p.id },
      })),
    },
  });
  await prisma.aIProposal.deleteMany({
    where: { matterId: { in: matterIds } },
  });
  await prisma.intakeSubmission.deleteMany({
    where: { matterId: { in: matterIds } },
  });
  await prisma.intakeDraft.deleteMany({ where: { userId: agentId } });
  await prisma.matter.deleteMany({ where: { id: { in: matterIds } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: ownerId } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, agentId] } } });
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await prisma.$disconnect();
});
async function fixture({
  readable = true,
  document = true,
  dotloop = false,
} = {}) {
  const matter = await prisma.matter.create({
    data: {
      title: "Pending synthetic source review",
      propertyAddress: "42 Source Lane",
      side: "buyer",
      packageCode: "essentials",
      stage: "pending_review",
      agentId,
      details: {},
    },
  });
  matterIds.push(matter.id);
  const doc = document
    ? await prisma.document.create({
        data: {
          matterId: matter.id,
          name: "synthetic.pdf",
          mimeType: "application/pdf",
          createdById: agentId,
          versions: {
            create: {
              version: 1,
              objectKey: "synthetic-" + randomUUID(),
              checksum: "a".repeat(64),
              size: 100,
              extractedText: readable
                ? "Synthetic contract with readable source text."
                : "",
              processingStatus: readable ? "complete" : "needs_ocr",
            },
          },
        },
        include: { versions: true },
      })
    : null;
  await prisma.matter.update({
    where: { id: matter.id },
    data: {
      details: {
        fileReview: { status: "pending" },
        referenceIntake: {
          fields: { docsDotloop: dotloop },
          uploads: { contractDocs: doc ? [doc.id] : [] },
        },
      },
    },
  });
  const draft = await prisma.intakeDraft.create({
    data: { userId: agentId, payload: {} },
  });
  const submission = await prisma.intakeSubmission.create({
    data: {
      draftId: draft.id,
      idempotencyKey: "prepare-" + draft.id,
      userId: agentId,
      matterId: matter.id,
      snapshot: {},
    },
  });
  return { matter, doc, submission };
}
describe("automatic intake source preparation with provider gates", () => {
  it("persists truthful unavailable source metadata and manual follow-up instead of synthetic extraction or a forever queued job", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const f = await fixture();
    const first = await prepareIntakeReview(f.matter.id, f.submission.id);
    const again = await prepareIntakeReview(f.matter.id, f.submission.id);
    expect(again.proposals).toEqual(first.proposals);
    const proposal = await prisma.aIProposal.findUniqueOrThrow({
      where: { id: first.proposals[0].id },
    });
    expect(proposal).toMatchObject({
      status: "unavailable",
      result: {
        availability: "APPROVED_AI_ROUTE_UNAVAILABLE",
        requiresManualReview: true,
      },
      sourceRefs: [{ documentId: f.doc!.id, versionId: f.doc!.versions[0].id }],
    });
    expect(proposal.result).not.toHaveProperty("deadlines");
    expect(
      await prisma.outboxJob.count({
        where: { idempotencyKey: "extract:" + proposal.id },
      }),
    ).toBe(0);
    expect(
      await prisma.task.count({
        where: { matterId: f.matter.id, kind: "manual_review" },
      }),
    ).toBe(1);
  });
  it("queues each readable source once only when the approved route and current coordinator exist; no model is called here", async () => {
    Object.assign(process.env, {
      OPENROUTER_API_KEY: "synthetic-never-called",
      OPENROUTER_MODEL: "synthetic/contract-model",
      OPENROUTER_APPROVED_PROVIDERS: "synthetic-provider",
      OPENROUTER_ZDR_APPROVED: "true",
      OPENROUTER_ACCOUNT_PRIVACY_VERIFIED: "true",
    });
    const f = await fixture();
    const [one, two] = await Promise.all([
      prepareIntakeReview(f.matter.id, f.submission.id),
      prepareIntakeReview(f.matter.id, f.submission.id),
    ]);
    expect(one.proposals).toEqual(two.proposals);
    expect(one.proposals[0].status).toBe("queued");
    expect(
      await prisma.outboxJob.count({
        where: {
          idempotencyKey: "extract:" + one.proposals[0].id,
          topic: "ai.extract",
        },
      }),
    ).toBe(1);
    const fake: typeof generateStructured = async <T>(
      input: Parameters<typeof generateStructured<T>>[0],
    ) => ({
      data: input.schema.parse({
        summary: "Synthetic source prepared",
        deadlines: [],
        facts: [],
        warnings: [],
      }),
      model: "synthetic/contract-model",
      provider: "synthetic-provider",
      usage: { promptTokens: 1, completionTokens: 1, costUsd: null },
    });
    await processReview(one.proposals[0].id, { generate: fake });
    expect(
      (await prepareIntakeReview(f.matter.id, f.submission.id)).proposals[0],
    ).toEqual({ id: one.proposals[0].id, status: "pending" });
    expect(
      await prisma.aIProposal.count({ where: { matterId: f.matter.id } }),
    ).toBe(1);
  });
  it("records unreadable and missing Dotloop source limitations without fetching or claiming document contents", async () => {
    for (const options of [
      { readable: false },
      { document: false, dotloop: true },
    ]) {
      const f = await fixture(options);
      const prepared = await prepareIntakeReview(f.matter.id, f.submission.id);
      const proposal = await prisma.aIProposal.findUniqueOrThrow({
        where: { id: prepared.proposals[0].id },
      });
      expect(proposal.status).toBe("unavailable");
      expect(proposal.result).toMatchObject({
        availability:
          options.document === false
            ? "CONTRACT_RETRIEVAL_REQUIRED"
            : "READABLE_SOURCE_REQUIRED",
      });
      expect(
        await prisma.outboxJob.count({
          where: { idempotencyKey: "extract:" + proposal.id },
        }),
      ).toBe(0);
    }
  });
});
