import { mergeFields } from "./merge-fields";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import {
  HttpError,
  assertCoordinator,
  type Principal,
} from "@weatherly/platform";
import { requireMatter, audit, revision } from "@weatherly/matters";
import { stepKeySchema } from "@weatherly/platform/handoff-contracts";
import { asRecord, assertReviewedMatter, validateMerge } from "./policy";
import type { CommunicationsService } from "./service";
import { ensureTemplateWork } from "./email-work";
import { canonicalFieldKey, normalizeFieldCodes } from "./field-catalog";
import { replaceFieldText } from "./field-renderer";
import { hideNotNeededLines } from "./template-line-policy";
import { omitNotNeededLines } from "./template-line-policy";
import { listFieldDefinitions } from "./field-sources";
import {
  listCustomMergeFields,
  applyCustomMergeValues,
} from "./custom-merge-fields";

export async function listTemplates(actor: Principal, includeInactive = false) {
  assertCoordinator(actor);
  return prisma.communicationTemplate.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [
      { recipientGroup: { sort: "asc", nulls: "last" } },
      { position: { sort: "asc", nulls: "last" } },
      { name: "asc" },
    ],
    take: 200,
  });
}

export async function saveTemplate(
  actor: Principal,
  input: unknown,
  id?: string,
) {
  assertCoordinator(actor);
  const schema = z
    .object({
      name: z.string().min(1).max(150),
      side: z.enum(["buyer", "seller", "both"]),
      serviceGroup: z
        .enum([
          "buyer_ctc",
          "seller_ctc",
          "buyer_compliance",
          "seller_compliance",
        ])
        .nullable()
        .optional(),
      phase: z.string().min(1).max(100),
      subject: z
        .string()
        .min(1)
        .max(998)
        .refine((v) => !/[\r\n]/.test(v)),
      body: z.string().min(1).max(100000),
      linkedStepKey: stepKeySchema.nullable().optional(),
      recipientGroup: z.string().trim().min(1).max(100).nullable().optional(),
      recipientRoles: z
        .array(z.string().trim().min(1).max(80))
        .max(15)
        .optional(),
      position: z.number().int().min(0).max(10000).nullable().optional(),
      isPlaceholder: z.boolean().optional(),
      hideNotNeededLines: z.boolean().optional(),
    })
    .strict();
  const parsed = id
    ? schema.extend({ expectedRevision: revision }).parse(input)
    : { ...schema.parse(input), expectedRevision: undefined };
  if (parsed.serviceGroup && !parsed.serviceGroup.startsWith(parsed.side + "_"))
    throw new HttpError(
      422,
      "TEMPLATE_GROUP_SIDE_MISMATCH",
      "Select the buyer or seller group matching this template.",
    );
  parsed.subject = normalizeFieldCodes(parsed.subject);
  parsed.body = normalizeFieldCodes(parsed.body);
  const customKeys = new Set([
    ...(await listCustomMergeFields(actor)).map(({ key }) =>
      canonicalFieldKey(key),
    ),
    ...(await listFieldDefinitions(actor)).map(({ key }) => key),
  ]);
  validateMerge(parsed.subject, customKeys);
  validateMerge(parsed.body, customKeys);
  return prisma.$transaction(async (tx) => {
    let next = 1;
    let previous: Awaited<
      ReturnType<typeof tx.communicationTemplate.findUnique>
    > = null;
    if (id) {
      const old = await tx.communicationTemplate.findUnique({
        where: { id },
      });
      if (!old)
        throw new HttpError(404, "TEMPLATE_NOT_FOUND", "Template not found");
      const changed = await tx.communicationTemplate.updateMany({
        where: { id, revision: parsed.expectedRevision, active: true },
        data: { active: false },
      });
      if (!changed.count)
        throw new HttpError(
          409,
          "REVISION_CONFLICT",
          "Template changed; refresh",
        );
      next = old.revision + 1;
      previous = old;
    }
    const { expectedRevision: _, ...data } = parsed;
    const row = await tx.communicationTemplate.create({
      data: {
        ...data,
        linkedStepKey:
          data.linkedStepKey === undefined
            ? previous?.linkedStepKey
            : data.linkedStepKey,
        recipientGroup:
          data.recipientGroup === undefined
            ? previous?.recipientGroup
            : data.recipientGroup,
        recipientRoles:
          data.recipientRoles ?? previous?.recipientRoles ?? undefined,
        position:
          data.position === undefined ? previous?.position : data.position,
        isPlaceholder: data.isPlaceholder ?? previous?.isPlaceholder ?? false,
        hideNotNeededLines:
          data.hideNotNeededLines ??
          previous?.hideNotNeededLines ??
          hideNotNeededLines({
            recipientRoles: data.recipientRoles ?? previous?.recipientRoles,
            recipientGroup:
              data.recipientGroup === undefined
                ? previous?.recipientGroup
                : data.recipientGroup,
          }),
        revision: next,
        active: true,
      },
    });
    if (previous) {
      await tx.emailWork.updateMany({
        where: { templateId: previous.id },
        data: {
          templateId: row.id,
          templateRevision: row.revision,
          linkedStepKey: row.linkedStepKey,
          revision: { increment: 1 },
        },
      });
    }
    await audit(
      tx,
      actor,
      "email.template_version_created",
      "CommunicationTemplate",
      row.id,
      null,
      { previousId: id || null, revision: next },
    );
    return row;
  });
}

export async function archiveTemplate(
  actor: Principal,
  id: string,
  raw: unknown,
) {
  assertCoordinator(actor);
  const { expectedRevision } = z
    .object({ expectedRevision: revision })
    .strict()
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    const archived = await tx.communicationTemplate.updateMany({
      where: { id, active: true, revision: expectedRevision },
      data: { active: false },
    });
    if (!archived.count)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "This template changed. Refresh before deleting.",
      );
    await audit(
      tx,
      actor,
      "email.template_archived",
      "CommunicationTemplate",
      id,
      null,
    );
    return { id, archived: true };
  });
}

export async function reorderTemplates(actor: Principal, raw: unknown) {
  assertCoordinator(actor);
  const { side, recipientGroup, serviceGroup, items } = z
    .object({
      side: z.enum(["buyer", "seller", "both"]),
      recipientGroup: z.string().trim().min(1).max(100).nullable(),
      serviceGroup: z.string().trim().min(1).max(100).nullable().optional(),
      items: z
        .array(
          z
            .object({ id: z.string().min(1), expectedRevision: revision })
            .strict(),
        )
        .min(1)
        .max(200),
    })
    .strict()
    .refine(
      ({ items }) => new Set(items.map(({ id }) => id)).size === items.length,
    )
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    const where = {
      side,
      recipientGroup,
      active: true,
      ...(serviceGroup !== undefined ? { serviceGroup } : {}),
    };
    const group = await tx.communicationTemplate.findMany({
      where,
      select: { id: true, revision: true },
    });
    const revisions = new Map(group.map(({ id, revision }) => [id, revision]));
    if (
      items.length !== revisions.size ||
      items.some(
        ({ id, expectedRevision }) => revisions.get(id) !== expectedRevision,
      )
    )
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "This template group changed. Refresh before reordering.",
      );
    // Lock in stable ID order while preserving the requested display positions.
    for (const { id, expectedRevision, position } of items
      .map((item, position) => ({ ...item, position }))
      .sort((a, b) => a.id.localeCompare(b.id))) {
      const saved = await tx.communicationTemplate.updateMany({
        where: { ...where, id, revision: expectedRevision },
        data: { position },
      });
      if (!saved.count)
        throw new HttpError(
          409,
          "REVISION_CONFLICT",
          "A template changed during reordering.",
        );
    }
    await audit(
      tx,
      actor,
      "email.templates_reordered",
      "CommunicationTemplate",
      side,
      null,
      { recipientGroup, ids: items.map(({ id }) => id) },
    );
    return { ordered: true };
  });
}

export async function availableMergeFields(actor: Principal, matterId: string) {
  assertCoordinator(actor);
  const fields = await mergeFields(actor, matterId);
  const custom = await listCustomMergeFields(actor);
  const customKeys = new Set(custom.map(({ key }) => canonicalFieldKey(key)));
  return [
    ...fields.filter(({ key }) => !customKeys.has(key)),
    ...custom.map((field) => ({
      key: canonicalFieldKey(field.key),
      label: field.label,
      value: field.defaultValue || null,
      status: field.defaultValue.trim() ? "confirmed" : "unknown",
      sourceIds: [],
    })),
  ];
}

export async function renderInDb(
  actor: Principal,
  id: string,
  input: unknown,
  db: Prisma.TransactionClient | typeof prisma = prisma,
  allowUnresolved = false,
) {
  assertCoordinator(actor);
  const { matterId, values = {} } = z
    .object({
      matterId: z.string(),
      values: z.record(z.string(), z.string().max(2000)).optional(),
    })
    .strict()
    .parse(input);
  const matter = await requireMatter(actor, matterId, false, db);
  if (!allowUnresolved) assertReviewedMatter(matter);
  const template = await db.communicationTemplate.findUnique({
    where: { id },
  });
  if (!template?.active)
    throw new HttpError(404, "TEMPLATE_NOT_FOUND", "Template not found");
  if (template.side !== "both" && template.side !== matter.side)
    throw new HttpError(
      422,
      "TEMPLATE_SIDE_MISMATCH",
      "Template does not match the represented side",
    );
  if (
    template.serviceGroup &&
    template.serviceGroup !==
      `${matter.side}_${matter.packageCode === "complete" ? "compliance" : "ctc"}`
  )
    throw new HttpError(
      422,
      "TEMPLATE_GROUP_MISMATCH",
      "Select the template group matching this transaction’s side and designated package.",
    );
  const fields = await mergeFields(actor, matterId, db);
  const custom = await listCustomMergeFields(actor, db);
  const customKeys = new Set([
    ...custom.map(({ key }) => canonicalFieldKey(key)),
    ...fields.map(({ key }) => canonicalFieldKey(key)),
  ]);
  const computed: Record<string, string> = {};
  for (const f of fields)
    if (f.value !== null && f.status === "confirmed")
      computed[canonicalFieldKey(f.key)] = f.value;
  applyCustomMergeValues(computed, custom, values);
  for (const [key, value] of Object.entries(values)) {
    if (!["recipientName", "recipient_name", "coordinatorName"].includes(key))
      continue;
    computed[canonicalFieldKey(key)] = value;
  }
  const missing = new Set<string>();
  const missingSubjectFields = new Set<string>();
  const missingBodyFields = new Set<string>();
  const overrides = new Set(
    custom.map((field) => canonicalFieldKey(field.key)),
  );
  const renderFields = [
    ...fields
      .filter((field) => !overrides.has(field.key))
      .map((field) =>
        Object.hasOwn(computed, field.key)
          ? {
              ...field,
              value: computed[field.key],
              status: "confirmed" as const,
            }
          : field,
      ),
    ...Object.entries(computed)
      .filter(
        ([key]) =>
          overrides.has(key) || !fields.some((field) => field.key === key),
      )
      .map(([key, value]) => ({
        key,
        label: key,
        value,
        status: value.trim() ? ("confirmed" as const) : ("unknown" as const),
        sourceIds: [],
      })),
  ];
  const render = (source: string, missingPart: Set<string>) => {
    validateMerge(source, customKeys);
    const result = replaceFieldText(source, renderFields, true);
    for (const key of result.missing) {
      missing.add(key);
      missingPart.add(key);
    }
    return result.output;
  };
  const subject = render(template.subject, missingSubjectFields),
    body = render(
      omitNotNeededLines(
        template.body,
        renderFields,
        hideNotNeededLines(template),
      ),
      missingBodyFields,
    );
  if (/[\r\n]/.test(subject) || subject.length > 998)
    throw new HttpError(
      422,
      "INVALID_MERGED_SUBJECT",
      "A subject field must fit on one line of at most 998 characters. Put multiline fields in the email body.",
    );
  if (missing.size && !allowUnresolved && matter.checklistVersion === null)
    throw new HttpError(
      422,
      "MISSING_MERGE_FIELD",
      `Resolve confirmed values for: ${[...missing].join(", ")}`,
    );
  return {
    subject,
    body,
    previewFingerprint: createHash("sha256")
      .update(
        JSON.stringify([
          template.id,
          template.revision,
          subject,
          body,
          [...missing],
        ]),
      )
      .digest("hex"),
    templateId: template.id,
    templateRevision: template.revision,
    missingFields: [...missing],
    missingSubjectFields: [...missingSubjectFields],
    missingBodyFields: [...missingBodyFields],
  };
}

export async function renderTemplate(
  this: CommunicationsService,
  actor: Principal,
  id: string,
  input: unknown,
) {
  return this.renderInDb(actor, id, input);
}

export async function refreshTemplateDrafts(
  this: CommunicationsService,
  actor: Principal,
  matterId: string,
  tx: Prisma.TransactionClient,
) {
  const drafts = await tx.emailDraft.findMany({
    where: { matterId, status: "draft" },
  });
  for (const draft of drafts) {
    const details = asRecord(draft.details);
    if (typeof details.templateId !== "string") continue;
    const prior = asRecord(details.templateSnapshot);
    const values = asRecord(details.templateValues);
    let generated;
    try {
      generated = await this.renderInDb(
        actor,
        details.templateId,
        { matterId, values },
        tx,
        true,
      );
    } catch (error) {
      if (
        !(error instanceof HttpError) ||
        ![
          "TEMPLATE_SIDE_MISMATCH",
          "TEMPLATE_GROUP_MISMATCH",
          "TEMPLATE_NOT_FOUND",
        ].includes(error.code)
      )
        throw error;
      await tx.emailDraft.updateMany({
        where: { id: draft.id, revision: draft.revision, status: "draft" },
        data: {
          revision: { increment: 1 },
          details: {
            ...details,
            reviewNeeded: true,
            templateNeedsRebind: true,
            mergeError:
              "Choose a current template for this file and review the saved wording.",
          },
        },
      });
      continue;
    }
    const subjectOverride = prior.subject !== draft.subject;
    const bodyOverride = prior.body !== draft.body;
    const changed = await tx.emailDraft.updateMany({
      where: { id: draft.id, revision: draft.revision, status: "draft" },
      data: {
        subject: subjectOverride ? draft.subject : generated.subject,
        body: bodyOverride ? draft.body : generated.body,
        revision: { increment: 1 },
        details: {
          ...details,
          templateSnapshot: {
            subject: generated.subject,
            body: generated.body,
          },
          templatePreviewFingerprint: generated.previewFingerprint,
          subjectOverride,
          bodyOverride,
          reviewNeeded:
            subjectOverride || bodyOverride || !!generated.missingFields.length,
          mergeError: generated.missingFields.length
            ? `Missing confirmed values: ${generated.missingFields.join(", ")}`
            : null,
          refreshedAt: new Date().toISOString(),
        },
      },
    });
    if (!changed.count)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "Draft changed during deadline refresh",
      );
    await audit(
      tx,
      actor,
      "email.template_draft_refreshed",
      "EmailDraft",
      draft.id,
      matterId,
      {
        subjectOverride,
        bodyOverride,
        missingFields: generated.missingFields,
      },
    );
  }
}

export async function resetTemplate(
  this: CommunicationsService,
  actor: Principal,
  id: string,
  input: unknown,
) {
  assertCoordinator(actor);
  const {
    expectedRevision,
    values = {},
    templateId,
  } = z
    .object({
      expectedRevision: revision,
      values: z.record(z.string(), z.string().max(2000)).optional(),
      templateId: z.string().min(1).optional(),
    })
    .strict()
    .parse(input);
  const draft = await prisma.emailDraft.findUnique({ where: { id } });
  if (!draft) throw new HttpError(404, "DRAFT_NOT_FOUND", "Draft not found");
  const details = asRecord(draft.details);
  if (typeof details.templateId !== "string")
    throw new HttpError(422, "NO_TEMPLATE", "This draft has no saved template");
  return prisma.$transaction(async (tx) => {
    const matter = await requireMatter(actor, draft.matterId, true, tx);
    assertReviewedMatter(matter);
    const preserveWording = templateId !== undefined;
    const generated = await this.renderInDb(
      actor,
      templateId ?? String(details.templateId),
      { matterId: draft.matterId, values },
      tx,
      true,
    );
    const workItem =
      matter.checklistVersion !== null && templateId
        ? await ensureTemplateWork(tx, matter, templateId)
        : null;
    const subject = preserveWording ? draft.subject : generated.subject;
    const body = preserveWording ? draft.body : generated.body;
    const changed = await tx.emailDraft.updateMany({
      where: { id, revision: expectedRevision, status: "draft" },
      data: {
        subject,
        body,
        ...(workItem ? { workItemId: workItem.id } : {}),
        revision: { increment: 1 },
        details: {
          ...details,
          templateId: generated.templateId,
          templateRevision: generated.templateRevision,
          templateNeedsRebind: false,
          templateValues: values,
          templateSnapshot: {
            subject: generated.subject,
            body: generated.body,
          },
          templatePreviewFingerprint: generated.previewFingerprint,
          subjectOverride: subject !== generated.subject,
          bodyOverride: body !== generated.body,
          reviewNeeded: preserveWording || !!generated.missingFields.length,
          mergeError: generated.missingFields.length
            ? `Missing confirmed values: ${generated.missingFields.join(", ")}`
            : null,
        },
      },
    });
    if (!changed.count)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "Draft changed or is already queued/sent",
      );
    return tx.emailDraft.findUniqueOrThrow({ where: { id } });
  });
}
