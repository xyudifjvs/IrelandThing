import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { ZodError } from "zod";
import { prisma } from "@weatherly/db";
import { HttpError, sanitizeError, type Principal } from "@weatherly/platform";
import { createMattersRouter } from "../../src/routes/router";
import { updateFileFacts } from "../../src/commands/file-facts";
import { seedMatterChecklist } from "../../src/checklist/persistence";
import { getMatter } from "../../src/projections/matters";
import { mergeFields } from "../../../communications/src/merge-fields";
import { registerMatterChangeHook } from "../../src/change-hook";

const prefix = `details-${randomUUID()}`;
const owner: Principal = {
  id: prefix,
  name: "Synthetic coordinator",
  email: `${prefix}@example.test`,
  role: "coordinator",
  sessionId: prefix,
};
const agent: Principal = {
  ...owner,
  id: prefix + "-agent",
  email: `${prefix}-agent@example.test`,
  role: "agent",
};
const files: string[] = [];
beforeAll(async () => {
  await prisma.user.createMany({
    data: [owner, agent].map(({ id, name, email, role }) => ({
      id,
      name,
      email,
      role,
    })),
  });
});
afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { actorId: owner.id } });
  await prisma.matter.deleteMany({ where: { id: { in: files } } });
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, agent.id] } } });
});
async function fixture(
  business: "hto" | "weatherly" = "weatherly",
  side: "buyer" | "seller" = "buyer",
  purchaseType: "cash" | "financed" = "financed",
) {
  const row = await prisma.matter.create({
    data: {
      title: "Original Address",
      propertyAddress: "Original Address",
      side,
      business,
      packageCode: business === "hto" ? "hto_included" : "essentials",
      stage: "under_contract",
      purchasePriceCents: 25000000,
      agentId: agent.id,
      details: {
        purchaseType,
        referenceIntake: { fields: { price: "Original intake evidence" } },
        mergeFieldValues: { utility_list: "Saved utilities" },
      },
    },
  });
  files.push(row.id);
  await prisma.$transaction((tx) =>
    seedMatterChecklist(tx, row.id, {
      side,
      purchaseType,
      acceptance: null,
      timeZone: "America/New_York",
      dates: [
        {
          key: "closing",
          value: { date: "2027-01-30", instant: null },
          rule: { kind: "fixed" },
        },
        {
          key: "loan_commitment",
          value: { date: "2027-01-15", instant: null },
          rule: { kind: "fixed" },
        },
      ],
    }),
  );
  return prisma.matter.findUniqueOrThrow({ where: { id: row.id } });
}
const save = (id: string, input: Parameters<typeof updateFileFacts>[3]) =>
  prisma.$transaction((tx) => updateFileFacts(tx, owner, id, input));
const steps = (id: string) =>
  prisma.task.findMany({
    where: { matterId: id },
    orderBy: { position: "asc" },
  });
const fields = async (id: string) =>
  Object.fromEntries(
    (await mergeFields(owner, id)).map((field) => [field.key, field.value]),
  );

it.each([
  ["hto", "buyer"],
  ["hto", "seller"],
  ["weatherly", "buyer"],
  ["weatherly", "seller"],
] as const)(
  "updates %s %s price and checklist amounts atomically from the same canonical values",
  async (business, side) => {
    const file = await fixture(business, side);
    const before = await steps(file.id);
    await save(file.id, {
      expectedRevision: file.revision,
      purchasePriceCents: 27500001,
      propertyAddress: "Updated Address",
      earnestMoneyCents: 500001,
      earnestMoneyHolder: "Synthetic Title",
      homeWarrantyCents: 65000,
      homeWarrantyCompany: "Synthetic Warranty",
    });
    const saved = await prisma.matter.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(saved.purchasePriceCents?.toNumber()).toBe(27500001);
    expect(saved).toMatchObject({
      propertyAddress: "Updated Address",
      title: "Updated Address",
      details: file.details,
      revision: file.revision + 1,
    });
    const after = await steps(file.id);
    expect(
      after.map(({ id, status, dueDate, actualDate, dateRule, position }) => ({
        id,
        status,
        dueDate,
        actualDate,
        dateRule,
        position,
      })),
    ).toEqual(
      before.map(({ id, status, dueDate, actualDate, dateRule, position }) => ({
        id,
        status,
        dueDate,
        actualDate,
        dateRule,
        position,
      })),
    );
    expect(await fields(file.id)).toMatchObject({
      purchase_price: "$275,000.01",
      emd_amount: "$5,000.01",
      emd_holder: "Synthetic Title",
      warranty_amount: "$650",
      warranty_company: "Synthetic Warranty",
    });
  },
);

it("switches financing steps to Not needed and back without losing completion, appointments, dates or private notes", async () => {
  const file = await fixture();
  const loan = (await steps(file.id)).find(
    (step) => step.stepKey === "loan_application",
  )!;
  await prisma.task.update({
    where: { id: loan.id },
    data: {
      status: "completed",
      details: { note: "Retain this evidence", showNoteToAgent: false },
    },
  });
  const before = await steps(file.id);
  const cash = await save(file.id, {
    expectedRevision: file.revision,
    purchaseType: "cash",
  });
  const cashSteps = await steps(file.id);
  expect(
    cashSteps.find((step) => step.stepKey === "preapproval_pof")?.title,
  ).toBe("Proof of Funds");
  expect(
    cashSteps
      .filter((step) =>
        ["loan_application", "loan_commitment"].includes(step.stepKey!),
      )
      .every((step) => step.status === "not_applicable"),
  ).toBe(true);
  expect(await getMatter(agent, file.id)).toMatchObject({ id: file.id });
  await save(file.id, {
    expectedRevision: cash.revision,
    purchaseType: "financed",
  });
  const restored = await steps(file.id);
  expect(
    restored.map(
      ({
        id,
        title,
        status,
        dueDate,
        dueAt,
        actualDate,
        actualAt,
        dateRule,
        details,
      }) => ({
        id,
        title,
        status,
        dueDate,
        dueAt,
        actualDate,
        actualAt,
        dateRule,
        details,
      }),
    ),
  ).toEqual(
    before.map(
      ({
        id,
        title,
        status,
        dueDate,
        dueAt,
        actualDate,
        actualAt,
        dateRule,
        details,
      }) => ({
        id,
        title,
        status,
        dueDate,
        dueAt,
        actualDate,
        actualAt,
        dateRule,
        details,
      }),
    ),
  );
  expect(
    await prisma.matter.findUniqueOrThrow({ where: { id: file.id } }),
  ).toMatchObject({ details: file.details });
});

it("enables financing on a file created as cash, preserving deliberately skipped and manually changed work on later switches", async () => {
  const file = await fixture("weatherly", "seller", "cash");
  const financed = await save(file.id, {
    expectedRevision: file.revision,
    purchaseType: "financed",
  });
  expect(
    (await steps(file.id))
      .filter((step) =>
        ["loan_application", "loan_commitment"].includes(step.stepKey!),
      )
      .map((step) => step.status),
  ).toEqual(["pending", "pending"]);
  const commitment = (await steps(file.id)).find(
    (step) => step.stepKey === "loan_commitment",
  )!;
  await prisma.task.update({
    where: { id: commitment.id },
    data: { status: "not_applicable" },
  });
  const cash = await save(file.id, {
    expectedRevision: financed.revision,
    purchaseType: "cash",
  });
  const loan = (await steps(file.id)).find(
    (step) => step.stepKey === "loan_application",
  )!;
  await prisma.task.update({
    where: { id: loan.id },
    data: { status: "completed" },
  });
  await save(file.id, {
    expectedRevision: cash.revision,
    purchaseType: "financed",
  });
  expect(
    (await steps(file.id)).find((step) => step.id === loan.id)?.status,
  ).toBe("completed");
  expect(
    (await steps(file.id)).find((step) => step.id === commitment.id)?.status,
  ).toBe("not_applicable");
});

it("clears amounts and holder/company text without resurrecting older aliases", async () => {
  const file = await fixture();
  const emd = (await steps(file.id)).find(
    (step) => step.stepKey === "earnest_money_due",
  )!;
  await prisma.task.update({
    where: { id: emd.id },
    data: {
      details: {
        earnestMoneyCents: 10000,
        earnestMoneyHolder: "Old company",
        note: "Keep note",
      },
    },
  });
  await save(file.id, {
    expectedRevision: file.revision,
    earnestMoneyCents: null,
    earnestMoneyHolder: "",
  });
  expect(await fields(file.id)).toMatchObject({
    emd_amount: null,
    emd_holder: null,
  });
  expect(
    await prisma.task.findUniqueOrThrow({ where: { id: emd.id } }),
  ).toMatchObject({
    details: { amountCents: null, holder: "", note: "Keep note" },
  });
});

it("rolls back price, type and checklist amount edits together if the change hook fails", async () => {
  const file = await fixture();
  const before = await steps(file.id);
  registerMatterChangeHook(async () => {
    throw Error("Synthetic failure");
  });
  try {
    await expect(
      save(file.id, {
        expectedRevision: file.revision,
        purchaseType: "cash",
        purchasePriceCents: 30000000,
        earnestMoneyCents: 12000,
      }),
    ).rejects.toThrow("Synthetic failure");
    expect(
      await prisma.matter.findUniqueOrThrow({ where: { id: file.id } }),
    ).toEqual(file);
    expect(await steps(file.id)).toEqual(before);
    expect(
      await prisma.auditEvent.count({ where: { matterId: file.id } }),
    ).toBe(0);
  } finally {
    registerMatterChangeHook();
  }
});

it("serves the coordinator facts route, rejects agents, unknown fields, bad amounts and stale saves", async () => {
  const file = await fixture();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.principal = req.get("x-test-agent") ? agent : owner;
    next();
  });
  app.use("/matters", createMattersRouter({ canonicalCreation: true }));
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(
          error instanceof HttpError
            ? error.status
            : error instanceof ZodError
              ? 422
              : 500,
        )
        .json(sanitizeError(error));
    },
  );
  const path = `/matters/${file.id}/facts`;
  await request(app)
    .patch(path)
    .set("x-test-agent", "true")
    .send({ expectedRevision: file.revision, purchasePriceCents: 30000000 })
    .expect(403);
  await request(app)
    .patch(path)
    .send({ expectedRevision: file.revision, purchasePriceCents: -1 })
    .expect(422);
  await request(app)
    .patch(path)
    .send({ expectedRevision: file.revision, business: "hto" })
    .expect(422);
  const saved = await request(app)
    .patch(path)
    .send({ expectedRevision: file.revision, purchasePriceCents: 30000000 })
    .expect(200);
  expect(saved.headers["cache-control"]).toBe("private, no-store");
  await request(app)
    .patch(path)
    .send({ expectedRevision: file.revision, purchasePriceCents: 40000000 })
    .expect(409);
  expect(
    (
      await prisma.matter.findUniqueOrThrow({ where: { id: file.id } })
    ).purchasePriceCents?.toNumber(),
  ).toBe(30000000);
});
