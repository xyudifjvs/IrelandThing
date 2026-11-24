import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { simpleParser } from "mailparser";
import { prisma } from "@weatherly/db";
import { encryptSecret, type Principal } from "@weatherly/platform";
import { seedMatterChecklist } from "../../matters/src/checklist/persistence";
import { saveMergeSettings } from "../src/field-sources";
import { sanitizeEmailHtml } from "../src/email-html";
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

const prefix = `rich-emails-${randomUUID()}`;
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
  await prisma.mergeFieldSettings.deleteMany({ where: { ownerId: actor.id } });
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

const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4XQAAAAASUVORK5CYII=";
const htmlBody =
  "<h2>Your file</h2><p>Address: <strong>{{property_address}}</strong></p><ul><li>Attorney: {{attorney_review_deadline}}</li><li>Appraisal Ordered: {{appraisal_ordered_deadline}}</li></ul><p>{{tc_signature}}</p>";

it("saves sanitized HTML templates and a separately formatted signature, then embeds the image in multipart MIME", async () => {
  const matter = await file();
  const settings = await saveMergeSettings(actor, {
    name: actor.name,
    signatureFormat: "html",
    signature: `<p><strong>Synthetic Coordinator</strong></p><p><img src="${image}" alt="Coordinator signature" width="240"></p>`,
    reviewLink: "",
    expectedRevision: null,
  });
  expect(settings.signatureFormat).toBe("html");
  const row = await template({
    body: htmlBody + "<script>bad()</script>",
    bodyFormat: "html",
    recipientRoles: ["client"],
  });
  expect(row.body).not.toContain("script");
  const preview = await service.renderTemplate(actor, row.id, {
    matterId: matter.id,
  });
  expect(preview.bodyFormat).toBe("html");
  expect(preview.body).toContain("<strong>123 Synthetic Lane</strong>");
  expect(preview.body).toContain("<strong>Synthetic Coordinator</strong>");
  expect(preview.body).toContain(image);
  expect(preview.body).not.toContain("Attorney:");
  expect(preview.body).toContain("Appraisal Ordered: </li>");
  expect(preview.missingFields).toEqual([]);
  const edited = preview.body + "<p><em>This email only.</em></p>";
  const draft = await service.createDraft(actor, {
    matterId: matter.id,
    subject: preview.subject,
    body: edited,
    bodyFormat: "html",
    to: [matter.recipient],
    templateId: row.id,
    templateRevision: row.revision,
    templatePreviewFingerprint: preview.previewFingerprint,
  });
  expect(draft.bodyFormat).toBe("html");
  expect(draft.body).toContain("This email only");
  expect(
    (
      await prisma.communicationTemplate.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).body,
  ).not.toContain("This email only");
  const queued = await service.queueSend(actor, draft.id, {
    revision: draft.revision,
    confirmed: true,
  });
  await jobs["gmail.send"]({
    draftId: queued.id,
    ownerId: actor.id,
    sendKey: queued.sendKey,
  });
  const message = await simpleParser(Buffer.from(sent.at(-1)!, "base64url"), {
    skipImageLinks: true,
  });
  expect(message.html).toContain("<strong>123 Synthetic Lane</strong>");
  expect(message.html).toContain("<em>This email only.</em>");
  expect(message.text).toContain("Appraisal Ordered:");
  expect(message.text).not.toContain("<strong>");
  expect(message.text).not.toContain("Attorney:");
  expect(message.html).not.toContain("<mark>");
  expect(message.html).not.toContain("data:image");
  expect(message.html).toContain("cid:");
  expect(message.attachments).toHaveLength(1);
  expect(message.attachments[0].contentType).toBe("image/png");
  expect(message.attachments[0].contentDisposition).toBe("inline");
  const saved = await prisma.emailMessage.findUniqueOrThrow({
    where: {
      providerMessageId: (
        await prisma.emailDraft.findUniqueOrThrow({ where: { id: queued.id } })
      ).providerMessageId!,
    },
  });
  expect(saved.text).toContain("This email only");
  expect(saved.html).toContain("<strong>");
});

it("keeps authored formatted fields tied to their reviewed sources and blocks required blanks", async () => {
  const matter = await file();
  const source =
    "<p><strong>{{property_address}}</strong></p><p>Optional date: {{appraisal_ordered_deadline}}</p>";
  const preview = await renderEmailFields(
    actor,
    matter.id,
    "Review",
    source,
    undefined,
    {},
    undefined,
    "html",
  );
  const draft = await service.createDraft(actor, {
    matterId: matter.id,
    subject: "Review",
    body: source,
    bodyFormat: "html",
    to: [matter.recipient],
    fieldPreviewFingerprint: preview.fingerprint,
  });
  expect(draft.body).toBe(preview.body);
  await validateAuthoredMergeFields(actor, draft);
  await prisma.matter.update({
    where: { id: matter.id },
    data: { propertyAddress: "Changed & Reviewed Lane" },
  });
  await expect(validateAuthoredMergeFields(actor, draft)).rejects.toMatchObject(
    { code: "SOURCE_PREVIEW_CHANGED" },
  );
  const missing = await service.createDraft(actor, {
    matterId: matter.id,
    subject: "Missing",
    body: "<p>Lender: <strong>{{lender_name}}</strong></p>",
    bodyFormat: "html",
    to: [],
    saveForLater: true,
  });
  expect(missing.body).not.toContain("{{");
  await expect(
    validateAuthoredMergeFields(actor, missing),
  ).rejects.toMatchObject({ code: "MISSING_MERGE_FIELD" });
});

it("edits historical text drafts into HTML without treating literal angle brackets as markup", async () => {
  const matter = await file();
  const row = await template({
    body: "Keep <literal> text\nSecond line",
    recipientRoles: ["lender"],
  });
  expect(row.bodyFormat).toBe("plain");
  const draft = await service.createDraft(actor, {
    matterId: matter.id,
    subject: "Legacy",
    body: "Keep <literal> text\nSecond line",
    to: [],
    saveForLater: true,
  });
  const edited = await service.updateDraft(actor, draft.id, {
    expectedRevision: draft.revision,
    body: "<p>Keep &lt;literal&gt; text</p><p><u>Second line</u></p>",
    bodyFormat: "html",
    saveForLater: true,
  });
  expect(edited.bodyFormat).toBe("html");
  expect(edited.body).toContain("&lt;literal&gt;");
  expect(edited.body).toContain("<u>Second line</u>");
  expect(sanitizeEmailHtml(edited.body)).toBe(edited.body);
});

it("renders an older text template as HTML for the new composer without losing signature formatting or literal text", async () => {
  const matter = await file();
  const row = await template({
    body: "Keep <literal> wording\nAddress: {{property_address}}\n\n{{tc_signature}}",
    recipientRoles: ["client"],
  });
  const preview = await service.renderTemplate(actor, row.id, {
    matterId: matter.id,
    bodyFormat: "html",
  });
  expect(preview.bodyFormat).toBe("html");
  expect(preview.body).toContain("&lt;literal&gt;");
  expect(preview.body).toContain(image);
  const draft = await service.createDraft(actor, {
    matterId: matter.id,
    bodyFormat: "html",
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
  expect(queued.status).toBe("queued");
  expect(
    (
      await prisma.communicationTemplate.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).bodyFormat,
  ).toBe("plain");
});
