import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import { applyReviewedFacts } from "@weatherly/matters";
import { confirmFile } from "../../matters/src/commands/file-review";
import {
  createTransactionFromIntake,
  getIntakeSubmission,
  listIntakeSubmissions,
} from "../src/index";
import { deleteIntake } from "../src/delete-intake";
import { deleteFile } from "../../matters/src/commands/file-actions";
import {
  confirmCreationReview,
  type CreationReviewDependencies,
} from "../src/creation-review/confirm";
import {
  changeCreationExtraction,
  readCreationReview,
  saveCreationReview,
  startCreationReview,
} from "../src/creation-review/storage";

const actors = (["coordinator", "coordinator", "agent"] as const).map(
  (role): Principal => {
    const id = randomUUID();
    return {
      id,
      role,
      sessionId: id,
      email: `${id}@example.test`,
      name: "Synthetic",
    };
  },
);
const [owner, outsider, agent] = actors;

beforeAll(async () => {
  await prisma.user.createMany({
    data: actors.map(({ id, email, name, role }) => ({
      id,
      email,
      name,
      role,
    })),
  });
});

const hooks: CreationReviewDependencies = {
  async seedChecklist(tx, matterId, { side }) {
    await tx.matter.update({
      where: { id: matterId },
      data: { checklistVersion: 1 },
    });
    await tx.task.create({
      data: {
        matterId,
        stepKey: "contract",
        dateCapable: false,
        title: `${side} contract`,
      },
    });
  },
  async seedPeople(tx, actor, matterId, people) {
    expect(actor.id).toBe(owner.id);
    if (people.length)
      await tx.matterContact.createMany({
        data: people.map((person) => ({ ...person, matterId })),
      });
  },
  async afterConfirm(tx, actor, matterId) {
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "test.confirmed",
        entityType: "Matter",
        entityId: matterId,
        matterId,
      },
    });
  },
};

const person = {
  role: "client",
  name: "Synthetic Buyer",
  email: "",
  phone: "",
};
function confirmation(revision: number) {
  return {
    requestId: randomUUID(),
    expectedRevision: revision,
    business: { business: "hto", packageCode: "hto_included" },
    facts: {
      title: "Synthetic transaction",
      propertyAddress: "10 Example Street",
      side: "buyer",
      agentId: agent.id,
      agentRosterId: null,
      purchaseType: "cash",
      purchasePriceCents: 12_000_000,
      acceptance: null,
    },
    people: [person],
    dates: [],
  };
}

async function document(input: {
  createdById: string;
  creationReviewId?: string;
  matterId?: string;
}) {
  const doc = await prisma.document.create({
    data: {
      ...input,
      name: "Contract.pdf",
      category: "contract",
      mimeType: "application/pdf",
    },
  });
  const version = await prisma.documentVersion.create({
    data: {
      documentId: doc.id,
      objectKey: randomUUID(),
      checksum: "a".repeat(64),
      version: 1,
      size: 100,
    },
  });
  return { documentId: doc.id, versionId: version.id };
}

describe("creation review", () => {
  it("opens one manual review per request, isolates it by actor and uses revision-checked edits", async () => {
    const request = { requestId: randomUUID() };
    const [first, second] = await Promise.all([
      startCreationReview(owner, request),
      startCreationReview(owner, request),
    ]);
    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({
      state: "open",
      revision: 1,
      intake: null,
      facts: {},
      extraction: { status: "idle" },
    });
    await expect(startCreationReview(agent, request)).rejects.toMatchObject({
      status: 403,
    });
    await expect(startCreationReview(outsider, request)).rejects.toMatchObject({
      status: 409,
    });
    await expect(readCreationReview(outsider, first.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(readCreationReview(agent, first.id)).rejects.toMatchObject({
      status: 403,
    });
    const saved = await saveCreationReview(owner, first.id, {
      expectedRevision: 1,
      facts: { title: "Partial title" },
      people: [person],
    });
    await expect(
      saveCreationReview(owner, first.id, {
        expectedRevision: 1,
        facts: { title: "Stale title" },
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(await readCreationReview(owner, first.id)).toMatchObject({
      revision: saved.revision,
      facts: { title: "Partial title" },
      people: [person],
    });
  });

  it("pins only scoped versions, falls back with the worker offline and invalidates late extraction", async () => {
    const open = await startCreationReview(owner, { requestId: randomUUID() });
    const other = await startCreationReview(outsider, {
      requestId: randomUUID(),
    });
    const unrelated = await document({
      createdById: outsider.id,
      creationReviewId: other.id,
    });
    const pinned = await document({
      createdById: owner.id,
      creationReviewId: open.id,
    });
    await expect(
      saveCreationReview(owner, open.id, {
        expectedRevision: open.revision,
        sources: [unrelated],
      }),
    ).rejects.toMatchObject({ code: "SOURCE_GENERATION_CONFLICT" });
    const saved = await saveCreationReview(owner, open.id, {
      expectedRevision: open.revision,
      sources: [pinned],
      facts: { title: "My saved title" },
    });
    const queued = await changeCreationExtraction(owner, open.id, {
      expectedRevision: saved.revision,
      action: "start",
    });
    expect(queued.extraction.status).toBe("queued");
    const generation = queued.extraction.generation;
    const where = { reviewId_generation: { reviewId: open.id, generation } };
    expect(
      await prisma.outboxJob.findUnique({
        where: { idempotencyKey: `creation-extract:${open.id}:${generation}` },
      }),
    ).toMatchObject({
      topic: "creation.extract",
      payload: { reviewId: open.id, generation },
    });
    await prisma.creationExtraction.update({
      where,
      data: { createdAt: new Date(Date.now() - 61_000) },
    });
    expect((await readCreationReview(owner, open.id)).extraction).toMatchObject(
      {
        generation,
        status: "unavailable",
        reason: "timeout",
        proposal: null,
      },
    );
    const skipped = await changeCreationExtraction(owner, open.id, {
      expectedRevision: queued.revision,
      action: "skip",
    });
    await prisma.creationExtraction.update({
      where,
      data: { status: "proposed", result: { test: "late" } },
    });
    expect(await readCreationReview(owner, open.id)).toMatchObject({
      extraction: {
        generation: skipped.extraction.generation,
        status: "skipped",
        proposal: null,
      },
      facts: { title: "My saved title" },
    });
    await expect(
      confirmCreationReview(
        owner,
        open.id,
        confirmation(queued.revision),
        hooks,
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await prisma.documentVersion.delete({ where: { id: pinned.versionId } });
    await expect(
      confirmCreationReview(
        owner,
        open.id,
        confirmation(skipped.revision),
        hooks,
      ),
    ).rejects.toMatchObject({ code: "SOURCE_GENERATION_CONFLICT" });
  });

  it("confirms a manual file once, rolls back failed hooks and preserves private staged documents", async () => {
    const open = await startCreationReview(owner, { requestId: randomUUID() });
    const staged = await document({
      createdById: owner.id,
      creationReviewId: open.id,
    });
    const body = confirmation(open.revision);
    const count = await prisma.matter.count();
    await expect(
      confirmCreationReview(owner, open.id, body, {
        ...hooks,
        async afterConfirm() {
          throw new Error("test hook failure");
        },
      }),
    ).rejects.toThrow("test hook failure");
    expect(await prisma.matter.count()).toBe(count);
    expect(await readCreationReview(owner, open.id)).toMatchObject({
      state: "open",
      revision: open.revision,
    });
    expect(
      await prisma.document.findUnique({ where: { id: staged.documentId } }),
    ).toMatchObject({ matterId: null });

    const [a, b] = await Promise.all([
      confirmCreationReview(owner, open.id, body, hooks),
      confirmCreationReview(owner, open.id, body, hooks),
    ]);
    expect(b).toEqual(a);
    expect(await prisma.matter.count()).toBe(count + 1);
    expect(
      await prisma.matter.findUnique({
        where: { id: a.matterId },
        include: { contacts: true, tasks: true },
      }),
    ).toMatchObject({
      business: "hto",
      packageCode: "hto_included",
      stage: "under_contract",
      checklistVersion: 1,
      contacts: [
        { name: person.name, shareWithAgent: false, shareWithClient: false },
      ],
      tasks: [{ stepKey: "contract" }],
    });
    expect(
      await prisma.document.findUnique({ where: { id: staged.documentId } }),
    ).toMatchObject({ matterId: a.matterId, visibility: "coordinator" });
    expect(
      await prisma.auditEvent.count({
        where: { entityId: a.matterId, action: "test.confirmed" },
      }),
    ).toBe(1);
    await expect(
      confirmCreationReview(owner, open.id, { ...body, people: [] }, hooks),
    ).rejects.toMatchObject({ code: "CONFIRM_REQUEST_CONFLICT" });
    const second = await startCreationReview(owner, {
      requestId: randomUUID(),
    });
    await expect(
      confirmCreationReview(owner, second.id, body, hooks),
    ).rejects.toMatchObject({ code: "CONFIRM_REQUEST_CONFLICT" });
    expect(await prisma.matter.count()).toBe(count + 1);
  });

  it("keeps the chosen file business independent of the selected roster affiliation", async () => {
    const roster = await prisma.rosterAgent.create({
      data: { name: agent.name, business: "weatherly", userId: agent.id },
    });
    const open = await startCreationReview(owner, { requestId: randomUUID() });
    const body = confirmation(open.revision);
    await expect(
      confirmCreationReview(
        owner,
        open.id,
        {
          ...body,
          facts: {
            ...body.facts,
            agentId: outsider.id,
            agentRosterId: roster.id,
          },
        },
        hooks,
      ),
    ).rejects.toMatchObject({ code: "INVALID_AGENT_ROSTER" });

    const { matterId } = await confirmCreationReview(
      owner,
      open.id,
      {
        ...body,
        facts: { ...body.facts, agentId: null, agentRosterId: roster.id },
      },
      hooks,
    );
    expect(
      await prisma.matter.findUnique({ where: { id: matterId } }),
    ).toMatchObject({
      business: "hto",
      packageCode: "hto_included",
      agentId: agent.id,
      agentRosterId: roster.id,
    });
    expect(
      await prisma.rosterAgent.findUnique({ where: { id: roster.id } }),
    ).toMatchObject({
      business: "weatherly",
      userId: agent.id,
    });
  });

  it("keeps the legacy intake pending until confirmation and preserves the original receipt and history", async () => {
    const oldTerms = {
      code: "complete",
      name: "Complete",
      priceCents: 51500,
      currency: "USD",
      revision: 2,
    };
    const legacy = await prisma.matter.create({
      data: {
        title: "Legacy address",
        propertyAddress: "Legacy address",
        side: "buyer",
        packageCode: "complete",
        stage: "pending_review",
        agentId: agent.id,
        details: {
          fileReview: { status: "pending" },
          serviceSnapshot: oldTerms,
          notes: "legacy",
        },
        tasks: { create: { title: "Original intake task" } },
      },
    });
    const pinned = await document({
      createdById: agent.id,
      matterId: legacy.id,
    });
    const snapshot = {
      packageCode: "complete",
      documentIds: [pinned.documentId],
      purchaseType: "cash",
      clients: [person],
      serviceSnapshot: oldTerms,
      customIntakeField: "preserved",
    };
    const intake = await prisma.intakeSubmission.create({
      data: {
        userId: agent.id,
        matterId: legacy.id,
        snapshot,
        draftId: randomUUID(),
        idempotencyKey: randomUUID(),
      },
    });
    const open = await startCreationReview(owner, {
      intakeId: intake.id,
      requestId: randomUUID(),
    });
    expect(open).toMatchObject({
      intake: { snapshot },
      sources: [pinned],
      facts: { propertyAddress: "Legacy address" },
    });
    expect(
      (
        await startCreationReview(owner, {
          intakeId: intake.id,
          requestId: randomUUID(),
        })
      ).id,
    ).toBe(open.id);
    expect(
      await prisma.intakeSubmission.findUnique({ where: { id: intake.id } }),
    ).toMatchObject({ processedAt: null });
    expect(
      await prisma.matter.findUnique({ where: { id: legacy.id } }),
    ).toMatchObject({ stage: "pending_review", revision: 1 });
    await expect(
      createTransactionFromIntake(owner, intake.id),
    ).rejects.toMatchObject({ code: "CREATION_REVIEW_REQUIRED" });
    await expect(
      confirmFile(owner, legacy.id, { expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: "CREATION_REVIEW_REQUIRED" });

    const body = {
      ...confirmation(open.revision),
      business: { business: "weatherly", packageCode: "complete" },
    };
    expect(await confirmCreationReview(owner, open.id, body, hooks)).toEqual({
      matterId: legacy.id,
    });
    expect(
      await prisma.intakeSubmission.findUnique({ where: { id: intake.id } }),
    ).toMatchObject({
      processedAt: expect.any(Date),
      processedById: owner.id,
      snapshot,
      matterId: legacy.id,
    });
    expect(
      await prisma.matter.findUnique({
        where: { id: legacy.id },
        include: { tasks: true },
      }),
    ).toMatchObject({
      stage: "under_contract",
      business: "weatherly",
      details: {
        serviceSnapshot: oldTerms,
        notes: "legacy",
        fileReview: { status: "confirmed" },
      },
      tasks: expect.arrayContaining([
        expect.objectContaining({
          title: "Original intake task",
          stepKey: null,
        }),
        expect.objectContaining({ stepKey: "contract" }),
      ]),
    });
    await expect(
      applyReviewedFacts(owner, legacy.id, { expectedRevision: 2 }),
    ).rejects.toMatchObject({ code: "CANONICAL_REVIEW_REQUIRED" });
  });
  it("deletes an unprocessed intake separately and invalidates its open review", async () => {
    const pending = await prisma.matter.create({
      data: {
        title: "Pending removal",
        propertyAddress: "Pending removal",
        side: "seller",
        packageCode: "complete",
        stage: "pending_review",
        agentId: agent.id,
      },
    });
    const receipt = await prisma.intakeSubmission.create({
      data: {
        userId: agent.id,
        matterId: pending.id,
        draftId: randomUUID(),
        idempotencyKey: randomUUID(),
        snapshot: { origin: "agent" },
      },
    });
    const open = await startCreationReview(owner, {
      intakeId: receipt.id,
      requestId: randomUUID(),
    });
    const staged = await document({
      createdById: owner.id,
      creationReviewId: open.id,
    });
    const effect = async () => {
      throw new Error("test cleanup failed");
    };
    await expect(
      deleteFile(
        owner,
        pending.id,
        { expectedRevision: 1, confirmation: "DELETE" },
        { beforeDelete: effect },
      ),
    ).rejects.toMatchObject({ code: "INTAKE_REVIEW_REQUIRED" });
    await expect(
      deleteIntake(agent, receipt.id, { confirm: true }, effect),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      deleteIntake(owner, receipt.id, { confirm: true }, effect),
    ).rejects.toThrow("test cleanup failed");
    expect(await prisma.matter.count({ where: { id: pending.id } })).toBe(1);
    const deleted = await deleteIntake(
      owner,
      receipt.id,
      { confirm: true },
      async (tx, actor, event) => {
        expect(event).toEqual({
          intakeId: receipt.id,
          pendingMatterId: pending.id,
          reviewId: open.id,
        });
        await tx.auditEvent.create({
          data: {
            actorId: actor.id,
            action: "test.intake_deleted",
            entityType: "IntakeSubmission",
            entityId: receipt.id,
          },
        });
      },
    );
    expect(deleted).toEqual({ intakeId: receipt.id, deleted: true });
    expect(await prisma.matter.count({ where: { id: pending.id } })).toBe(0);
    expect(
      await prisma.document.count({ where: { id: staged.documentId } }),
    ).toBe(0);
    expect(
      await prisma.intakeSubmission.findUnique({ where: { id: receipt.id } }),
    ).toMatchObject({
      deletedAt: expect.any(Date),
      processedAt: null,
      snapshot: { origin: "agent" },
    });
    expect(
      (await listIntakeSubmissions(owner)).items.some(
        ({ id }) => id === receipt.id,
      ),
    ).toBe(false);
    await expect(getIntakeSubmission(agent, receipt.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(readCreationReview(owner, open.id)).rejects.toMatchObject({
      status: 410,
    });
    await expect(
      confirmCreationReview(owner, open.id, confirmation(open.revision), hooks),
    ).rejects.toMatchObject({ code: "CREATION_REVIEW_DELETED" });
  });
});
