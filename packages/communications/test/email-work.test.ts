import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import {
  changeEmailWork,
  changeTemplateWork,
  listEmailWork,
  finishSentWork,
} from "../src/email-work";
import { invalidateFileEmailWork } from "../src/file-email-effects";
import { createCommunicationsService } from "../src/service";
import { mergeFields } from "../src/merge-fields";

const fixture = randomUUID();
const owner: Principal = {
  id: "email-work-" + fixture,
  name: "Synthetic Coordinator",
  email: fixture + "@example.test",
  role: "coordinator",
  sessionId: fixture,
};
const service = createCommunicationsService();
let matterId: string;
const templateIds: string[] = [];

beforeAll(async () => {
  await prisma.user.create({
    data: {
      id: owner.id,
      name: owner.name,
      email: owner.email,
      role: "coordinator",
    },
  });
  const matter = await prisma.matter.create({
    data: {
      title: "Synthetic Email Work",
      propertyAddress: "1 Test Lane",
      side: "buyer",
      packageCode: "essentials",
      checklistVersion: 1,
      purchasePriceCents: 12345678,
      acceptanceDate: "2027-01-09",
    },
  });
  matterId = matter.id;
});

afterAll(async () => {
  await prisma.emailDraft.deleteMany({ where: { matterId } });
  await prisma.matter.deleteMany({ where: { id: matterId } });
  await prisma.communicationTemplate.deleteMany({
    where: { id: { in: templateIds } },
  });
  await prisma.auditEvent.deleteMany({ where: { actorId: owner.id } });
  await prisma.user.deleteMany({ where: { id: owner.id } });
});

async function template(name: string) {
  const created = await service.saveTemplate(owner, {
    name: name + " " + fixture,
    side: "buyer",
    phase: "closing",
    subject: "Closing for {{propertyAddress}}",
    body: "Closing date {{closingDate}}. Thank you.",
    recipientGroup: "Buyer",
    linkedStepKey: "closing",
  });
  templateIds.push(created.id);
  return created;
}

it("keeps undated Later, dated reminders, and manual and actual completion distinct", async () => {
  const first = await template("First");
  const second = await template("Second");
  const later = await changeTemplateWork(owner, matterId, first.id, {
    action: "later",
    expectedRevision: null,
  });
  const dated = await changeTemplateWork(owner, matterId, second.id, {
    action: "remind",
    expectedRevision: null,
    remindOn: "2027-02-03",
  });
  expect(
    (await listEmailWork(owner, { matterId })).map(({ id }) => id),
  ).toEqual([dated.id, later.id]);
  expect(
    (
      await listEmailWork(owner, {
        matterId,
        from: "2027-02-01",
        through: "2027-02-07",
      })
    ).map(({ id }) => id),
  ).toEqual([dated.id]);
  await expect(
    changeEmailWork(owner, later.id, {
      action: "manual_complete",
      expectedRevision: 1,
    }),
  ).rejects.toMatchObject({ status: 409 });
  const manual = await changeEmailWork(owner, later.id, {
    action: "manual_complete",
    expectedRevision: later.revision,
  });
  expect(manual.manualCompletedAt).toBeInstanceOf(Date);
  expect(manual.sentAt).toBeNull();
  await changeEmailWork(owner, later.id, {
    action: "uncheck",
    expectedRevision: manual.revision,
  });
  const sentAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.emailDraft.create({
      data: {
        matterId,
        workItemId: dated.id,
        createdById: owner.id,
        to: ["synthetic@example.test"],
        subject: "Synthetic",
        body: "Synthetic",
        status: "sent",
        sentAt,
      },
    });
    await finishSentWork(tx, dated.id);
  });
  expect(await listEmailWork(owner, { matterId })).toEqual([]);
  const delivered = (
    await listEmailWork(owner, { matterId, view: "all" })
  ).find(({ id }) => id === dated.id);
  expect(delivered).toMatchObject({
    sentAt,
    manualCompletedAt: null,
    remindOn: null,
  });
  expect(
    await prisma.outboxJob.count({
      where: {
        topic: "gmail.send",
        payload: { path: ["ownerId"], equals: owner.id },
      },
    }),
  ).toBe(0);
  await expect(
    listEmailWork({ ...owner, role: "agent" }, { matterId }),
  ).rejects.toMatchObject({ status: 403 });
});

it("uses keyed dates and immutable file contacts for editable blank merge values", async () => {
  const closing = await template("Third");
  await prisma.deadline.create({
    data: {
      matterId,
      label: "Closing",
      date: "2027-09-01",
      status: "confirmed",
    },
  });
  await prisma.task.create({
    data: { matterId, title: "Legacy closing", dueDate: "2027-10-01" },
  });
  const rendered = await service.renderTemplate(owner, closing.id, {
    matterId,
  });
  expect(rendered.body).toBe("Closing date . Thank you.");
  expect(rendered.missingBodyFields).toEqual(["closingDate"]);
  await prisma.task.create({
    data: {
      matterId,
      title: "Closing",
      stepKey: "closing",
      dueDate: "2027-02-03",
      dateCapable: true,
    },
  });
  const fields = await mergeFields(owner, matterId);
  expect(fields.find(({ key }) => key === "closingDate")?.value).toBe(
    "2027-02-03",
  );
  expect(fields.find(({ key }) => key === "purchasePrice")?.value).toBe(
    "$123,456.78",
  );
  const draft = await service.createDraft(owner, {
    matterId,
    to: ["external-recipient@example.test"],
    subject: "A real draft",
    body: "Synthetic correspondence",
  });
  expect(draft.workItemId).toBeTruthy();
  const scheduled = await changeEmailWork(owner, draft.workItemId!, {
    action: "remind",
    expectedRevision: 1,
    remindOn: "2027-02-04",
  });
  expect(scheduled.toSend).toBe(true);
  await prisma.$transaction((tx) =>
    invalidateFileEmailWork(tx, matterId, "terminate"),
  );
  expect(await listEmailWork(owner, { matterId })).toEqual([]);
  expect(
    (await prisma.emailDraft.findUnique({ where: { id: draft.id } }))?.status,
  ).toBe("cancelled");
});
