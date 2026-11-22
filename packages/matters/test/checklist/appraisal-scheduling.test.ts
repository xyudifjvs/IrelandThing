import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { prisma, type Prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import { seedMatterChecklist } from "../../src/checklist/persistence";
import { updateTask } from "../../src/commands/tasks";
import { mergeFields } from "../../../communications/src/merge-fields";

const id = `appraisal-schedule-${randomUUID()}`;
const actor: Principal = {
  id,
  name: "Synthetic reviewer",
  email: `${id}@example.test`,
  role: "coordinator",
  sessionId: id,
};
const files: string[] = [];
beforeAll(() =>
  prisma.user.create({
    data: { id, name: actor.name, email: actor.email, role: "coordinator" },
  }),
);
afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { actorId: id } });
  await prisma.matter.deleteMany({ where: { id: { in: files } } });
  await prisma.user.delete({ where: { id } });
});
async function file(side: "buyer" | "seller", versioned = true) {
  const matter = await prisma.matter.create({
    data: {
      title: "Synthetic appraisal",
      propertyAddress: "1 Synthetic Lane",
      side,
      packageCode: "essentials",
    },
  });
  files.push(matter.id);
  if (versioned)
    await prisma.$transaction((tx) =>
      seedMatterChecklist(tx, matter.id, {
        side,
        purchaseType: "financed",
        acceptance: null,
        timeZone: "America/New_York",
        dates: [
          {
            key: "appraisal",
            value: { date: "2026-12-15", instant: null },
            rule: { kind: "fixed" },
          },
        ],
      }),
    );
  return matter.id;
}
const steps = (matterId: string) =>
  prisma.task.findMany({
    where: { matterId, stepKey: { in: ["appraisal", "appraisal_ordered"] } },
    orderBy: { position: "asc" },
  });
const details = (task: { details: Prisma.JsonValue }) =>
  task.details as Prisma.JsonObject;

it("puts scheduling on Ordered for every new buyer and seller file", async () => {
  const buyer = await file("buyer"),
    seller = await file("seller");
  const buyerSteps = await steps(buyer),
    sellerSteps = await steps(seller);
  expect(
    buyerSteps.map((task) => [task.stepKey, details(task).scheduled]),
  ).toEqual([
    ["appraisal_ordered", true],
    ["appraisal", false],
  ]);
  expect(
    sellerSteps.map((task) => [task.stepKey, details(task).scheduled]),
  ).toEqual([
    ["appraisal_ordered", true],
    ["appraisal", false],
  ]);
  const [ordered, completed] = buyerSteps;
  await updateTask(actor, buyer, ordered.id, {
    expectedRevision: ordered.revision,
    appointmentAt: "2026-12-10T14:10:00.000Z",
    appointmentPlace: "Synthetic Office",
  });
  await expect(
    updateTask(actor, buyer, completed.id, {
      expectedRevision: completed.revision,
      appointmentAt: "2026-12-11T14:10:00.000Z",
    }),
  ).rejects.toMatchObject({ code: "APPOINTMENT_NOT_AVAILABLE" });
  const fields = await mergeFields(actor, buyer);
  expect(
    fields.find((field) => field.key === "appraisal_scheduled")?.value,
  ).toBe("Thu, Dec 10 at 9:10 AM · Synthetic Office");
  expect(
    fields.find((field) => field.key === "appraisal_deadline")?.value,
  ).toBe("12/15/26");
  const sellerAppraisal = sellerSteps[0];
  await updateTask(actor, seller, sellerAppraisal.id, {
    expectedRevision: sellerAppraisal.revision,
    appointmentAt: "2026-12-10T14:20:00.000Z",
  });
  expect(
    (await mergeFields(actor, seller)).find(
      (field) => field.key === "appraisal_scheduled",
    )?.value,
  ).toBe("Thu, Dec 10 at 9:20 AM");
});

it("corrects existing buyer flags once while preserving all other task data and leaving seller/legacy files alone", async () => {
  const buyer = await file("buyer"),
    seller = await file("seller"),
    legacy = await file("buyer", false);
  const [ordered, completed] = await steps(buyer);
  await prisma.task.update({
    where: { id: ordered.id },
    data: {
      details: {
        ...details(ordered),
        scheduled: false,
        note: "Keep ordered note",
        dateWording: "Within five days",
      },
    },
  });
  await prisma.task.update({
    where: { id: completed.id },
    data: {
      status: "completed",
      details: {
        ...details(completed),
        scheduled: true,
        note: "Keep completion note",
        showNoteToAgent: false,
      },
    },
  });
  await prisma.task.createMany({
    data: ["appraisal_ordered", "appraisal"].map((stepKey) => ({
      matterId: legacy,
      stepKey,
      title: stepKey,
      details: { scheduled: stepKey === "appraisal" },
    })),
  });
  const beforeBuyer = await steps(buyer),
    beforeSeller = await steps(seller),
    beforeLegacy = await steps(legacy);
  const beforeMatter = await prisma.matter.findUniqueOrThrow({
    where: { id: buyer },
  });
  const sql = await readFile(
    new URL(
      "../../../db/prisma/migrations/20261122010000_appraisal_ordered_schedule/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const connection = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });
  await connection.connect();
  try {
    await connection.query(sql);
  } finally {
    await connection.end();
  }
  const afterBuyer = await steps(buyer);
  for (let index = 0; index < beforeBuyer.length; index++) {
    const before = beforeBuyer[index],
      after = afterBuyer[index];
    const {
      revision: _revision,
      updatedAt: _updated,
      details: _details,
      ...unchanged
    } = before;
    expect(after).toMatchObject(unchanged);
    expect(after.details).toEqual({
      ...details(before),
      scheduled: after.stepKey === "appraisal_ordered",
    });
    expect(after.revision).toBe(before.revision + 1);
  }
  expect(await steps(seller)).toEqual(beforeSeller);
  expect(await steps(legacy)).toEqual(beforeLegacy);
  expect(
    (await prisma.matter.findUniqueOrThrow({ where: { id: buyer } })).revision,
  ).toBe(beforeMatter.revision + 1);
  const again = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await again.connect();
  try {
    await again.query(sql);
  } finally {
    await again.end();
  }
  expect(await steps(buyer)).toEqual(afterBuyer);
});
