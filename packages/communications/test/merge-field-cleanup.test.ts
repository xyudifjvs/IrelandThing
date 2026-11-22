import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import { updateTask } from "../../matters/src/commands/tasks";
import { seedMatterChecklist } from "../../matters/src/checklist/persistence";
import {
  previewMatterChecklistDates,
  applyMatterChecklistDates,
} from "../../matters/src/checklist/date-commands";
import { checklistWording } from "../../matters/src/checklist/display";
import { fieldCatalog, normalizeFieldCodes } from "../src/field-catalog";
import {
  saveFieldDefinition,
  saveTransactionDetail,
  saveCompanyMergeProfile,
  transactionDetailFields,
  mergeFieldConfiguration,
} from "../src/field-sources";
import { saveCustomMergeField } from "../src/custom-merge-fields";
import {
  renderEmailFields,
  validateAuthoredMergeFields,
} from "../src/render-email-fields";
import { mergeFields } from "../src/merge-fields";
import { createCommunicationsService } from "../src/service";
import {
  changeEmailWork,
  listEmailWork,
  finishSentWork,
} from "../src/email-work";

const id = randomUUID().replaceAll("-", "");
const actor: Principal = {
  id,
  name: "Synthetic Coordinator",
  email: `${id}@example.test`,
  role: "coordinator",
  sessionId: id,
};
const service = createCommunicationsService();
const customKey = `geo_${id}`,
  detailKey = `detail_${id}`,
  roleKey = `lender_${id}`;
const stepFieldKey = `delivery_${id}`;
const brokerage = `Synthetic Brokerage ${id}`;
let buyer: string, seller: string;
const templates: string[] = [];
const agentId = `agent-${id}`;
const civil = (date: string) => ({ date, instant: null });
beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id, name: actor.name, email: actor.email, role: "coordinator" },
      {
        id: agentId,
        name: "Taylor Marie Agent",
        email: `agent-${id}@example.test`,
        role: "agent",
        brokerage,
      },
    ],
  });
  for (const side of ["buyer", "seller"] as const) {
    const matter = await prisma.matter.create({
      data: {
        title: `Synthetic ${side}`,
        propertyAddress: "123 Synthetic Lane",
        side,
        packageCode: "essentials",
        agentId,
        details: {
          referenceIntake: {
            fields: {
              fee: "$450",
              mls: "yes",
              mls_sell: "Taylor Agent",
              mls_cosell: "Chris Agent",
            },
          },
        },
      },
    });
    if (side === "buyer") buyer = matter.id;
    else seller = matter.id;
    await prisma.$transaction((tx) =>
      seedMatterChecklist(tx, matter.id, {
        side,
        purchaseType: "financed",
        acceptance: civil("2027-08-01"),
        timeZone: "America/New_York",
        dates: [
          {
            key: "closing",
            value: civil("2027-08-31"),
            rule: { kind: "fixed" },
          },
          {
            key: "final_walkthrough",
            value: null,
            rule: {
              kind: "relative",
              offset: {
                anchor: { kind: "step", key: "closing" },
                amount: -3,
                unit: "days",
                counting: "calendar",
                rollover: "none",
                calendar: null,
              },
            },
          },
        ],
      }),
    );
  }
  await prisma.matterContact.createMany({
    data: [
      {
        matterId: buyer,
        role: "client",
        name: "Alex Morgan Buyer",
        email: `client-${id}@example.test`,
      },
      {
        matterId: buyer,
        role: "lender",
        name: "Jamie Lee Loan",
        email: `lender-${id}@example.test`,
        phone: "555-0100",
        company: "Synthetic Lender",
      },
    ],
  });
});
afterAll(async () => {
  await prisma.emailDraft.deleteMany({
    where: { matterId: { in: [buyer, seller] } },
  });
  await prisma.matter.deleteMany({ where: { id: { in: [buyer, seller] } } });
  await prisma.communicationTemplate.deleteMany({
    where: { id: { in: templates } },
  });
  await prisma.mergeFieldDefinition.deleteMany({
    where: { key: { in: [detailKey, roleKey, stepFieldKey] } },
  });
  await prisma.customMergeField.deleteMany({ where: { key: customKey } });
  await prisma.companyMergeProfile.deleteMany({ where: { name: brokerage } });
  await prisma.auditEvent.deleteMany({ where: { actorId: id } });
  await prisma.user.deleteMany({ where: { id: { in: [id, agentId] } } });
});

it("publishes the 71 retained workbook codes once and normalizes old template aliases", () => {
  expect(fieldCatalog).toHaveLength(71);
  expect(new Set(fieldCatalog.map((field) => field.key)).size).toBe(71);
  expect(
    fieldCatalog.some((field) => field.key === "repair_completion_deadline"),
  ).toBe(false);
  expect(
    normalizeFieldCodes(
      "{{propertyAddress}} {{ task_earnest_money_due }} {{deadline_home_warranty}} {{custom_geo_info}}",
    ),
  ).toBe(
    "{{property_address}} {{emd_due_date}} {{warranty_deadline}} {{geo_info}}",
  );
});

it("uses the first word of full names and shares wiring text by brokerage", async () => {
  const text = "Account reference: synthetic\nCall the brokerage to confirm.";
  await saveCompanyMergeProfile(actor, {
    kind: "brokerage",
    name: brokerage,
    text,
    expectedRevision: null,
  });
  const fields = await mergeFields(actor, buyer),
    values = Object.fromEntries(
      fields.map((field) => [field.key, field.value]),
    );
  expect(values).toMatchObject({
    acceptance_date: "8/1/27",
    client_first_names: "Alex",
    agent_first_name: "Taylor",
    lender_first_name: "Jamie",
    commission_wiring_instructions: text,
    closing_date: "8/31/27",
    closing_terms: "on or before 8/31/27",
    walkthrough_terms: "within 3 days of closing",
    walkthrough_deadline: "8/28/27",
    mls_closing_instructions:
      "Selling agent: Taylor Agent\nCo-selling agent: Chris Agent",
  });
  const other = await mergeFields(actor, seller);
  expect(
    other.find((field) => field.key === "commission_wiring_instructions")
      ?.value,
  ).toBe(text);
  expect(
    fields.some((field) => /^(date|task|deadline)_|[A-Z]/.test(field.key)),
  ).toBe(false);
});

it("autosaves side-specific Details with conflict detection and supports new source bindings", async () => {
  await prisma.task.createMany({
    data: [buyer, seller].map((matterId) => ({
      matterId,
      title: "Delivery completed",
      stepKey: `custom_${matterId}`,
      dateCapable: true,
      dueDate: "2027-08-20",
    })),
  });
  expect((await mergeFieldConfiguration(actor)).checklistSteps).toContainEqual({
    key: "title:delivery_completed",
    label: "Custom step: Delivery completed",
  });
  await saveFieldDefinition(actor, {
    key: stepFieldKey,
    label: "Delivery date",
    side: "both",
    source: {
      kind: "checklist",
      stepKey: "title:delivery_completed",
      property: "date",
    },
  });
  for (const matterId of [buyer, seller]) {
    const fields = await mergeFields(actor, matterId);
    expect(fields.find((field) => field.key === stepFieldKey)?.value).toBe(
      "8/20/27",
    );
    expect(
      fields.filter((field) =>
        [stepFieldKey, "delivery_completed_date"].includes(field.key),
      ),
    ).toHaveLength(1);
  }
  await saveFieldDefinition(actor, {
    key: detailKey,
    label: "Delivery text",
    side: "buyer",
    source: { kind: "details", key: detailKey },
  });
  await prisma.matterContact.create({
    data: {
      matterId: buyer,
      role: "attorney",
      name: "Synthetic Attorney",
      phone: "555-0100",
    },
  });
  await saveFieldDefinition(actor, {
    key: roleKey,
    label: "Loan contact phone",
    side: "buyer",
    source: { kind: "person", role: "attorney", property: "phone" },
  });
  await saveTransactionDetail(actor, buyer, {
    key: detailKey,
    value: "Line one\nLine two",
    expectedValue: "",
  });
  await expect(
    saveTransactionDetail(actor, buyer, {
      key: detailKey,
      value: "Stale overwrite",
      expectedValue: "",
    }),
  ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  expect(
    (await transactionDetailFields(actor, buyer)).some(
      (field) => field.key === detailKey,
    ),
  ).toBe(true);
  expect(
    (await transactionDetailFields(actor, seller)).some(
      (field) => field.key === detailKey,
    ),
  ).toBe(false);
  expect(
    (await mergeFields(actor, buyer)).find((field) => field.key === roleKey)
      ?.value,
  ).toBe("555-0100");
  await expect(
    saveCustomMergeField(actor, { key: detailKey, label: "Collision" }),
  ).rejects.toMatchObject({ code: "MERGE_FIELD_EXISTS" });
  await expect(
    transactionDetailFields({ ...actor, role: "agent" }, buyer),
  ).rejects.toMatchObject({ status: 403 });
});

it("renders scratch subject/body codes and multiline exact-key custom defaults before saving", async () => {
  await saveCustomMergeField(actor, {
    key: customKey,
    label: "Area instructions",
    defaultValue: "First line\nSecond line",
  });
  const subject = "Closing {{propertyAddress}} · {{closing_date}}",
    body = `Hi {{client_first_names}},\n{{${customKey}}}`;
  const preview = await renderEmailFields(actor, buyer, subject, body);
  expect(preview).toMatchObject({
    subject: "Closing 123 Synthetic Lane · 8/31/27",
    body: "Hi Alex,\nFirst line\nSecond line",
    missingFields: [],
  });
  const draft = await service.createDraft(actor, {
    matterId: buyer,
    to: [],
    subject,
    body,
    saveForLater: true,
    remindOn: "2027-08-20",
    fieldPreviewFingerprint: preview.fingerprint,
  });
  expect(draft).toMatchObject({
    status: "draft",
    subject: preview.subject,
    body: preview.body,
  });
  const [work] = await listEmailWork(actor, { matterId: buyer });
  expect(work).toMatchObject({
    id: draft.workItemId,
    remindOn: "2027-08-20",
    toSend: true,
  });
  expect(
    await prisma.outboxJob.count({
      where: {
        topic: "gmail.send",
        payload: { path: ["ownerId"], equals: id },
      },
    }),
  ).toBe(0);
  await validateAuthoredMergeFields(actor, draft);
  await saveCustomMergeField(
    actor,
    {
      label: "Area instructions",
      defaultValue: "Changed text",
      expectedRevision: 1,
    },
    customKey,
  );
  await expect(validateAuthoredMergeFields(actor, draft)).rejects.toMatchObject(
    { code: "SOURCE_PREVIEW_CHANGED" },
  );
  await expect(
    renderEmailFields(actor, buyer, `{{${customKey}}}`, "Body", undefined, {
      [customKey]: "One\nTwo",
    }),
  ).rejects.toMatchObject({ code: "MULTILINE_SUBJECT_FIELD" });
});

it("keeps EMD/warranty edits and email wording separate from actual dates", async () => {
  let emd = await prisma.task.findFirstOrThrow({
    where: { matterId: buyer, stepKey: "earnest_money_due" },
  });
  await updateTask(actor, buyer, emd.id, {
    expectedRevision: emd.revision,
    amountCents: 200000,
    holder: "Synthetic Escrow",
    dateWording: "Received",
  });
  const warranty = await prisma.task.findFirstOrThrow({
    where: { matterId: buyer, stepKey: "home_warranty_ordered" },
  });
  await updateTask(actor, buyer, warranty.id, {
    expectedRevision: warranty.revision,
    amountCents: 55000,
    company: "Synthetic Warranty",
  });
  const values = Object.fromEntries(
    (await mergeFields(actor, buyer)).map((field) => [field.key, field.value]),
  );
  expect(values).toMatchObject({
    emd_amount: "$2,000",
    emd_holder: "Synthetic Escrow",
    emd_due_date: "Received",
    warranty_amount: "$550",
    warranty_company: "Synthetic Warranty",
  });
  expect(
    (await prisma.task.findUniqueOrThrow({ where: { id: emd.id } })).dueDate,
  ).toBe(emd.dueDate);
  emd = await prisma.task.findUniqueOrThrow({ where: { id: emd.id } });
  await updateTask(actor, buyer, emd.id, {
    expectedRevision: emd.revision,
    amountCents: null,
    holder: "",
  });
  expect(
    (await mergeFields(actor, buyer)).find(
      (field) => field.key === "emd_amount",
    )?.value,
  ).toBeNull();
});

it("moves the walkthrough from the reviewed contract offset when closing moves", async () => {
  const matter = await prisma.matter.findUniqueOrThrow({
    where: { id: buyer },
  });
  const change = {
    expectedRevision: matter.revision,
    change: {
      kind: "set" as const,
      target: { kind: "step" as const, key: "closing" },
      value: civil("2027-09-10"),
    },
  };
  const preview = await previewMatterChecklistDates(actor, buyer, change);
  await applyMatterChecklistDates(actor, buyer, {
    ...change,
    mode: "update_all",
    previewDigest: preview.previewDigest,
  });
  const walkthrough = await prisma.task.findFirstOrThrow({
    where: { matterId: buyer, stepKey: "final_walkthrough" },
  });
  expect(walkthrough.dueDate).toBe("2027-09-07");
  expect(checklistWording(walkthrough, "final_walkthrough")).toBe(
    "within 3 days of closing",
  );
  expect(
    checklistWording(
      { dueDate: "2027-09-07", dateRule: { kind: "fixed" } },
      "final_walkthrough",
    ),
  ).toBe("");
});

it("allows manual unchecking while retaining the actual sent date and delivery record", async () => {
  const draft = await service.createDraft(actor, {
    matterId: seller,
    to: ["synthetic@example.test"],
    subject: "Synthetic saved email",
    body: "Synthetic",
    saveForLater: true,
  });
  const sentAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.emailDraft.update({
      where: { id: draft.id },
      data: { status: "sent", sentAt },
    });
    await finishSentWork(tx, draft.workItemId);
  });
  let work = (
    await listEmailWork(actor, { matterId: seller, view: "all" })
  ).find((item) => item.id === draft.workItemId)!;
  expect(work.checked).toBe(true);
  work = await changeEmailWork(actor, work.id, {
    action: "uncheck",
    expectedRevision: work.revision,
  });
  expect(work).toMatchObject({ checked: false, sentAt });
  expect(
    (await prisma.emailDraft.findUniqueOrThrow({ where: { id: draft.id } }))
      .sentAt,
  ).toEqual(sentAt);
});

it("rejects a stale template preview even when its old text contains no field codes", async () => {
  const template = await service.saveTemplate(actor, {
    name: `Preview ${id}`,
    side: "buyer",
    phase: "closing",
    subject: "Closing {{closing_date}}",
    body: "Closing terms: {{closing_terms}}",
  });
  templates.push(template.id);
  const preview = await service.renderTemplate(actor, template.id, {
    matterId: buyer,
  });
  const closing = await prisma.task.findFirstOrThrow({
    where: { matterId: buyer, stepKey: "closing" },
  });
  await updateTask(actor, buyer, closing.id, {
    expectedRevision: closing.revision,
    dateWording: "Contract closing text",
  });
  await expect(
    service.createDraft(actor, {
      matterId: buyer,
      to: [],
      subject: preview.subject,
      body: preview.body,
      saveForLater: true,
      templateId: template.id,
      templateRevision: template.revision,
      templatePreviewFingerprint: preview.previewFingerprint,
    }),
  ).rejects.toMatchObject({ code: "SOURCE_PREVIEW_CHANGED" });
});

it("uses checklist possession wording and a per-transaction buyer-agent commission", async () => {
  const possession = await prisma.task.findFirstOrThrow({
    where: { matterId: buyer, stepKey: "possession" },
  });
  await updateTask(actor, buyer, possession.id, {
    expectedRevision: possession.revision,
    dateWording: "At closing, keys released after funding",
  });
  await saveTransactionDetail(actor, buyer, {
    key: "buyer_agent_commission",
    value: "2.5%",
    expectedValue: "",
  });
  const preview = await renderEmailFields(
    actor,
    buyer,
    "Title introduction",
    "Possession: {{possession_terms}}. Buyer-agent commission: {{buyer_agent_commission}}",
  );
  expect(preview.body).toBe(
    "Possession: At closing, keys released after funding. Buyer-agent commission: 2.5%",
  );
  expect(
    (await mergeFields(actor, seller)).find(
      (field) => field.key === "buyer_agent_commission",
    )?.value,
  ).toBeNull();
  expect(
    checklistWording(
      {
        dateRule: {
          kind: "relative",
          offset: {
            anchor: { kind: "step", key: "closing" },
            amount: 2,
            unit: "days",
            counting: "calendar",
          },
        },
      },
      "possession",
    ),
  ).toBe("2 days after closing");
});

it("renders every scheduled merge field with the file timezone, weekday and any minute, preserving place and exact timestamps", async () => {
  const keys = {
    inspections: "inspection_scheduled",
    final_walkthrough: "walkthrough_scheduled",
    closing: "closing_scheduled",
    appraisal: "appraisal_scheduled",
  };
  const instant = "2026-09-19T13:10:25.123Z";
  for (const [stepKey] of Object.entries(keys)) {
    const task = await prisma.task.findFirstOrThrow({
      where: { matterId: buyer, stepKey },
    });
    await updateTask(actor, buyer, task.id, {
      expectedRevision: task.revision,
      appointmentAt: instant,
      appointmentPlace: "Synthetic Office",
    });
  }
  const fields = await mergeFields(actor, buyer);
  for (const key of Object.values(keys))
    expect(fields.find((field) => field.key === key)?.value).toBe(
      "Sat, Sep 19 at 9:10 AM · Synthetic Office",
    );
  const rendered = await renderEmailFields(
    actor,
    buyer,
    "Appointment details",
    Object.values(keys)
      .map((key) => `{{${key}}}`)
      .join("\n"),
  );
  expect(rendered.body.split("\n")).toEqual(
    Array(4).fill("Sat, Sep 19 at 9:10 AM · Synthetic Office"),
  );
  expect(rendered.missingFields).toEqual([]);
  expect(rendered.unknownFields).toEqual([]);
  const saved = await prisma.task.findFirstOrThrow({
    where: { matterId: buyer, stepKey: "closing" },
  });
  expect((saved.details as Record<string, unknown>).appointmentAt).toBe(
    instant,
  );
});
