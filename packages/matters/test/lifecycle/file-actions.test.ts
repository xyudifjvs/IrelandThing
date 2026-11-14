import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import { updateMatter } from "../../src/commands/lifecycle";
import {
  changeFileLifecycle,
  deleteFile,
  previewCloseOut,
  type FileLifecycleEffects,
} from "../../src/commands/file-actions";

function principal(role: Principal["role"]): Principal {
  const id = randomUUID();
  return {
    id,
    role,
    sessionId: id,
    email: `${id}@example.test`,
    name: "Synthetic",
  };
}

const owner = principal("coordinator");
const agent = principal("agent");
const client = principal("client");

beforeAll(async () => {
  await prisma.user.createMany({
    data: [owner, agent, client].map(({ id, email, name, role }) => ({
      id,
      email,
      name,
      role,
    })),
  });
});

function activeMatter() {
  return prisma.matter.create({
    data: {
      title: "Lifecycle test",
      propertyAddress: "10 Example Street",
      side: "seller",
      agentId: agent.id,
      packageCode: "complete",
      stage: "under_contract",
      checklistVersion: 1,
      details: { privateEvidence: "preserved" },
      tasks: {
        create: [
          { stepKey: "closing", title: "Closing", status: "pending" },
          { stepKey: "inspection", title: "Inspection", status: "completed" },
          {
            stepKey: "appraisal",
            title: "Appraisal",
            status: "not_applicable",
          },
          { title: "Legacy follow-up", kind: "intake" },
        ],
      },
    },
  });
}

const effects: FileLifecycleEffects = {
  async onTransition(tx, actor, event) {
    const current = await tx.matter.findUniqueOrThrow({
      where: { id: event.matterId },
    });
    expect(current.stage).toBe(event.stage);
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "test.lifecycle_effect",
        matterId: event.matterId,
        entityId: event.matterId,
        entityType: "Matter",
        details: event,
      },
    });
  },
  async beforeDelete(tx, _actor, { matterId }) {
    const versions = await tx.documentVersion.findMany({
      where: { document: { matterId } },
      select: { objectKey: true },
    });
    await tx.outboxJob.create({
      data: {
        topic: "test.blob_cleanup",
        idempotencyKey: `test-deletion:${matterId}`,
        payload: {
          matterId,
          objectKeys: versions.map(({ objectKey }) => objectKey),
        },
      },
    });
  },
};

describe("explicit file lifecycle", () => {
  it("warns without blocking and serializes close-out, reopening and termination", async () => {
    const matter = await activeMatter();
    await expect(previewCloseOut(agent, matter.id)).rejects.toMatchObject({
      status: 403,
    });
    const preview = await previewCloseOut(owner, matter.id);
    expect(preview).toMatchObject({
      expectedRevision: matter.revision,
      uncheckedItems: [{ title: "Closing" }],
    });
    const close = {
      expectedRevision: preview.expectedRevision,
      action: "close_out",
    };
    await expect(
      changeFileLifecycle(agent, matter.id, close, effects),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      changeFileLifecycle(client, matter.id, close, effects),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateMatter(owner, matter.id, {
        stage: "terminated",
        expectedRevision: matter.revision,
      }),
    ).rejects.toMatchObject({ code: "FILE_ACTION_REQUIRED" });
    await expect(
      changeFileLifecycle(owner, matter.id, close, {
        async onTransition() {
          throw new Error("transactional hook failed");
        },
      }),
    ).rejects.toThrow("transactional hook failed");
    expect(
      (await prisma.matter.findUniqueOrThrow({ where: { id: matter.id } }))
        .stage,
    ).toBe("under_contract");

    const results = await Promise.allSettled([
      changeFileLifecycle(owner, matter.id, close, effects),
      changeFileLifecycle(
        owner,
        matter.id,
        { expectedRevision: matter.revision, action: "terminate" },
        effects,
      ),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ code: "REVISION_CONFLICT" }),
      }),
    ]);
    const winner = results.find((item) => item.status === "fulfilled");
    if (!winner) throw new Error("Expected one lifecycle transition");
    const first = winner.value;
    if (first.stage === "closed")
      expect(first.uncheckedItems).toMatchObject([{ title: "Closing" }]);
    expect(
      await prisma.auditEvent.count({
        where: { matterId: matter.id, action: "test.lifecycle_effect" },
      }),
    ).toBe(1);

    const reopened = await changeFileLifecycle(
      owner,
      matter.id,
      { expectedRevision: first.revision, action: "reopen" },
      effects,
    );
    expect(reopened.stage).toBe("under_contract");
    const terminated = await changeFileLifecycle(
      owner,
      matter.id,
      {
        expectedRevision: reopened.revision,
        action: "terminate",
        reason: "Financing fell through",
      },
      effects,
    );
    expect(terminated.stage).toBe("terminated");
    expect(
      await prisma.matter.findUnique({ where: { id: matter.id } }),
    ).toMatchObject({
      details: {
        privateEvidence: "preserved",
        termination: {
          beforeClosing: true,
          reason: "Financing fell through",
          fromStage: "under_contract",
        },
      },
    });
    expect(
      (
        await changeFileLifecycle(
          owner,
          matter.id,
          { expectedRevision: terminated.revision, action: "reopen" },
          effects,
        )
      ).stage,
    ).toBe("under_contract");
  });

  it("deletes only at the current revision and retains intake and confirmation disposition", async () => {
    const matter = await activeMatter();
    const now = new Date();
    const intake = await prisma.intakeSubmission.create({
      data: {
        matterId: matter.id,
        userId: agent.id,
        draftId: randomUUID(),
        idempotencyKey: randomUUID(),
        snapshot: { source: "immutable" },
        processedAt: now,
        processedById: owner.id,
      },
    });
    const review = await prisma.creationReview.create({
      data: {
        ownerId: owner.id,
        intakeId: intake.id,
        state: "confirmed",
        startRequestId: randomUUID(),
        confirmedMatterId: matter.id,
        confirmedAt: now,
        confirmationRequestId: randomUUID(),
        confirmationFingerprint: "historical fingerprint",
        payload: { facts: { title: "sensitive" } },
      },
    });
    const doc = await prisma.document.create({
      data: {
        matterId: matter.id,
        name: "Original",
        mimeType: "application/pdf",
        createdById: agent.id,
      },
    });
    const key = randomUUID();
    await prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        objectKey: key,
        checksum: "a".repeat(64),
        version: 1,
        size: 1,
      },
    });
    const request = {
      expectedRevision: matter.revision,
      confirmation: "DELETE",
    };
    await expect(
      deleteFile(agent, matter.id, request, effects),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      deleteFile(
        owner,
        matter.id,
        { ...request, confirmation: "delete" },
        effects,
      ),
    ).rejects.toThrow();
    await expect(
      deleteFile(
        owner,
        matter.id,
        { ...request, expectedRevision: matter.revision + 1 },
        effects,
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(
      deleteFile(owner, matter.id, request, {
        async beforeDelete(tx, actor, event) {
          await effects.beforeDelete(tx, actor, event);
          throw new Error("abort cleanup");
        },
      }),
    ).rejects.toThrow("abort cleanup");
    expect(await prisma.matter.count({ where: { id: matter.id } })).toBe(1);
    expect(
      await prisma.outboxJob.count({
        where: { idempotencyKey: `test-deletion:${matter.id}` },
      }),
    ).toBe(0);

    expect(await deleteFile(owner, matter.id, request, effects)).toEqual({
      matterId: matter.id,
      deleted: true,
    });
    expect(await prisma.matter.count({ where: { id: matter.id } })).toBe(0);
    expect(await prisma.task.count({ where: { matterId: matter.id } })).toBe(0);
    expect(await prisma.document.count({ where: { id: doc.id } })).toBe(0);
    expect(
      await prisma.outboxJob.findUnique({
        where: { idempotencyKey: `test-deletion:${matter.id}` },
      }),
    ).toMatchObject({ payload: { objectKeys: [key] } });
    expect(
      await prisma.intakeSubmission.findUnique({ where: { id: intake.id } }),
    ).toMatchObject({
      snapshot: { source: "immutable" },
      deletedAt: expect.any(Date),
      processedAt: now,
    });
    expect(
      await prisma.creationReview.findUnique({ where: { id: review.id } }),
    ).toMatchObject({
      state: "confirmed",
      confirmedMatterId: null,
      confirmationFingerprint: "historical fingerprint",
      payload: { facts: {}, people: [], dates: [] },
    });
    expect(
      await prisma.auditEvent.count({
        where: { matterId: matter.id, action: "matter.deleted" },
      }),
    ).toBe(1);
  });
});
