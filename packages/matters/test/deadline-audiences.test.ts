import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import {
  addDeadline,
  updateDeadline,
  updateTask,
  getMatter,
  listMatters,
  createChecklistShare,
  getPublicChecklist,
  applyReviewedFacts,
} from "../src/index";

const run = randomUUID(),
  matterIds: string[] = [];
const actor = (role: Principal["role"]): Principal => ({
  id: `date-audience-${role}-${run}`,
  role,
  name: role,
  email: `${role}-${run}@example.test`,
  sessionId: run,
});
const owner = actor("coordinator"),
  agent = actor("agent"),
  client = actor("client");
const scopes = ["coordinator", "agent", "client_only", "client"] as const;
beforeAll(async () => {
  await prisma.user.createMany({
    data: [owner, agent, client].map(({ id, role, name, email }) => ({
      id,
      role,
      name,
      email,
    })),
  });
});
afterAll(async () => {
  await prisma.matter.deleteMany({ where: { id: { in: matterIds } } });
  await prisma.auditEvent.deleteMany({ where: { actorId: owner.id } });
  await prisma.user.deleteMany({
    where: { id: { in: [owner.id, agent.id, client.id] } },
  });
  await prisma.$disconnect();
});
async function fixture() {
  const matter = await prisma.matter.create({
    data: {
      title: "Synthetic deadline audience",
      propertyAddress: "42 Synthetic Audience Road",
      side: "buyer",
      packageCode: "essentials",
      agentId: agent.id,
      details: {
        fileReview: { status: "confirmed" },
        confirmedFacts: { closing_date: "SECRET_CONFIRMED_DATE" },
      },
      participants: { create: { userId: client.id, role: "client" } },
    },
  });
  matterIds.push(matter.id);
  const share = await createChecklistShare(owner, matter.id);
  return { matter, token: new URL(share.url).hash.slice(1) };
}
async function linked(
  matterId: string,
  key: string,
  visibility: (typeof scopes)[number],
  dateVisibility?: (typeof scopes)[number],
) {
  const task = await prisma.task.create({
    data: {
      matterId,
      title: `Task ${key}`,
      visibility,
      dueDate: "2026-11-06",
      details: {
        workflowKey: key,
        note: "Shared short note",
        privateContext: "SECRET_TASK_INTERNAL",
      },
    },
  });
  const deadline = await prisma.deadline.create({
    data: {
      matterId,
      label: `Date ${key}`,
      date: "2026-11-06",
      status: "confirmed",
      details: {
        workflowKey: key,
        ...(dateVisibility ? { visibility: dateVisibility } : {}),
        privateContext: "SECRET_DEADLINE_INTERNAL",
      },
    },
  });
  return { task, deadline };
}
describe("canonical deadline audiences", () => {
  it("keeps a newly extracted standalone date private even when its label differs from the private canonical milestone", async () => {
    const { matter, token } = await fixture();
    await prisma.task.create({
      data: {
        matterId: matter.id,
        title: "Closing date",
        visibility: "coordinator",
      },
    });
    const quote = "Closing is November 6, 2026.";
    const document = await prisma.document.create({
      data: {
        matterId: matter.id,
        name: "synthetic-contract.pdf",
        mimeType: "application/pdf",
        visibility: "coordinator",
        createdById: owner.id,
        versions: {
          create: {
            version: 1,
            objectKey: `synthetic-source-${randomUUID()}`,
            checksum: "a".repeat(64),
            size: quote.length,
            extractedText: quote,
            processingStatus: "complete",
          },
        },
      },
    });
    const reviewed = await applyReviewedFacts(owner, matter.id, {
      expectedRevision: matter.revision,
      deadlines: [
        {
          label: "Closing",
          date: "2026-11-06",
          sourceDocumentId: document.id,
          sourceQuote: quote,
        },
      ],
    });
    const date = reviewed.deadlines.find((row) => row.label === "Closing")!;
    expect(date.details).toMatchObject({ visibility: "coordinator" });
    for (const who of [agent, client]) {
      expect((await getMatter(who, matter.id)).deadlines).toEqual([]);
      expect(
        (await listMatters(who)).find((row) => row.id === matter.id)?.deadlines,
      ).toEqual([]);
    }
    expect((await getPublicChecklist(token)).deadlines).toEqual([]);
  });
  it("uses all four task scopes for linked dates in get/list/public, including differently titled task/date pairs", async () => {
    const { matter, token } = await fixture();
    const records = await Promise.all(
      scopes.map((visibility) => linked(matter.id, visibility, visibility)),
    );
    for (const who of [owner, agent, client]) {
      const expected = records.filter(
        ({ task }) =>
          who.role === "coordinator" ||
          task.visibility === "client" ||
          task.visibility === who.role ||
          (who.role === "client" && task.visibility === "client_only"),
      );
      const get = await getMatter(who, matter.id),
        list = (await listMatters(who)).find((row) => row.id === matter.id)!;
      for (const view of [get, list]) {
        expect(view.deadlines.map((row) => row.id).sort()).toEqual(
          expected.map((row) => row.deadline.id).sort(),
        );
        expect(view.tasks.map((row) => row.id).sort()).toEqual(
          expected.map((row) => row.task.id).sort(),
        );
        if (who.role !== "coordinator") {
          expect(JSON.stringify(view)).not.toContain("SECRET_");
          for (const row of view.tasks)
            expect(row).toMatchObject({ note: "Shared short note" });
        }
      }
    }
    const publicView = await getPublicChecklist(token);
    expect(publicView.deadlines.map((row) => row.id).sort()).toEqual(
      records
        .filter((row) =>
          ["client_only", "client"].includes(row.task.visibility),
        )
        .map((row) => row.deadline.id)
        .sort(),
    );
    expect(JSON.stringify(publicView)).not.toContain("SECRET_");
    const internal = await getMatter(owner, matter.id);
    for (const record of records)
      expect(
        internal.deadlines.find((row) => row.id === record.deadline.id),
      ).toMatchObject({
        visibility: record.task.visibility,
        linkedToTask: true,
        inheritedVisibility: record.task.visibility,
      });
    const formerlyShared = records.find(
      (row) => row.task.visibility === "client",
    )!;
    await updateTask(owner, matter.id, formerlyShared.task.id, {
      expectedRevision: formerlyShared.task.revision,
      visibility: "coordinator",
    });
    expect(
      (await getPublicChecklist(token)).deadlines.some(
        (row) => row.id === formerlyShared.deadline.id,
      ),
    ).toBe(false);
    expect(
      (await getMatter(agent, matter.id)).deadlines.some(
        (row) => row.id === formerlyShared.deadline.id,
      ),
    ).toBe(false);
  });
  it("requires explicit sharing of new standalone dates and retains historical unmarked standalone dates", async () => {
    const { matter, token } = await fixture();
    const rows = await Promise.all(
      scopes.map((visibility) =>
        addDeadline(owner, matter.id, {
          label: `Standalone ${visibility}`,
          date: "2026-11-06",
          status: "confirmed",
          visibility,
        }),
      ),
    );
    const privateDefault = await addDeadline(owner, matter.id, {
      label: "SECRET_DEFAULT_PRIVATE",
      date: "2026-11-06",
      status: "confirmed",
    });
    expect(privateDefault).toMatchObject({
      visibility: "coordinator",
      linkedToTask: false,
    });
    const legacy = await prisma.deadline.create({
      data: {
        matterId: matter.id,
        label: "Legacy standalone",
        date: "2026-11-06",
        status: "confirmed",
      },
    });
    for (const who of [agent, client]) {
      const expected = rows
        .filter(
          (row) =>
            row.visibility === "client" ||
            row.visibility === who.role ||
            (who.role === "client" && row.visibility === "client_only"),
        )
        .map((row) => row.id)
        .concat(legacy.id)
        .sort();
      for (const view of [
        await getMatter(who, matter.id),
        (await listMatters(who)).find((row) => row.id === matter.id)!,
      ])
        expect(view.deadlines.map((row) => row.id).sort()).toEqual(expected);
    }
    expect(
      (await getPublicChecklist(token)).deadlines.map((row) => row.id).sort(),
    ).toEqual(
      rows
        .filter((row) => ["client", "client_only"].includes(row.visibility))
        .map((row) => row.id)
        .concat(legacy.id)
        .sort(),
    );
    const narrowed = await updateDeadline(owner, matter.id, legacy.id, {
      expectedRevision: legacy.revision,
      visibility: "coordinator",
    });
    if (!("revision" in narrowed))
      throw new Error("A deadline patch must return the saved deadline.");
    expect(narrowed).toMatchObject({ visibility: "coordinator" });
    expect(
      (await getPublicChecklist(token)).deadlines.some(
        (row) => row.id === legacy.id,
      ),
    ).toBe(false);
    await updateDeadline(owner, matter.id, legacy.id, {
      expectedRevision: narrowed.revision,
      date: "2026-11-07",
      details: { unrelated: "Preserve explicit privacy" },
    });
    expect(
      (await getMatter(agent, matter.id)).deadlines.some(
        (row) => row.id === legacy.id,
      ),
    ).toBe(false);
    await expect(
      addDeadline(agent, matter.id, {
        label: "Forbidden",
        visibility: "client",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateDeadline(client, matter.id, legacy.id, {
        expectedRevision: narrowed.revision,
        visibility: "client",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      addDeadline(owner, matter.id, {
        label: "Invalid",
        details: { visibility: "everybody" },
      }),
    ).rejects.toBeDefined();
  });
  it("intersects restrictive date scopes with canonical task scopes and hides derived dueDate as well", async () => {
    const { matter, token } = await fixture();
    const privateDate = await linked(
      matter.id,
      "private-date",
      "client",
      "coordinator",
    );
    const privateTask = await linked(
      matter.id,
      "private-task",
      "coordinator",
      "client",
    );
    for (const who of [agent, client])
      for (const view of [
        await getMatter(who, matter.id),
        (await listMatters(who)).find((row) => row.id === matter.id)!,
      ]) {
        expect(view.deadlines).toEqual([]);
        expect(
          view.tasks.find((row) => row.id === privateDate.task.id),
        ).toMatchObject({ dueDate: null });
        expect(view.tasks.some((row) => row.id === privateTask.task.id)).toBe(
          false,
        );
      }
    const shared = await getPublicChecklist(token);
    expect(shared.deadlines).toEqual([]);
    expect(shared.tasks).toEqual([
      expect.objectContaining({ id: privateDate.task.id, dueDate: null }),
    ]);
    await updateDeadline(owner, matter.id, privateDate.deadline.id, {
      expectedRevision: privateDate.deadline.revision,
      visibility: "client",
    });
    expect(
      (await getPublicChecklist(token)).tasks.find(
        (row) => row.id === privateDate.task.id,
      )?.dueDate,
    ).toBe("2026-11-06");
    expect(
      (await getPublicChecklist(token)).deadlines.map((row) => row.id),
    ).toEqual([privateDate.deadline.id]);
  });
  it("fails closed for conflicting duplicate or orphan workflow associations", async () => {
    const { matter, token } = await fixture();
    const first = await linked(matter.id, "duplicate", "client", "client");
    await prisma.task.create({
      data: {
        matterId: matter.id,
        title: "SECRET_DUPLICATE_TASK",
        visibility: "coordinator",
        details: { workflowKey: "duplicate" },
      },
    });
    await prisma.deadline.create({
      data: {
        matterId: matter.id,
        label: "SECRET_ORPHAN_DATE",
        date: "2026-11-06",
        status: "confirmed",
        details: { workflowKey: "orphan", visibility: "client" },
      },
    });
    for (const who of [agent, client])
      for (const view of [
        await getMatter(who, matter.id),
        (await listMatters(who)).find((row) => row.id === matter.id)!,
      ]) {
        expect(view.deadlines).toEqual([]);
        expect(
          view.tasks.find((row) => row.id === first.task.id),
        ).toMatchObject({ dueDate: null });
        expect(JSON.stringify(view)).not.toContain("SECRET_");
      }
    expect((await getPublicChecklist(token)).deadlines).toEqual([]);
    expect((await getPublicChecklist(token)).tasks[0].dueDate).toBeNull();
  });
});
