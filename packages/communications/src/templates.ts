import { mergeFields } from "./merge-fields";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import {
  HttpError,
  assertCoordinator,
  type Principal,
} from "@weatherly/platform";
import { requireMatter, audit, revision } from "@weatherly/matters";
import { asRecord, assertReviewedMatter, validateMerge } from "./policy";
import type { CommunicationsService } from "./service";

export async function listTemplates(actor: Principal, includeInactive = false) {
  assertCoordinator(actor);
  return prisma.communicationTemplate.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: { name: "asc" },
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
  validateMerge(parsed.subject);
  validateMerge(parsed.body);
  return prisma.$transaction(async (tx) => {
    let next = 1;
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
    }
    const { expectedRevision: _, ...data } = parsed;
    const row = await tx.communicationTemplate.create({
      data: { ...data, revision: next, active: true },
    });
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

export async function availableMergeFields(actor: Principal, matterId: string) {
  assertCoordinator(actor);
  return mergeFields(actor, matterId);
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
  if (!template)
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
  const computed: Record<string, string> = {};
  for (const f of fields) if (f.value !== null) computed[f.key] = f.value;
  for (const [key, value] of Object.entries(values)) {
    if (key !== "recipientName" && key !== "coordinatorName") continue;
    computed[key] = value;
  }
  const missing = new Set<string>();
  const render = (source: string) => {
    validateMerge(source);
    return source.replace(
      /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
      (_all, key: string) => {
        if (!computed[key]?.trim()) {
          missing.add(key);
          return `{{${key}}}`;
        }
        return computed[key];
      },
    );
  };
  const subject = render(template.subject),
    body = render(template.body);
  if (missing.size && !allowUnresolved)
    throw new HttpError(
      422,
      "MISSING_MERGE_FIELD",
      `Resolve confirmed values for: ${[...missing].join(", ")}`,
    );
  return {
    subject,
    body,
    templateId: template.id,
    templateRevision: template.revision,
    missingFields: [...missing],
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
    const generated = await this.renderInDb(
      actor,
      details.templateId,
      { matterId, values },
      tx,
      true,
    );
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
  const { expectedRevision, values = {} } = z
    .object({
      expectedRevision: revision,
      values: z.record(z.string(), z.string().max(2000)).optional(),
    })
    .strict()
    .parse(input);
  const draft = await prisma.emailDraft.findUnique({ where: { id } });
  if (!draft) throw new HttpError(404, "DRAFT_NOT_FOUND", "Draft not found");
  const details = asRecord(draft.details);
  if (typeof details.templateId !== "string")
    throw new HttpError(422, "NO_TEMPLATE", "This draft has no saved template");
  return prisma.$transaction(async (tx) => {
    const generated = await this.renderInDb(
      actor,
      String(details.templateId),
      { matterId: draft.matterId, values },
      tx,
      true,
    );
    const changed = await tx.emailDraft.updateMany({
      where: { id, revision: expectedRevision, status: "draft" },
      data: {
        subject: generated.subject,
        body: generated.body,
        revision: { increment: 1 },
        details: {
          ...details,
          templateValues: values,
          templateSnapshot: {
            subject: generated.subject,
            body: generated.body,
          },
          subjectOverride: false,
          bodyOverride: false,
          reviewNeeded: !!generated.missingFields.length,
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
