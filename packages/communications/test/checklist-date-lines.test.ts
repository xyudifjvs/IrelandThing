import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { simpleParser } from "mailparser";
import { prisma } from "@weatherly/db";
import { encryptSecret, type Principal } from "@weatherly/platform";
import { seedMatterChecklist } from "../../matters/src/checklist/persistence";
import { mergeFields } from "../src/merge-fields";
import {
  renderEmailFields,
  validateAuthoredMergeFields,
} from "../src/render-email-fields";
import { createCommunicationsService } from "../src/service";
import { createCommunicationJobHandlers } from "../src/jobs";
import {
  clientTemplateDefault,
  hideNotNeededLines,
} from "../src/template-line-policy";

const prefix = `date-lines-${randomUUID()}`;
const actor: Principal = {
  id: prefix,
  name: "Synthetic coordinator",
  email: `${prefix}@example.test`,
  role: "coordinator",
  sessionId: prefix,
};
const agentId = prefix + "-agent";
const files: string[] = [],
  templates: string[] = [];
const sent: string[] = [];
const oldKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
const tokens = {
  access_token: "synthetic",
  refresh_token: "synthetic",
  expiry_date: Date.now() + 600000,
};
const service = createCommunicationsService({
  config: {
    enabled: true,
    outboundEnabled: true,
    mailbox: actor.email,
    clientId: "synthetic",
    clientSecret: "synthetic",
    redirectUri: "http://127.0.0.1/callback",
  },
  provider: {
    authorizationUrl: () => {
      throw Error("No OAuth expected");
    },
    exchange: async () => {
      throw Error("No OAuth expected");
    },
    revoke: async () => {},
    async request<T>(
      _tokens: unknown,
      endpoint: string,
      _method?: string,
      body?: unknown,
    ) {
      expect(endpoint).toBe("/messages/send");
      sent.push(String((body as { raw: string }).raw));
      return {
        tokens,
        data: {
          id: `${prefix}-${sent.length}`,
          threadId: prefix + "-thread",
        } as T,
      };
    },
  },
});
const jobs = createCommunicationJobHandlers(service);
const source =
  "Attorney Review: {{attorney_review_deadline}}\nHOA Review: {{hoa_review_deadline}}\nWarranty: {{warranty_deadline}}\nAppraisal Ordered: {{appraisal_ordered_deadline}}\nClosing: {{closing_date}}";
beforeAll(async () => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString(
    "base64",
  );
  await prisma.user.createMany({
    data: [
      {
        id: actor.id,
        name: actor.name,
        email: actor.email,
        role: "coordinator",
      },
      {
        id: agentId,
        name: "Synthetic Agent",
        email: `${agentId}@example.test`,
        role: "agent",
      },
    ],
  });
  await prisma.integrationConnection.create({
    data: {
      ownerId: actor.id,
      provider: "gmail",
      status: "connected",
      displayEmail: actor.email,
      credentials: encryptSecret(JSON.stringify(tokens)),
    },
  });
});
afterAll(async () => {
  await prisma.emailThread.deleteMany({ where: { ownerId: actor.id } });
  await prisma.emailDraft.deleteMany({ where: { createdById: actor.id } });
  await prisma.matter.deleteMany({ where: { id: { in: files } } });
  await prisma.communicationTemplate.deleteMany({
    where: { id: { in: templates } },
  });
  await prisma.integrationConnection.deleteMany({
    where: { ownerId: actor.id },
  });
  await prisma.auditEvent.deleteMany({ where: { actorId: actor.id } });
  await prisma.outboxJob.deleteMany({
    where: {
      topic: "gmail.send",
      payload: { path: ["ownerId"], equals: actor.id },
    },
  });
  await prisma.user.deleteMany({ where: { id: { in: [actor.id, agentId] } } });
  if (oldKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_KEY = oldKey;
});
async function file(side: "buyer" | "seller" = "buyer") {
  const row = await prisma.matter.create({
    data: {
      title: "Synthetic date lines",
      propertyAddress: "123 Synthetic Lane",
      side,
      packageCode: "essentials",
      agentId,
      details: { purchaseType: "financed", directContact: "copy_agent" },
    },
  });
  files.push(row.id);
  await prisma.$transaction((tx) =>
    seedMatterChecklist(tx, row.id, {
      side,
      purchaseType: "financed",
      acceptance: null,
      timeZone: "America/New_York",
      dates: [
        {
          key: "attorney_review",
          notNeeded: true,
          value: { date: "2027-08-20", instant: null },
          rule: { kind: "fixed" },
        },
        {
          key: side === "seller" ? "home_warranty" : "home_warranty_ordered",
          notNeeded: true,
          value: null,
          rule: { kind: "fixed" },
        },
        {
          key: "closing",
          value: { date: "2027-09-21", instant: null },
          rule: { kind: "fixed" },
          dateWording: "On or before 9/21",
        },
        {
          key: "condo_hoa_doc_review",
          value: null,
          rule: { kind: "fixed" },
          dateWording: "Received",
        },
      ],
    }),
  );
  const recipient = `${row.id}@example.test`;
  await prisma.matterContact.create({
    data: {
      matterId: row.id,
      role: "client",
      name: "Synthetic Client",
      email: recipient,
    },
  });
  return { ...row, recipient };
}
async function template(extra: Record<string, unknown> = {}) {
  const row = await service.saveTemplate(actor, {
    name: prefix,
    side: "both",
    phase: "general",
    subject: "Transaction dates",
    body: source,
    ...extra,
  });
  templates.push(row.id);
  return row;
}

it.each(["buyer", "seller"] as const)(
  "resolves %s skipped dates to N/A, undated steps to blank and wording exactly",
  async (side) => {
    const matter = await file(side);
    const fields = Object.fromEntries(
      (await mergeFields(actor, matter.id)).map((field) => [
        field.key,
        field.value,
      ]),
    );
    expect(fields).toMatchObject({
      attorney_review_deadline: "N/A",
      warranty_deadline: "N/A",
      hoa_review_deadline: "Received",
      appraisal_ordered_deadline: null,
      closing_date: "On or before 9/21",
    });
    const result = await renderEmailFields(actor, matter.id, "Dates", source);
    expect(result.body).toBe(
      "Attorney Review: N/A\nHOA Review: Received\nWarranty: N/A\nAppraisal Ordered: \nClosing: On or before 9/21",
    );
    expect(result.missingFields).toEqual([]);
    expect(result.body).not.toContain("{{");
  },
);

it("defaults to hiding skipped lines for client templates, while agent/title/lender templates retain N/A", async () => {
  const matter = await file();
  for (const role of [
    "client",
    "my_agent",
    "co_op_agent",
    "title_rep",
    "lender",
  ]) {
    const row = await template({ recipientRoles: [role] });
    const result = await service.renderTemplate(actor, row.id, {
      matterId: matter.id,
    });
    expect(row.hideNotNeededLines).toBe(role === "client");
    expect(result.body.includes("Attorney Review:")).toBe(role !== "client");
    expect(result.body.includes("Warranty:")).toBe(role !== "client");
    expect(result.body).toContain("Appraisal Ordered: ");
    expect(result.missingFields).toEqual([]);
  }
});

it("preserves explicit per-template choices through a new version and supports legacy client-group defaults", async () => {
  const matter = await file();
  const row = await template({
    recipientRoles: ["client"],
    hideNotNeededLines: false,
  });
  expect(
    (await service.renderTemplate(actor, row.id, { matterId: matter.id })).body,
  ).toContain("Attorney Review: N/A");
  const saved = await service.saveTemplate(
    actor,
    {
      name: row.name,
      side: row.side,
      phase: row.phase,
      subject: row.subject,
      body: row.body,
      expectedRevision: row.revision,
      hideNotNeededLines: true,
    },
    row.id,
  );
  templates.push(saved.id);
  expect(saved.recipientRoles).toEqual(["client"]);
  expect(
    (await service.renderTemplate(actor, saved.id, { matterId: matter.id }))
      .body,
  ).not.toContain("Attorney Review:");
  const legacy = await template({ recipientGroup: "To seller" });
  await prisma.communicationTemplate.update({
    where: { id: legacy.id },
    data: { hideNotNeededLines: null },
  });
  expect(
    (await service.renderTemplate(actor, legacy.id, { matterId: matter.id }))
      .body,
  ).not.toContain("Attorney Review:");
  expect(clientTemplateDefault({ recipientGroup: "To buyer’s agent" })).toBe(
    false,
  );
  expect(clientTemplateDefault({ recipientGroup: "To buyer and title" })).toBe(
    true,
  );
  expect(clientTemplateDefault({ recipientRoles: ["client", "lender"] })).toBe(
    true,
  );
  expect(
    hideNotNeededLines({
      recipientRoles: ["client"],
      hideNotNeededLines: false,
    }),
  ).toBe(false);
});

it("uses checklist state rather than literal N/A text to omit a line, with aliases and CRLF handled", async () => {
  const matter = await file();
  const row = await template({
    recipientRoles: ["client"],
    body: "Keep literal N/A\r\nAttorney: {{deadline_attorney_review}}\r\nNeeded: {{hoa_review_deadline}}\r\n",
  });
  const hoa = await prisma.task.findFirstOrThrow({
    where: { matterId: matter.id, stepKey: "condo_hoa_doc_review" },
  });
  await prisma.task.update({
    where: { id: hoa.id },
    data: { details: { dateWording: "N/A" } },
  });
  const result = await service.renderTemplate(actor, row.id, {
    matterId: matter.id,
  });
  expect(result.body).toBe("Keep literal N/A\nNeeded: N/A\n");
});

it("blanks unknown/missing codes in preview without allowing missing non-date fields through the send gate", async () => {
  const matter = await file();
  const preview = await renderEmailFields(
    actor,
    matter.id,
    "Dates",
    "Appraisal: {{appraisal_ordered_deadline}}\nUnknown: {{not_a_field}}\nLender: {{lender_name}}",
  );
  expect(preview.body).toBe("Appraisal: \nUnknown: \nLender: ");
  expect(preview.missingFields.sort()).toEqual(["lender_name", "not_a_field"]);
  const draft = await service.createDraft(actor, {
    matterId: matter.id,
    subject: "Dates",
    body: "Lender: {{lender_name}}",
    to: [],
    saveForLater: true,
  });
  await expect(validateAuthoredMergeFields(actor, draft)).rejects.toMatchObject(
    { code: "MISSING_MERGE_FIELD" },
  );
});

it("keeps edited-email previews and saved drafts bound to the template setting and invalidates a changed checklist", async () => {
  const matter = await file();
  const row = await template({ recipientRoles: ["client"] });
  const body = source + "\nAdded coordinator wording.";
  const preview = await renderEmailFields(
    actor,
    matter.id,
    row.subject,
    body,
    undefined,
    {},
    row.id,
  );
  const draft = await service.createDraft(actor, {
    matterId: matter.id,
    subject: row.subject,
    body,
    to: [],
    saveForLater: true,
    templateId: row.id,
    templateRevision: row.revision,
    fieldPreviewFingerprint: preview.fingerprint,
  });
  expect(draft.body).toBe(preview.body);
  expect(draft.body).not.toContain("Attorney Review:");
  await validateAuthoredMergeFields(actor, draft);
  const task = await prisma.task.findFirstOrThrow({
    where: { matterId: matter.id, stepKey: "attorney_review" },
  });
  await prisma.task.update({
    where: { id: task.id },
    data: { status: "pending", revision: { increment: 1 } },
  });
  await expect(validateAuthoredMergeFields(actor, draft)).rejects.toMatchObject(
    { code: "SOURCE_PREVIEW_CHANGED" },
  );
});

it("keeps ambiguous date sources reviewable rather than hiding their lines", async () => {
  const matter = await file();
  const row = await template({ recipientRoles: ["client"] });
  await prisma.matter.update({
    where: { id: matter.id },
    data: { details: { sourceConflicts: ["Synthetic unresolved evidence"] } },
  });
  const preview = await service.renderTemplate(actor, row.id, {
    matterId: matter.id,
  });
  expect(preview.body).toContain("Attorney Review:");
  expect(preview.missingBodyFields).toContain("attorney_review_deadline");
  expect(preview.body).not.toContain("{{");
});

it("uses current legacy checklist skips and exact display wording ahead of old deadline evidence", async () => {
  const row = await prisma.matter.create({
    data: {
      title: "Synthetic older file",
      propertyAddress: "1 Legacy Lane",
      side: "buyer",
      packageCode: "essentials",
    },
  });
  files.push(row.id);
  const task = await prisma.task.create({
    data: {
      matterId: row.id,
      title: "Attorney Review",
      status: "not_applicable",
    },
  });
  await prisma.deadline.create({
    data: {
      matterId: row.id,
      label: "Attorney Review",
      date: "2027-08-01",
      status: "confirmed",
    },
  });
  const first = await renderEmailFields(
    actor,
    row.id,
    "Dates",
    "Attorney: {{attorney_review_deadline}}\nAppraisal: {{appraisal_ordered_deadline}}",
  );
  expect(first.body).toBe("Attorney: N/A\nAppraisal: ");
  expect(first.missingFields).toEqual([]);
  await prisma.task.update({
    where: { id: task.id },
    data: { status: "pending", details: { dateWording: "Received" } },
  });
  expect(
    (
      await renderEmailFields(
        actor,
        row.id,
        "Dates",
        "Attorney: {{attorney_review_deadline}}",
      )
    ).body,
  ).toBe("Attorney: Received");
});

it("sends the reviewed client body through a fake provider with needed-undated labels and no raw merge codes", async () => {
  const matter = await file();
  const row = await template({ recipientRoles: ["client"] });
  const preview = await service.renderTemplate(actor, row.id, {
    matterId: matter.id,
  });
  const draft = await service.createDraft(actor, {
    matterId: matter.id,
    subject: preview.subject,
    body: preview.body,
    to: [matter.recipient],
    templateId: row.id,
    templateRevision: row.revision,
    templatePreviewFingerprint: preview.previewFingerprint,
  });
  const queued = await service.queueSend(actor, draft.id, {
    revision: draft.revision,
    confirmed: true,
  });
  await jobs["gmail.send"]({
    draftId: queued.id,
    ownerId: actor.id,
    sendKey: queued.sendKey,
  });
  const message = await simpleParser(Buffer.from(sent.at(-1)!, "base64url"));
  expect(message.text).toContain("Appraisal Ordered:");
  expect(message.text).not.toContain("Attorney Review:");
  expect(message.text).not.toContain("{{");
  expect(
    (await prisma.emailDraft.findUniqueOrThrow({ where: { id: draft.id } }))
      .status,
  ).toBe("sent");
});

it.each(["plain", "html"] as const)(
  "removes only the date-field By prefix in %s template subjects, bodies, composer previews and saved drafts",
  async (bodyFormat) => {
    const matter = await file();
    await prisma.task.updateMany({
      where: { matterId: matter.id, stepKey: "loan_application" },
      data: { dueDate: "2026-08-25", details: {} },
    });
    const subject =
      "Loan: By {{loan_app_deadline}} | Attorney: by {{attorney_review_deadline}} | HOA: By {{hoa_review_deadline}}";
    const body =
      bodyFormat === "html"
        ? "<p>Loan: By <strong><span>{{loan_app_deadline}}</span></strong></p><p>Attorney: <strong>by </strong><span>{{attorney_review_deadline}}</span></p><p>HOA: By <em>{{hoa_review_deadline}}</em></p><p>Closing: by {{closing_date}}</p>"
        : "Loan: By {{loan_app_deadline}}\nAttorney: by {{attorney_review_deadline}}\nHOA: By {{hoa_review_deadline}}\nClosing: by {{closing_date}}";
    const row = await template({
      subject,
      body,
      bodyFormat,
      recipientRoles: ["lender"],
    });
    const preview = await service.renderTemplate(actor, row.id, {
      matterId: matter.id,
    });
    expect(preview.subject).toBe(
      "Loan: By 8/25/26 | Attorney: N/A | HOA: Received",
    );
    expect(preview.body).toContain("Loan: By ");
    expect(preview.body).not.toMatch(
      /(?:By|by) (?:N\/A|Received|On or before)/,
    );
    expect(preview.body).toContain("On or before 9/21");
    const composer = await renderEmailFields(
      actor,
      matter.id,
      subject,
      body,
      undefined,
      {},
      row.id,
      bodyFormat,
    );
    expect(composer.subject).toBe(preview.subject);
    expect(composer.body).toBe(preview.body);
    const draft = await service.createDraft(actor, {
      matterId: matter.id,
      subject,
      body,
      bodyFormat,
      to: [],
      saveForLater: true,
      templateId: row.id,
      templateRevision: row.revision,
      fieldPreviewFingerprint: composer.fingerprint,
    });
    expect(draft.subject).toBe(preview.subject);
    expect(draft.body).toBe(preview.body);
    await validateAuthoredMergeFields(actor, draft);
    // The saved template still contains Ireland's authored By/by text.
    expect(
      (
        await prisma.communicationTemplate.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).body,
    ).toBe(body);
  },
);
