import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import {
  addDeadline,
  applyReviewedFacts,
  createChecklistShare,
  deleteDeadline,
  getMatter,
  getPublicChecklist,
  listMatters,
  updateDeadline,
  updateTask,
} from "../src/index";

const run = randomUUID();
const owner: Principal = {
  id: `date-owner-${run}`,
  email: `date-owner-${run}@example.test`,
  name: "Date reviewer",
  role: "coordinator",
  sessionId: run,
};
const agent: Principal = {
  id: `date-agent-${run}`,
  email: `date-agent-${run}@example.test`,
  name: "Date agent",
  role: "agent",
  sessionId: run,
};
const client: Principal = {
  id: `date-client-${run}`,
  email: `date-client-${run}@example.test`,
  name: "Date client",
  role: "client",
  sessionId: run,
};
const matterIds: string[] = [];
const rule = {
  anchor: "Effective date",
  offsetDays: 5,
  businessDays: false,
  skipDates: [],
};
async function fixture() {
  const matter = await prisma.matter.create({
    data: {
      title: "Synthetic date approval",
      propertyAddress: "42 Synthetic Way",
      side: "buyer",
      packageCode: "essentials",
      agentId: agent.id,
      details: {
        workflow: {
          definition: {
            steps: [
              {
                key: "inspection",
                title: "Inspection deadline",
                kind: "checklist",
                visibility: "client",
                rule,
              },
            ],
          },
        },
      },
      participants: { create: [{ userId: client.id, role: "client" }] },
      tasks: {
        create: [
          {
            title: "Inspection deadline",
            visibility: "client",
            details: { workflowKey: "inspection" },
          },
        ],
      },
      deadlines: {
        create: [
          {
            label: "Inspection deadline",
            status: "unknown",
            details: { workflowKey: "inspection", rule },
          },
        ],
      },
    },
    include: { tasks: true, deadlines: true },
  });
  matterIds.push(matter.id);
  const share = await createChecklistShare(owner, matter.id);
  return { matter, token: new URL(share.url).hash.slice(1) };
}
async function deadlineFor(matterId: string) {
  return prisma.deadline.findFirstOrThrow({
    where: { matterId, label: "Inspection deadline" },
  });
}
async function taskFor(matterId: string) {
  return prisma.task.findFirstOrThrow({
    where: { matterId, title: "Inspection deadline" },
  });
}
beforeAll(async () => {
  await prisma.user.createMany({
    data: [owner, agent, client].map(({ id, name, email, role }) => ({
      id,
      name,
      email,
      role,
    })),
  });
});
afterAll(async () => {
  await prisma.matter.deleteMany({ where: { id: { in: matterIds } } });
  await prisma.auditEvent.deleteMany({
    where: { actorId: { in: [owner.id, agent.id, client.id] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [owner.id, agent.id, client.id] } },
  });
  await prisma.$disconnect();
});

describe("Ireland approval boundary for consequential dates", () => {
  it("holds calculated dates out of task/calendar projections until approval, then syncs canonical completion without a second approval", async () => {
    const { matter, token } = await fixture();
    const anchor = await addDeadline(owner, matter.id, {
      label: "Effective date",
      date: "2026-11-01",
      status: "proposed",
    });
    expect((await deadlineFor(matter.id)).date).toBeNull();
    expect((await taskFor(matter.id)).dueDate).toBeNull();
    await updateDeadline(owner, matter.id, anchor.id, {
      expectedRevision: anchor.revision,
      status: "confirmed",
    });
    let derived = await deadlineFor(matter.id);
    expect(derived).toMatchObject({ date: "2026-11-06", status: "proposed" });
    expect((await taskFor(matter.id)).dueDate).toBeNull();
    expect(
      (await getMatter(owner, matter.id)).deadlines.some(
        (d) => d.id === derived.id && d.status === "proposed",
      ),
    ).toBe(true);
    expect(
      (await getMatter(agent, matter.id)).deadlines.some(
        (d) => d.id === derived.id,
      ),
    ).toBe(false);
    expect(
      (await getMatter(client, matter.id)).deadlines.some(
        (d) => d.id === derived.id,
      ),
    ).toBe(false);
    expect(
      (await getPublicChecklist(token)).deadlines.some(
        (d) => d.id === derived.id,
      ),
    ).toBe(false);
    await updateDeadline(owner, matter.id, derived.id, {
      expectedRevision: derived.revision,
      status: "confirmed",
    });
    expect((await taskFor(matter.id)).dueDate).toBe("2026-11-06");
    expect((await getPublicChecklist(token)).tasks[0].dueDate).toBe(
      "2026-11-06",
    );
    const metadataAnchor = await prisma.deadline.findUniqueOrThrow({
      where: { id: anchor.id },
    });
    await updateDeadline(owner, matter.id, anchor.id, {
      expectedRevision: metadataAnchor.revision,
      details: { note: "Approved anchor, same actual date" },
    });
    expect((await deadlineFor(matter.id)).status).toBe("confirmed");
    expect((await taskFor(matter.id)).dueDate).toBe("2026-11-06");
    const task = await taskFor(matter.id);
    await updateTask(owner, matter.id, task.id, {
      expectedRevision: task.revision,
      status: "completed",
    });
    for (const actor of [agent, client])
      expect((await getMatter(actor, matter.id)).tasks[0].status).toBe(
        "completed",
      );
    expect((await getPublicChecklist(token)).tasks[0]).toMatchObject({
      status: "completed",
      dueDate: "2026-11-06",
    });
    const currentAnchor = await prisma.deadline.findUniqueOrThrow({
      where: { id: anchor.id },
    });
    await updateDeadline(owner, matter.id, anchor.id, {
      expectedRevision: currentAnchor.revision,
      date: "2026-11-02",
    });
    derived = await deadlineFor(matter.id);
    expect(derived).toMatchObject({ date: "2026-11-07", status: "proposed" });
    expect(await taskFor(matter.id)).toMatchObject({
      status: "completed",
      dueDate: null,
    });
    expect((await getPublicChecklist(token)).tasks[0].dueDate).toBeNull();
  });

  it.each([false, true])(
    "withdraws downstream authoritative dates when an upstream rule becomes proposed (reversed order: %s)",
    async (reversed) => {
      const first = {
        key: "a",
        title: "A deadline",
        kind: "checklist",
        visibility: "client",
        rule: {
          anchor: "Effective date",
          offsetDays: 5,
          businessDays: false,
          skipDates: [],
        },
      };
      const second = {
        key: "b",
        title: "B deadline",
        kind: "checklist",
        visibility: "client",
        rule: {
          anchor: "A deadline",
          offsetDays: 2,
          businessDays: false,
          skipDates: [],
        },
      };
      const steps = reversed ? [second, first] : [first, second];
      const matter = await prisma.matter.create({
        data: {
          title: "Synthetic chained approval",
          propertyAddress: "42 Synthetic Chain",
          side: "buyer",
          packageCode: "essentials",
          agentId: agent.id,
          details: { workflow: { definition: { steps } } },
          participants: { create: [{ userId: client.id, role: "client" }] },
          tasks: {
            create: steps.map((step) => ({
              title: step.title,
              visibility: "client",
              details: { workflowKey: step.key },
            })),
          },
          deadlines: {
            create: steps.map((step) => ({
              label: step.title,
              status: "unknown",
              details: { workflowKey: step.key, rule: step.rule },
            })),
          },
        },
      });
      matterIds.push(matter.id);
      const token = new URL(
        (await createChecklistShare(owner, matter.id)).url,
      ).hash.slice(1);
      const anchor = await addDeadline(owner, matter.id, {
        label: "Effective date",
        date: "2026-11-01",
        status: "confirmed",
        visibility: "client",
      });
      const get = (label: string) =>
        prisma.deadline.findFirstOrThrow({
          where: { matterId: matter.id, label },
        });
      for (const label of ["A deadline", "B deadline"]) {
        const proposed = await get(label);
        await updateDeadline(owner, matter.id, proposed.id, {
          expectedRevision: proposed.revision,
          status: "confirmed",
        });
      }
      expect(
        (await getPublicChecklist(token)).tasks
          .map((task) => task.dueDate)
          .sort(),
      ).toEqual(["2026-11-06", "2026-11-08"]);
      await updateDeadline(owner, matter.id, anchor.id, {
        expectedRevision: anchor.revision,
        date: "2026-11-02",
      });
      expect(await get("A deadline")).toMatchObject({
        date: "2026-11-07",
        status: "proposed",
      });
      expect(await get("B deadline")).toMatchObject({
        date: null,
        status: "unknown",
      });
      expect(
        (await prisma.task.findMany({ where: { matterId: matter.id } })).every(
          (task) => task.dueDate === null,
        ),
      ).toBe(true);
      const publicView = await getPublicChecklist(token);
      expect(publicView.tasks.every((task) => task.dueDate === null)).toBe(
        true,
      );
      expect(publicView.deadlines.map((deadline) => deadline.label)).toEqual([
        "Effective date",
      ]);
      expect(
        (await getMatter(agent, matter.id)).deadlines.map(
          (deadline) => deadline.label,
        ),
      ).toEqual(["Effective date"]);
      const firstProposal = await get("A deadline");
      await updateDeadline(owner, matter.id, firstProposal.id, {
        expectedRevision: firstProposal.revision,
        status: "confirmed",
      });
      const secondProposal = await get("B deadline");
      expect(secondProposal).toMatchObject({
        date: "2026-11-09",
        status: "proposed",
      });
      expect(
        (await getPublicChecklist(token)).tasks.find(
          (task) => task.title === "B deadline",
        )?.dueDate,
      ).toBeNull();
      await updateDeadline(owner, matter.id, secondProposal.id, {
        expectedRevision: secondProposal.revision,
        status: "confirmed",
      });
      expect(
        (await getPublicChecklist(token)).tasks.find(
          (task) => task.title === "B deadline",
        )?.dueDate,
      ).toBe("2026-11-09");
    },
  );

  it("rolls back a triggering write when workflow rules contain a dependency cycle", async () => {
    const { matter } = await fixture();
    const steps = [
      {
        key: "a",
        title: "A",
        kind: "checklist",
        visibility: "agent",
        rule: { ...rule, anchor: "B" },
      },
      {
        key: "b",
        title: "B",
        kind: "checklist",
        visibility: "agent",
        rule: { ...rule, anchor: "A" },
      },
    ];
    await prisma.matter.update({
      where: { id: matter.id },
      data: { details: { workflow: { definition: { steps } } } },
    });
    await expect(
      addDeadline(owner, matter.id, {
        label: "Effective date",
        date: "2026-11-01",
        status: "confirmed",
      }),
    ).rejects.toMatchObject({ code: "DATE_RULE_CYCLE", status: 422 });
    expect(
      await prisma.deadline.count({
        where: { matterId: matter.id, label: "Effective date" },
      }),
    ).toBe(0);
  });

  it("keeps manual proposed overrides non-authoritative and removes the task date when approval is withdrawn or the deadline deleted", async () => {
    const { matter, token } = await fixture();
    let derived = await deadlineFor(matter.id);
    await updateDeadline(owner, matter.id, derived.id, {
      expectedRevision: derived.revision,
      date: "2026-11-12",
      status: "proposed",
    });
    derived = await deadlineFor(matter.id);
    expect(derived.details).toMatchObject({ manualOverride: true });
    expect((await taskFor(matter.id)).dueDate).toBeNull();
    await updateDeadline(owner, matter.id, derived.id, {
      expectedRevision: derived.revision,
      status: "confirmed",
    });
    expect((await taskFor(matter.id)).dueDate).toBe("2026-11-12");
    derived = await deadlineFor(matter.id);
    await updateDeadline(owner, matter.id, derived.id, {
      expectedRevision: derived.revision,
      status: "rejected",
    });
    expect((await taskFor(matter.id)).dueDate).toBeNull();
    derived = await deadlineFor(matter.id);
    await updateDeadline(owner, matter.id, derived.id, {
      expectedRevision: derived.revision,
      status: "confirmed",
    });
    derived = await deadlineFor(matter.id);
    await deleteDeadline(owner, matter.id, derived.id, {
      expectedRevision: derived.revision,
    });
    expect((await taskFor(matter.id)).dueDate).toBeNull();
    expect((await getPublicChecklist(token)).tasks[0].dueDate).toBeNull();
  });

  it("preserves an explicitly approved extracted date when source evidence overrides a configured calculation", async () => {
    const { matter, token } = await fixture();
    await addDeadline(owner, matter.id, {
      label: "Effective date",
      date: "2026-11-01",
      status: "confirmed",
    });
    const document = await prisma.document.create({
      data: {
        matterId: matter.id,
        name: "Synthetic signed amendment.pdf",
        mimeType: "application/pdf",
        createdById: owner.id,
        versions: {
          create: {
            version: 1,
            objectKey: "synthetic-date-evidence",
            checksum: "a".repeat(64),
            size: 100,
            extractedText: "Inspection deadline is November 12, 2026.",
            processingStatus: "complete",
          },
        },
      },
    });
    const current = await prisma.matter.findUniqueOrThrow({
      where: { id: matter.id },
    });
    await applyReviewedFacts(owner, matter.id, {
      expectedRevision: current.revision,
      deadlines: [
        {
          label: "Inspection deadline",
          date: "2026-11-12",
          sourceDocumentId: document.id,
          sourceQuote: "Inspection deadline is November 12, 2026.",
        },
      ],
    });
    const accepted = await deadlineFor(matter.id);
    expect(accepted).toMatchObject({
      status: "confirmed",
      date: "2026-11-12",
      details: { manualOverride: true, reviewedById: owner.id },
    });
    expect((await taskFor(matter.id)).dueDate).toBe("2026-11-12");
    expect(
      (await getPublicChecklist(token)).deadlines.find(
        (d) => d.id === accepted.id,
      )?.date,
    ).toBe("2026-11-12");
  });

  it("suppresses pre-release stored unapproved task dates on every read without rewriting records, while preserving coordinator-entered dates on ordinary tasks", async () => {
    const { matter, token } = await fixture();
    const task = await taskFor(matter.id);
    await prisma.task.update({
      where: { id: task.id },
      data: { dueDate: "2026-11-20" },
    });
    await prisma.deadline.update({
      where: { id: matter.deadlines[0].id },
      data: { date: "2026-11-20", status: "proposed" },
    });
    for (const actor of [owner, agent, client]) {
      expect((await getMatter(actor, matter.id)).tasks[0].dueDate).toBeNull();
      expect(
        (await listMatters(actor)).find((m) => m.id === matter.id)!.tasks[0]
          .dueDate,
      ).toBeNull();
    }
    expect((await getPublicChecklist(token)).tasks[0].dueDate).toBeNull();
    expect((await taskFor(matter.id)).dueDate).toBe("2026-11-20");
    const ordinary = await prisma.task.create({
      data: {
        matterId: matter.id,
        title: "Coordinator scheduled call",
        visibility: "client",
        dueDate: "2026-11-21",
      },
    });
    expect(
      (await getPublicChecklist(token)).tasks.find((t) => t.id === ordinary.id)
        ?.dueDate,
    ).toBe("2026-11-21");
    await expect(
      updateDeadline(agent, matter.id, matter.deadlines[0].id, {
        expectedRevision: 1,
        status: "confirmed",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
