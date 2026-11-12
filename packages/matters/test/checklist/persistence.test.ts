import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import type { ChecklistDateEdit } from "@weatherly/platform/handoff-contracts";
import { registerMatterChangeHook } from "../../src/change-hook";
import {
  applyMatterChecklistDates,
  previewMatterChecklistDates,
} from "../../src/checklist/date-commands";
import { seedMatterChecklist } from "../../src/checklist/persistence";
import { addDeadline } from "../../src/commands/deadlines";
import { addTask, reorderTasks, updateTask } from "../../src/commands/tasks";
import { recalculateWorkflow } from "../../src/rules";

const identity = `canonical-${randomUUID()}`;
const actor: Principal = {
  id: identity,
  role: "coordinator",
  name: "Synthetic checklist reviewer",
  email: `${identity}@example.test`,
  sessionId: identity,
};
const matterIds: string[] = [];
const date = (value: string) => ({ date: value, instant: null });

beforeAll(async () => {
  await prisma.user.create({
    data: {
      id: actor.id,
      name: actor.name,
      email: actor.email,
      role: actor.role,
    },
  });
});

afterEach(() => registerMatterChangeHook(undefined));
afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { actorId: actor.id } });
  await prisma.matter.deleteMany({ where: { id: { in: matterIds } } });
  await prisma.user.delete({ where: { id: actor.id } });
  await prisma.$disconnect();
});

async function createMatter() {
  const row = await prisma.matter.create({
    data: {
      title: "Synthetic checklist",
      propertyAddress: "25 Synthetic Lane",
      side: "buyer",
      packageCode: "essentials",
    },
  });
  matterIds.push(row.id);
  return row;
}

const acceptanceOffset = (amount: number) => ({
  anchor: { kind: "acceptance" as const },
  amount,
  unit: "days" as const,
  counting: "calendar" as const,
  rollover: "none" as const,
  calendar: null,
});

async function seed(matterId: string) {
  await prisma.$transaction((tx) =>
    seedMatterChecklist(tx, matterId, {
      side: "buyer",
      purchaseType: "financed",
      acceptance: date("2026-10-01"),
      timeZone: "America/New_York",
      dates: [
        {
          key: "inspections",
          value: null,
          rule: { kind: "relative", offset: acceptanceOffset(10) },
        },
        {
          key: "remedies",
          value: null,
          rule: {
            kind: "relative",
            offset: {
              ...acceptanceOffset(0),
              anchor: { kind: "step", key: "inspections" },
            },
          },
        },
        {
          key: "remedies_negotiated",
          value: null,
          rule: {
            kind: "relative",
            offset: {
              ...acceptanceOffset(3),
              anchor: { kind: "step", key: "remedies" },
            },
          },
        },
        {
          key: "condo_hoa_docs_provided",
          value: null,
          rule: { kind: "relative", offset: acceptanceOffset(5) },
        },
        {
          key: "condo_hoa_doc_review",
          value: null,
          rule: {
            kind: "earliest",
            offsets: [
              {
                ...acceptanceOffset(3),
                anchor: { kind: "actual", key: "condo_hoa_docs_provided" },
              },
              acceptanceOffset(10),
            ],
          },
        },
      ],
    }),
  );
}

function task(matterId: string, stepKey: string) {
  return prisma.task.findUniqueOrThrow({
    where: { matterId_stepKey: { matterId, stepKey } },
  });
}

async function command(
  matterId: string,
  edit: ChecklistDateEdit,
  mode: "update_all" | "only_this_date",
) {
  const preview = await previewMatterChecklistDates(actor, matterId, edit);
  return { ...edit, mode, previewDigest: preview.previewDigest };
}

describe("canonical checklist persistence", () => {
  it("activates an existing pending matter without rewriting historical tasks or dates", async () => {
    const matter = await createMatter();
    const legacyTask = await addTask(actor, matter.id, {
      title: "Original intake follow-up",
      dueDate: "2026-09-30",
    });
    const legacyDeadline = await addDeadline(actor, matter.id, {
      label: "Original inspection",
      date: "2026-10-03",
      status: "confirmed",
    });
    await seed(matter.id);

    expect(
      await prisma.task.count({
        where: { matterId: matter.id, stepKey: { not: null } },
      }),
    ).toBe(16);
    expect(
      await prisma.task.findUnique({ where: { id: legacyTask.id } }),
    ).toMatchObject({
      dueDate: "2026-09-30",
      stepKey: null,
    });
    expect(
      await prisma.deadline.findUnique({ where: { id: legacyDeadline.id } }),
    ).toMatchObject({
      date: "2026-10-03",
      status: "confirmed",
    });
    const inspection = await task(matter.id, "inspections");
    expect(inspection.dueDate).toBe("2026-10-11");
    expect(
      await prisma.task.findUnique({
        where: {
          matterId_stepKey: { matterId: matter.id, stepKey: "remedies" },
        },
      }),
    ).toBeNull();
    await expect(seed(matter.id)).rejects.toMatchObject({
      code: "CHECKLIST_ALREADY_EXISTS",
    });

    await expect(
      updateTask(actor, matter.id, inspection.id, {
        expectedRevision: inspection.revision,
        dueDate: "2026-10-14",
      }),
    ).rejects.toMatchObject({ code: "DATE_PREVIEW_REQUIRED" });
    await expect(
      addDeadline(actor, matter.id, { label: "Unreviewed parallel deadline" }),
    ).rejects.toMatchObject({ code: "DATE_PREVIEW_REQUIRED" });
    await expect(
      prisma.$transaction((tx) => recalculateWorkflow(tx, actor, matter.id)),
    ).rejects.toMatchObject({ code: "DATE_PREVIEW_REQUIRED" });
  });

  it("persists a linked extension once when concurrent requests use the same preview", async () => {
    const matter = await createMatter();
    await seed(matter.id);
    const edit = await command(
      matter.id,
      {
        expectedRevision: matter.revision,
        change: { kind: "extend", key: "inspections", amount: 4, unit: "days" },
      },
      "update_all",
    );
    const requests = await Promise.allSettled([
      applyMatterChecklistDates(actor, matter.id, edit),
      applyMatterChecklistDates(actor, matter.id, edit),
    ]);
    expect(
      requests.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = requests.find((result) => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "REVISION_CONFLICT" });
    expect(await task(matter.id, "inspections")).toMatchObject({
      dueDate: "2026-10-15",
      dateRule: {
        kind: "relative",
        adjustments: [{ amount: 4, unit: "days" }],
      },
    });
    expect(await task(matter.id, "remedies_negotiated")).toMatchObject({
      dueDate: "2026-10-18",
    });
    expect(
      await prisma.auditEvent.count({
        where: { matterId: matter.id, action: "checklist.date_extended" },
      }),
    ).toBe(1);
  });

  it("pins downstream changes across future writes and preserves hidden anchors in the matter", async () => {
    const matter = await createMatter();
    await seed(matter.id);
    const first = await command(
      matter.id,
      {
        expectedRevision: matter.revision,
        change: { kind: "extend", key: "inspections", amount: 4, unit: "days" },
      },
      "only_this_date",
    );
    const next = await applyMatterChecklistDates(actor, matter.id, first);
    const movedAcceptance = await command(
      matter.id,
      {
        expectedRevision: next.revision,
        change: {
          kind: "set",
          target: { kind: "acceptance" },
          value: date("2026-10-03"),
        },
      },
      "update_all",
    );
    await applyMatterChecklistDates(actor, matter.id, movedAcceptance);

    expect(await task(matter.id, "inspections")).toMatchObject({
      dueDate: "2026-10-17",
    });
    expect(await task(matter.id, "remedies_negotiated")).toMatchObject({
      dueDate: "2026-10-14",
      dateRule: { kind: "fixed" },
    });
    expect(
      await prisma.matter.findUniqueOrThrow({ where: { id: matter.id } }),
    ).toMatchObject({
      details: {
        checklistDateAnchors: [
          { key: "remedies", due: date("2026-10-11"), rule: { kind: "fixed" } },
        ],
      },
    });
  });

  it("amends the hidden Remedies deadline without moving inspections or adding a step", async () => {
    const matter = await createMatter();
    await seed(matter.id);
    const edit: ChecklistDateEdit = {
      expectedRevision: matter.revision,
      change: {
        kind: "set",
        target: { kind: "step", key: "remedies" },
        value: date("2026-10-15"),
      },
    };
    const preview = await previewMatterChecklistDates(actor, matter.id, edit);
    expect(preview.primary).toMatchObject({
      before: date("2026-10-11"),
      after: date("2026-10-15"),
    });
    expect(preview.dependents).toMatchObject([
      { target: { kind: "step", key: "remedies_negotiated" }, after: date("2026-10-18") },
    ]);
    await applyMatterChecklistDates(actor, matter.id, {
      ...edit,
      previewDigest: preview.previewDigest,
      mode: "update_all",
    });
    expect(await task(matter.id, "inspections")).toMatchObject({
      dueDate: "2026-10-11",
    });
    expect(await task(matter.id, "remedies_negotiated")).toMatchObject({
      dueDate: "2026-10-18",
    });
    expect(
      await prisma.task.count({ where: { matterId: matter.id, stepKey: { not: null } } }),
    ).toBe(16);
  });

  it("records actual HOA delivery and completion atomically, with hook failure rolling both back", async () => {
    const matter = await createMatter();
    await seed(matter.id);
    const provision = await task(matter.id, "condo_hoa_docs_provided");
    await expect(
      updateTask(actor, matter.id, provision.id, {
        expectedRevision: provision.revision,
        status: "completed",
      }),
    ).rejects.toMatchObject({ code: "HOA_DELIVERY_REQUIRED" });
    const edit = await command(
      matter.id,
      {
        expectedRevision: matter.revision,
        change: {
          kind: "set",
          target: { kind: "actual", key: "condo_hoa_docs_provided" },
          value: date("2026-10-02"),
        },
      },
      "update_all",
    );
    registerMatterChangeHook(async () => {
      throw new Error("Synthetic hook failure");
    });
    await expect(
      applyMatterChecklistDates(actor, matter.id, edit),
    ).rejects.toThrow("Synthetic hook failure");
    expect(await task(matter.id, "condo_hoa_docs_provided")).toMatchObject({
      status: "pending",
      actualDate: null,
    });
    expect(await task(matter.id, "condo_hoa_doc_review")).toMatchObject({
      dueDate: "2026-10-11",
    });

    registerMatterChangeHook(undefined);
    await applyMatterChecklistDates(actor, matter.id, edit);
    expect(await task(matter.id, "condo_hoa_docs_provided")).toMatchObject({
      status: "completed",
      dueDate: "2026-10-06",
      actualDate: "2026-10-02",
    });
    expect(await task(matter.id, "condo_hoa_doc_review")).toMatchObject({
      dueDate: "2026-10-05",
    });
  });

  it("keeps new task edits and ordering independent of legacy rows and protects access", async () => {
    const matter = await createMatter();
    await addTask(actor, matter.id, { title: "Original legacy task" });
    await seed(matter.id);
    const added = await addTask(actor, matter.id, {
      title: "Coordinate access",
      dateCapable: false,
    });
    const current = await prisma.matter.findUniqueOrThrow({
      where: { id: matter.id },
    });
    const steps = await prisma.task.findMany({
      where: { matterId: matter.id, stepKey: { not: null } },
      orderBy: { position: "asc" },
    });
    await reorderTasks(actor, matter.id, {
      expectedRevision: current.revision,
      taskIds: steps.map(({ id }) => id).reverse(),
    });
    const reordered = await prisma.task.findUniqueOrThrow({
      where: { id: added.id },
    });
    expect(reordered).toMatchObject({
      position: 0,
      dateCapable: false,
      dueDate: null,
    });
    await updateTask(actor, matter.id, added.id, {
      expectedRevision: reordered.revision,
      note: "Share access instructions",
      showNoteToAgent: true,
      status: "not_applicable",
    });
    expect(
      await prisma.task.findUniqueOrThrow({ where: { id: added.id } }),
    ).toMatchObject({
      status: "not_applicable",
      details: { note: "Share access instructions", showNoteToAgent: true },
    });
    await expect(
      previewMatterChecklistDates({ ...actor, role: "agent" }, matter.id, {
        expectedRevision: current.revision,
        change: {
          kind: "set",
          target: { kind: "acceptance" },
          value: date("2026-10-03"),
        },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
