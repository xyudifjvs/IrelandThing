import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import { queueTerminatedServiceCheckouts } from "@weatherly/billing";
import { changeFileBusiness } from "../../src/commands/file-business";
import { registerMatterChangeHook } from "../../src/change-hook";

const fixture = randomUUID();
const owner: Principal = {
  id: `business-owner-${fixture}`,
  name: "Synthetic Coordinator",
  email: `${fixture}@example.test`,
  role: "coordinator",
  sessionId: fixture,
};
const fileId = `business-file-${fixture}`;
const orderId = `business-order-${fixture}`;
const terms = {
  code: "essentials",
  name: "Frozen Essentials",
  priceCents: 42500,
  currency: "USD",
  revision: 3,
};
const hto = { business: "hto", packageCode: "hto_included" };
const essentials = { business: "weatherly", packageCode: "essentials" };
const fullService = { business: "weatherly", packageCode: "complete" };

beforeAll(async () => {
  await prisma.user.create({
    data: {
      id: owner.id,
      name: owner.name,
      email: owner.email,
      role: owner.role,
    },
  });
  await prisma.matter.create({
    data: {
      id: fileId,
      title: "Synthetic business change",
      propertyAddress: "3 Synthetic Lane",
      stage: "under_contract",
      side: "seller",
      business: "weatherly",
      packageCode: "essentials",
      checklistVersion: 1,
      details: { serviceSnapshot: terms, retained: "source data" },
    },
  });
  await prisma.task.create({
    data: {
      matterId: fileId,
      title: "Closing",
      stepKey: "closing",
      dueDate: "2027-05-08",
      dateCapable: true,
    },
  });
  await prisma.paymentOrder.create({
    data: {
      id: orderId,
      matterId: fileId,
      createdById: owner.id,
      idempotencyKey: fixture,
      amountCents: terms.priceCents,
      currency: "USD",
      status: "pending",
      snapshot: terms,
      details: { paymentEnvironment: "test" },
    },
  });
});

afterEach(() => registerMatterChangeHook());
afterAll(async () => {
  await prisma.paymentOrder.deleteMany({ where: { matterId: fileId } });
  await prisma.matter.deleteMany({ where: { id: fileId } });
  await prisma.auditEvent.deleteMany({ where: { actorId: owner.id } });
  await prisma.user.deleteMany({ where: { id: owner.id } });
});

it("checks the coordinator, revision and pending service terms and rolls back the entire business switch if a hook fails", async () => {
  const original = await prisma.matter.findUniqueOrThrow({
    where: { id: fileId },
  });
  const input = { expectedRevision: original.revision, business: hto };
  await expect(
    changeFileBusiness({ ...owner, role: "agent" }, fileId, input),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    changeFileBusiness(owner, fileId, {
      ...input,
      expectedRevision: original.revision + 1,
    }),
  ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  await expect(
    changeFileBusiness(owner, fileId, { ...input, business: fullService }),
  ).rejects.toMatchObject({ code: "EXISTING_SERVICE_ORDER" });
  registerMatterChangeHook(async () => {
    throw new Error("Synthetic downstream failure");
  });
  await expect(changeFileBusiness(owner, fileId, input)).rejects.toThrow(
    "Synthetic downstream failure",
  );
  expect(await prisma.matter.findUnique({ where: { id: fileId } })).toEqual(
    original,
  );
  expect(
    await prisma.auditEvent.count({
      where: { matterId: fileId, action: "matter.business_changed" },
    }),
  ).toBe(0);
});

it("switches to HTO and cancels the outstanding fee while preserving checklist and paid history", async () => {
  const original = await prisma.matter.findUniqueOrThrow({
    where: { id: fileId },
  });
  const priorTask = await prisma.task.findFirstOrThrow({
    where: { matterId: fileId },
  });
  registerMatterChangeHook(async (tx, actor, matterId) => {
    await queueTerminatedServiceCheckouts(tx, actor, matterId);
  });
  const result = await changeFileBusiness(owner, fileId, {
    expectedRevision: original.revision,
    business: hto,
  });
  expect(result).toMatchObject({ ...hto, revision: original.revision + 1 });
  expect(
    (await prisma.matter.findUniqueOrThrow({ where: { id: fileId } })).details,
  ).toEqual({ retained: "source data" });
  expect(await prisma.task.findUnique({ where: { id: priorTask.id } })).toEqual(
    priorTask,
  );
  const order = await prisma.paymentOrder.findUniqueOrThrow({
    where: { id: orderId },
  });
  expect(order).toMatchObject({ status: "cancelled", snapshot: terms });
  await prisma.paymentOrder.update({
    where: { id: orderId },
    data: { status: "paid" },
  });
  const returned = await changeFileBusiness(owner, fileId, {
    expectedRevision: result.revision,
    business: essentials,
  });
  expect(returned).toMatchObject({
    ...essentials,
    revision: result.revision + 1,
  });
  expect(
    (await prisma.matter.findUniqueOrThrow({ where: { id: fileId } })).details,
  ).toMatchObject({ serviceSnapshot: terms });
  await prisma.matter.update({
    where: { id: fileId },
    data: { stage: "closed" },
  });
  await expect(
    changeFileBusiness(owner, fileId, {
      expectedRevision: returned.revision,
      business: hto,
    }),
  ).rejects.toMatchObject({ code: "TRANSACTION_READ_ONLY" });
});
