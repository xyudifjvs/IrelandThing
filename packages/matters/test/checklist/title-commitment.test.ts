import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, expect, it } from "vitest";
import { prisma } from "@weatherly/db";
import { buildChecklistSeed } from "../../src/checklist/seed";
import { readChecklistSnapshot } from "../../src/checklist/persistence";
import {
  reviewDates,
  assembleDates,
} from "../../../../apps/web/app/(workspace)/workspace/_features/creation/review-model";
const prefix = `title-step-${randomUUID()}`;
const ids: string[] = [];
afterAll(async () => {
  await prisma.matter.deleteMany({ where: { id: { in: ids } } });
});
const node = {
  key: "title_commitment",
  dateCapable: true,
  status: "completed",
  due: { date: "2026-09-11", instant: "2026-09-11T19:30:00.000Z" },
  actual: { date: "2026-09-10", instant: null },
  rule: { kind: "fixed" },
};
async function migrate() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query(
      await readFile(
        new URL(
          "../../../db/prisma/migrations/20261122010200_title_commitment_step/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  } finally {
    await c.end();
  }
}
it.each(["buyer", "seller"] as const)(
  "creates one editable Title Commitment date input and checklist step for %s",
  (side) => {
    expect(
      reviewDates({ side }).filter((t) => t.key === "title_commitment"),
    ).toHaveLength(1);
    const dates = assembleDates(
      { side },
      [
        {
          key: "title_commitment",
          value: node.due,
          rule: { kind: "fixed" },
          dateWording: "On or before 9/11",
        },
      ],
      null,
    );
    expect(dates.filter((d) => d.key === "title_commitment")).toHaveLength(1);
    const seed = buildChecklistSeed({
      side,
      purchaseType: "financed",
      acceptance: null,
      timeZone: "America/New_York",
      dates,
    });
    expect(seed.steps).toHaveLength(18);
    expect(seed.steps[13]).toMatchObject({
      key: "title_commitment",
      title: "Title Commitment",
      dateCapable: true,
      scheduled: false,
      due: node.due,
      dateWording: "On or before 9/11",
    });
    expect(seed.hiddenAnchors.some((a) => a.key === "title_commitment")).toBe(
      false,
    );
  },
);
it("backfills undated buyers and restores seller anchor/history without losing private details, state or rules; replay is a no-op", async () => {
  const buyer = await prisma.matter.create({
    data: {
      title: prefix + "buyer",
      side: "buyer",
      packageCode: "essentials",
      propertyAddress: "1 Synthetic Title Lane",
      checklistVersion: 1,
      details: {},
    },
  });
  ids.push(buyer.id);
  const seller = await prisma.matter.create({
    data: {
      title: prefix + "seller",
      side: "seller",
      packageCode: "essentials",
      propertyAddress: "1 Synthetic Title Lane",
      checklistVersion: 1,
      deadlineTimeZone: "America/New_York",
      details: {
        coordinatorChecklistUnified: true,
        checklistDateAnchors: [node],
        clientTitleCommitment: {
          dateWording: "By September 11",
          visibility: "client",
        },
      },
    },
  });
  ids.push(seller.id);
  for (const m of [buyer, seller])
    await prisma.task.createMany({
      data: [
        {
          matterId: m.id,
          stepKey: "loan_commitment",
          title: "Financing Approved / Loan Commitment",
          kind: "checklist",
          visibility: "client",
          dateCapable: true,
          position: 12,
          details: {},
        },
        {
          matterId: m.id,
          stepKey: "clear_to_close",
          title: "Clear to Close",
          kind: "checklist",
          visibility: "client",
          dateCapable: false,
          position: 13,
          details: {},
        },
      ],
    });
  const history = await prisma.task.create({
    data: {
      matterId: seller.id,
      title: "Title Commitment",
      stepKey: null,
      kind: "checklist",
      visibility: "client",
      status: "not_applicable",
      position: 9,
      dateCapable: true,
      details: {
        originalChecklistKey: "title_commitment",
        originalStatus: "pending",
        note: "PRIVATE original title note",
        dateWording: "On or before 9/11",
        scheduled: false,
      },
    },
  });
  await migrate();
  const read = () =>
    prisma.matter.findMany({
      where: { id: { in: ids } },
      include: { tasks: { orderBy: { position: "asc" } } },
      orderBy: { id: "asc" },
    });
  const result = await read();
  const b = result
    .find((m) => m.id === buyer.id)!
    .tasks.find((t) => t.stepKey === "title_commitment")!;
  expect(b).toMatchObject({
    dueDate: null,
    dateRule: null,
    status: "pending",
    position: 13,
  });
  const s = result.find((m) => m.id === seller.id)!;
  const title = s.tasks.find((t) => t.stepKey === "title_commitment")!;
  expect(title).toMatchObject({
    id: history.id,
    status: "completed",
    dueDate: "2026-09-11",
    dueAt: new Date(node.due.instant),
    actualDate: "2026-09-10",
    dateRule: node.rule,
    position: 13,
    details: {
      note: "PRIVATE original title note",
      dateWording: "On or before 9/11",
    },
  });
  expect(s.tasks.find((t) => t.stepKey === "clear_to_close")?.position).toBe(
    14,
  );
  const graph = await prisma.$transaction((tx) => readChecklistSnapshot(tx, s));
  expect(
    graph.snapshot.nodes.filter((n) => n.key === "title_commitment"),
  ).toHaveLength(1);
  expect(
    graph.snapshot.nodes.find((n) => n.key === "title_commitment"),
  ).toMatchObject(node);
  await migrate();
  expect(await read()).toEqual(result);
});
it("restores an anchor-only seller title with saved wording and does not change existing title steps", async () => {
  const matter = await prisma.matter.create({
    data: {
      title: prefix + "anchor-only",
      side: "seller",
      packageCode: "essentials",
      propertyAddress: "1 Synthetic Title Lane",
      checklistVersion: 1,
      details: {
        checklistDateAnchors: [{ ...node, status: "not_needed" }],
        clientTitleCommitment: { dateWording: "Received", visibility: "agent" },
      },
    },
  });
  ids.push(matter.id);
  await migrate();
  const title = await prisma.task.findUniqueOrThrow({
    where: {
      matterId_stepKey: { matterId: matter.id, stepKey: "title_commitment" },
    },
  });
  expect(title).toMatchObject({
    visibility: "agent",
    status: "not_applicable",
    dueDate: "2026-09-11",
    details: { dateWording: "Received", scheduled: false },
  });
  await migrate();
  expect(await prisma.task.findUnique({ where: { id: title.id } })).toEqual(
    title,
  );
});
