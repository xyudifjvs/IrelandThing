import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@weatherly/db";
import { type Principal } from "@weatherly/platform";
import { createMatter } from "@weatherly/matters";
import { processReview, listReviews, approveReview } from "../src/service";
import { generateStructured } from "../src/gateway";
const suffix = randomUUID(),
  users: string[] = [],
  matters: string[] = [],
  documents: string[] = [],
  proposals: string[] = [];
let calls = 0;
let duringGeneration: (() => Promise<void>) | undefined;
const statement = "Closing date is October 30, 2026.";
const fake: typeof generateStructured = async <T>(
  input: Parameters<typeof generateStructured<T>>[0],
) => {
  calls++;
  if (duringGeneration) await duringGeneration();
  return {
    data: input.schema.parse({
      summary: "The contract states a closing date.",
      deadlines: [
        {
          label: "Closing",
          date: "2026-10-30",
          sourceQuote: statement,
          page: 1,
          confidence: "high",
          uncertainty: "",
        },
      ],
      facts: [],
      warnings: [],
    }),
    model: "synthetic/contract-model",
    provider: "synthetic-provider",
    usage: { promptTokens: 120, completionTokens: 40, costUsd: null },
  };
};
async function fixture(twoFactorEnabled = false) {
  const id = `review-access-${suffix}-${randomUUID()}`;
  users.push(id);
  await prisma.user.create({
    data: {
      id,
      name: "Synthetic Coordinator",
      email: `${id}@example.test`,
      role: "coordinator",
      emailVerified: true,
      twoFactorEnabled,
    },
  });
  const actor: Principal = {
    id,
    email: `${id}@example.test`,
    name: "Synthetic Coordinator",
    role: "coordinator",
    sessionId: "test",
  };
  const matter = await createMatter(actor, {
    title: "Synthetic review access",
    propertyAddress: "Synthetic Review Lane",
    side: "seller",
    packageCode: "full_listing",
  });
  matters.push(matter.id);
  const document = await prisma.document.create({
    data: {
      matterId: matter.id,
      name: "synthetic-contract.pdf",
      mimeType: "application/pdf",
      visibility: "coordinator",
      createdById: id,
    },
  });
  documents.push(document.id);
  const version = await prisma.documentVersion.create({
    data: {
      documentId: document.id,
      objectKey: `synthetic-review-${randomUUID()}`,
      checksum: "a".repeat(64),
      size: statement.length,
      extractedText: statement,
      pages: [{ page: 1, text: statement }],
      processingStatus: "complete",
      version: 1,
    },
  });
  const proposal = await prisma.aIProposal.create({
    data: {
      matterId: matter.id,
      kind: "contract",
      status: "queued",
      result: {},
      sourceRefs: [
        {
          documentId: document.id,
          versionId: version.id,
          checksum: version.checksum,
        },
      ],
      sourceRevision: matter.revision,
      requestedById: id,
    },
  });
  proposals.push(proposal.id);
  return { actor, matter, document, version, proposal };
}
beforeAll(() => {
  process.env.OPENROUTER_API_KEY = "synthetic-never-used";
  process.env.OPENROUTER_MODEL = "synthetic/contract-model";
  process.env.OPENROUTER_APPROVED_PROVIDERS = "synthetic-provider";
  process.env.OPENROUTER_ZDR_APPROVED = "true";
  process.env.OPENROUTER_ACCOUNT_PRIVACY_VERIFIED = "true";
});
afterAll(async () => {
  await prisma.aIProposal.deleteMany({ where: { id: { in: proposals } } });
  await prisma.document.deleteMany({ where: { id: { in: documents } } });
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: users } } });
  await prisma.matter.deleteMany({ where: { id: { in: matters } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});
describe("document AI worker checks current owner access", () => {
  it("denies a coordinator with a revoked-access audit before invoking the gateway", async () => {
    const f = await fixture(true);
    await prisma.auditEvent.create({
      data: {
        actorId: f.actor.id,
        entityType: "User",
        entityId: f.actor.id,
        action: "identity.access_revoked",
        details: { reason: "Synthetic revoke" },
      },
    });
    const before = calls;
    await expect(
      processReview(f.proposal.id, { generate: fake }),
    ).rejects.toMatchObject({ status: 403, code: "ACCOUNT_REVOKED" });
    expect(calls).toBe(before);
    expect(
      await prisma.aIProposal.findUniqueOrThrow({
        where: { id: f.proposal.id },
      }),
    ).toMatchObject({
      status: "failed",
      result: { errorCode: "ACCOUNT_REVOKED" },
    });
    expect(
      await prisma.auditEvent.count({
        where: { entityId: f.proposal.id, action: "ai.review_access_denied" },
      }),
    ).toBe(1);
  });
  it("denies a requester whose current role is no longer coordinator", async () => {
    const f = await fixture(true);
    await prisma.user.update({
      where: { id: f.actor.id },
      data: { role: "agent" },
    });
    const before = calls;
    await expect(
      processReview(f.proposal.id, { generate: fake }),
    ).rejects.toMatchObject({ status: 403, code: "REVIEW_ACCESS_REVOKED" });
    expect(calls).toBe(before);
  });
  it("allows a coordinator without MFA to process reviews in production", async () => {
    const f = await fixture(false);
    const previousNode = process.env.NODE_ENV,
      previousApp = process.env.APP_ENV;
    vi.stubEnv("NODE_ENV", "production");
    process.env.APP_ENV = "local";
    const before = calls;
    try {
      await processReview(f.proposal.id, { generate: fake });
      expect(calls).toBe(before + 1);
      expect(
        (
          await prisma.aIProposal.findUniqueOrThrow({
            where: { id: f.proposal.id },
          })
        ).status,
      ).toBe("pending");
    } finally {
      vi.stubEnv("NODE_ENV", previousNode);
      process.env.APP_ENV = previousApp;
    }
  });
  it("allows a restored MFA-enabled owner and retains document-only review kind guards", async () => {
    const f = await fixture(true);
    await prisma.auditEvent.create({
      data: {
        actorId: f.actor.id,
        entityType: "User",
        entityId: f.actor.id,
        action: "identity.access_revoked",
        createdAt: new Date(Date.now() - 10000),
      },
    });
    await prisma.auditEvent.create({
      data: {
        actorId: f.actor.id,
        entityType: "User",
        entityId: f.actor.id,
        action: "identity.access_restored",
        createdAt: new Date(Date.now() - 5000),
      },
    });
    const previous = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");
    const before = calls;
    try {
      await processReview(f.proposal.id, { generate: fake });
    } finally {
      vi.stubEnv("NODE_ENV", previous);
    }
    expect(calls).toBe(before + 1);
    const result = await prisma.aIProposal.findUniqueOrThrow({
      where: { id: f.proposal.id },
    });
    expect(result.status).toBe("pending");
    expect(result.tokenUsage).toEqual({
      promptTokens: 120,
      completionTokens: 40,
      costUsd: null,
    });
    const email = await prisma.aIProposal.create({
      data: {
        matterId: f.matter.id,
        kind: "email_draft",
        status: "pending",
        result: {},
        sourceRefs: [],
        sourceRevision: f.matter.revision,
        requestedById: f.actor.id,
      },
    });
    proposals.push(email.id);
    expect(
      (await listReviews(f.actor)).every((r) => r.kind === "contract"),
    ).toBe(true);
    await expect(
      approveReview(f.actor, email.id, {
        revision: f.matter.revision,
        changes: { deadlines: [] },
      }),
    ).rejects.toMatchObject({ code: "REVIEW_KIND_MISMATCH" });
    await prisma.aIProposal.update({
      where: { id: email.id },
      data: { status: "queued" },
    });
    await expect(
      processReview(email.id, { generate: fake }),
    ).rejects.toMatchObject({ code: "REVIEW_KIND_MISMATCH" });
    expect(calls).toBe(before + 1);
  });
  it("discards a result if access is revoked during inference and preserves usage evidence", async () => {
    const f = await fixture(true);
    duringGeneration = async () => {
      await prisma.auditEvent.create({
        data: {
          actorId: f.actor.id,
          entityType: "User",
          entityId: f.actor.id,
          action: "identity.access_revoked",
        },
      });
    };
    try {
      await expect(
        processReview(f.proposal.id, { generate: fake }),
      ).rejects.toMatchObject({ code: "ACCOUNT_REVOKED" });
    } finally {
      duringGeneration = undefined;
    }
    const result = await prisma.aIProposal.findUniqueOrThrow({
      where: { id: f.proposal.id },
    });
    expect(result.status).toBe("failed");
    expect(result.tokenUsage).toEqual({
      promptTokens: 120,
      completionTokens: 40,
      costUsd: null,
    });
    expect(
      await prisma.deadline.count({
        where: { matterId: f.matter.id, status: "confirmed" },
      }),
    ).toBe(0);
  });
});
