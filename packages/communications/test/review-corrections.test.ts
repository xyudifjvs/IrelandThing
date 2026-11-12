import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import { prisma } from "@weatherly/db";
import { encryptSecret, type Principal } from "@weatherly/platform";
import {
  addMatterPerson,
  updateMatterPerson,
} from "../../matters/src/people/commands";
import { createCommunicationsService } from "../src/service";
import { createCommunicationJobHandlers } from "../src/jobs";
import { seedPlaceholderEmailTemplates } from "../src/placeholder-templates";

const run = randomUUID();
const owner: Principal = {
  id: `r07-owner-${run}`,
  email: `owner-${run}@example.test`,
  name: "Synthetic coordinator",
  role: "coordinator",
  sessionId: run,
};
const oldEmail = "old-lender@example.test";
const newEmail = "new-lender@example.test";
const outside = "new-recipient@example.test";
const matterIds: string[] = [];
const templateIds: string[] = [];
const sent: unknown[] = [];
const tokens = {
  access_token: "synthetic",
  refresh_token: "synthetic",
  expiry_date: Date.now() + 600000,
};
const service = createCommunicationsService({
  config: {
    enabled: true,
    outboundEnabled: true,
    mailbox: owner.email,
    clientId: "synthetic",
    clientSecret: "synthetic",
    redirectUri: "http://127.0.0.1/callback",
  },
  provider: {
    authorizationUrl: () => {
      throw new Error("Unexpected OAuth");
    },
    exchange: async () => {
      throw new Error("Unexpected OAuth");
    },
    revoke: async () => {
      throw new Error("Unexpected revocation");
    },
    async request<T>(
      _tokens: unknown,
      endpoint: string,
      _method?: "GET" | "POST",
      body?: unknown,
    ) {
      expect(endpoint).toBe("/messages/send");
      sent.push(body);
      return {
        tokens,
        data: {
          id: `synthetic-${run}-${sent.length}`,
          threadId: `synthetic-thread-${sent.length}`,
        } as T,
      };
    },
  },
});
const jobs = createCommunicationJobHandlers(service);

beforeAll(async () => {
  await prisma.user.create({
    data: {
      id: owner.id,
      email: owner.email,
      name: owner.name,
      role: owner.role,
    },
  });
  await prisma.integrationConnection.create({
    data: {
      ownerId: owner.id,
      provider: "gmail",
      status: "connected",
      displayEmail: owner.email,
      credentials: encryptSecret(JSON.stringify(tokens)),
    },
  });
});

afterAll(async () => {
  await prisma.emailThread.deleteMany({ where: { ownerId: owner.id } });
  await prisma.emailDraft.deleteMany({ where: { createdById: owner.id } });
  await prisma.matter.deleteMany({ where: { id: { in: matterIds } } });
  await prisma.communicationTemplate.deleteMany({
    where: { id: { in: templateIds } },
  });
  await prisma.integrationConnection.deleteMany({
    where: { ownerId: owner.id },
  });
  await prisma.auditEvent.deleteMany({ where: { actorId: owner.id } });
  await prisma.outboxJob.deleteMany({
    where: {
      topic: "gmail.send",
      payload: { path: ["ownerId"], equals: owner.id },
    },
  });
  await prisma.user.delete({ where: { id: owner.id } });
});

async function file(checklistVersion: number | null = 1) {
  const row = await prisma.matter.create({
    data: {
      title: "Synthetic email review",
      propertyAddress: "1 Synthetic Lane",
      side: "buyer",
      packageCode: "essentials",
      checklistVersion,
      details:
        checklistVersion === null
          ? { contacts: [{ role: "lender", email: oldEmail }] }
          : {},
    },
  });
  matterIds.push(row.id);
  return row;
}

async function template(extra: Record<string, unknown> = {}) {
  const row = await service.saveTemplate(owner, {
    name: `Synthetic template ${run}`,
    side: "buyer",
    phase: "closing",
    subject: "Reviewed subject",
    body: "Reviewed wording",
    ...extra,
  });
  templateIds.push(row.id);
  return row;
}

function draft(
  matterId: string,
  to: string,
  binding?: { id: string; revision: number },
) {
  return service.createDraft(owner, {
    matterId,
    to: [to],
    subject: "Reviewed subject",
    body: "Coordinator’s saved wording",
    ...(binding
      ? { templateId: binding.id, templateRevision: binding.revision }
      : {}),
  });
}

function approve(row: { id: string; revision: number }) {
  return service.queueSend(owner, row.id, {
    revision: row.revision,
    confirmed: true,
  });
}

function dispatch(row: { id: string; sendKey: string | null }) {
  return jobs["gmail.send"]({
    draftId: row.id,
    ownerId: owner.id,
    sendKey: row.sendKey,
  });
}

it("requires saved recipient evidence and never reclassifies a replaced file recipient as an outsider", async () => {
  const matter = await file();
  const old = await addMatterPerson(owner, matter.id, {
    name: "Old lender",
    role: "lender",
    email: oldEmail,
    phone: "",
  });
  const stale = await draft(matter.id, oldEmail);
  const alreadyApproved = await approve(await draft(matter.id, oldEmail));
  const current = await addMatterPerson(owner, matter.id, {
    name: "New lender",
    role: "lender",
    email: newEmail,
    phone: "",
    replace: { id: old.id, expectedRevision: old.revision },
  });
  await expect(approve(stale)).rejects.toMatchObject({
    code: "RECIPIENT_RETIRED",
  });
  await expect(dispatch(alreadyApproved)).rejects.toMatchObject({
    code: "RECIPIENT_RETIRED",
  });
  expect(sent).toHaveLength(0);
  expect(
    await prisma.businessContact.count({
      where: { ownerId: owner.id, email: oldEmail, usageCount: { gt: 1 } },
    }),
  ).toBe(0);
  const corrected = await service.updateDraft(owner, stale.id, {
    expectedRevision: stale.revision,
    to: [newEmail],
  });
  const renamed = await updateMatterPerson(owner, matter.id, current.id, {
    expectedRevision: current.revision,
    name: "Corrected lender",
  });
  expect(renamed).toMatchObject({ revision: current.revision + 1 });
  await expect(approve(corrected)).rejects.toMatchObject({
    code: "RECIPIENT_POLICY_CHANGED",
  });
  const outsider = await approve(await draft(matter.id, outside));
  await dispatch(outsider);
  await dispatch(outsider);
  expect(sent).toHaveLength(1);
  expect(
    await prisma.matterContact.count({
      where: { matterId: matter.id, email: outside },
    }),
  ).toBe(0);
});

it("blocks placeholders at legacy approval and dispatch while allowing the draft to be recovered", async () => {
  const matter = await file(null);
  const blocked = await template({ isPlaceholder: true });
  await expect(
    approve(await draft(matter.id, oldEmail, blocked)),
  ).rejects.toMatchObject({ code: "TEMPLATE_PLACEHOLDER" });
  const approved = await template({ isPlaceholder: false });
  const queued = await approve(await draft(matter.id, oldEmail, approved));
  const priorSends = sent.length;
  await prisma.communicationTemplate.update({
    where: { id: approved.id },
    data: { isPlaceholder: true },
  });
  await expect(dispatch(queued)).rejects.toMatchObject({
    code: "TEMPLATE_PLACEHOLDER",
  });
  expect(sent).toHaveLength(priorSends);
  const recovered = await prisma.emailDraft.findUniqueOrThrow({
    where: { id: queued.id },
  });
  expect(recovered).toMatchObject({
    status: "draft",
    sendKey: null,
    approvedAt: null,
    details: { sendFailure: "TEMPLATE_PLACEHOLDER" },
  });
  await expect(
    service.deleteDraft(owner, recovered.id, recovered.revision),
  ).resolves.toEqual({ cancelled: true });
});

it("releases a template work slot on a definite rejection and preserves draft wording across package changes", async () => {
  const matter = await file();
  const prior = await template({ serviceGroup: "buyer_ctc" });
  const current = await template({ serviceGroup: "buyer_compliance" });
  const stale = await approve(await draft(matter.id, outside, prior));
  await prisma.matter.update({
    where: { id: matter.id },
    data: { revision: { increment: 1 }, propertyAddress: "2 Synthetic Lane" },
  });
  await expect(dispatch(stale)).rejects.toMatchObject({
    code: "SOURCE_MATTER_CHANGED",
  });
  const next = await draft(matter.id, outside, prior);
  expect(next.workItemId).toBe(stale.workItemId);
  const replacement = await approve(next);
  expect(replacement).toMatchObject({
    status: "queued",
    workItemId: stale.workItemId,
  });
  await prisma.matter.update({
    where: { id: matter.id },
    data: { revision: { increment: 1 } },
  });
  await expect(dispatch(replacement)).rejects.toMatchObject({
    code: "SOURCE_MATTER_CHANGED",
  });
  await prisma.$transaction(async (tx) => {
    await tx.matter.update({
      where: { id: matter.id },
      data: { packageCode: "complete", revision: { increment: 1 } },
    });
    await service.refreshTemplateDrafts(owner, matter.id, tx);
  });
  const marked = await prisma.emailDraft.findUniqueOrThrow({
    where: { id: next.id },
  });
  expect(marked).toMatchObject({
    body: "Coordinator’s saved wording",
    details: { templateNeedsRebind: true, reviewNeeded: true },
  });
  await expect(approve(marked)).rejects.toMatchObject({
    code: "TEMPLATE_CHANGED",
  });
  const rebound = await service.resetTemplate(owner, marked.id, {
    expectedRevision: marked.revision,
    templateId: current.id,
  });
  expect(rebound.body).toBe(marked.body);
  expect(rebound.workItemId).not.toBe(stale.workItemId);
  await expect(approve(rebound)).resolves.toMatchObject({ status: "queued" });
});

it("creates editable placeholders once and preserves archived and existing templates on setup replay", async () => {
  const own = await template();
  const prefix = "weatherly-email-placeholder-";
  await seedPlaceholderEmailTemplates();
  const rows = await prisma.communicationTemplate.findMany({
    where: { id: { startsWith: prefix } },
  });
  templateIds.push(...rows.map(({ id }) => id));
  expect(new Set(rows.map(({ side }) => side))).toEqual(
    new Set(["buyer", "seller"]),
  );
  expect(rows.every(({ isPlaceholder }) => isPlaceholder)).toBe(true);
  const [first] = rows;
  await prisma.communicationTemplate.update({
    where: { id: first.id },
    data: { active: false },
  });
  expect(await seedPlaceholderEmailTemplates()).toEqual({ count: 0 });
  expect(
    await prisma.communicationTemplate.findUniqueOrThrow({
      where: { id: first.id },
    }),
  ).toMatchObject({ active: false });
  expect(
    await prisma.communicationTemplate.findUniqueOrThrow({
      where: { id: own.id },
    }),
  ).toEqual(own);
});
