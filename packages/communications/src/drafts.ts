import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import {
  HttpError,
  assertCoordinator,
  type Principal,
} from "@weatherly/platform";
import { requireMatter, audit, revision } from "@weatherly/matters";
import {
  asRecord,
  textArray,
  draftInput,
  recipientArray,
  recipientPolicy,
} from "./policy";
import type { CommunicationsService } from "./service";
import { ensureTemplateWork, requireEmailWorkFile } from "./email-work";
import { renderEmailFields } from "./render-email-fields";

export async function listDrafts(
  actor: Principal,
  matterId?: string,
  options: { cursor?: string; limit?: number } = {},
) {
  assertCoordinator(actor);
  if (matterId) await requireMatter(actor, matterId);
  const limit = z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(100)
    .parse(options.limit);
  const where: Prisma.EmailDraftWhereInput = matterId ? { matterId } : {};
  if (
    options.cursor &&
    !(await prisma.emailDraft.findFirst({
      where: { ...where, id: options.cursor },
      select: { id: true },
    }))
  )
    throw new HttpError(404, "DRAFT_NOT_FOUND", "Draft cursor not found");
  return prisma.emailDraft.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
}

export async function createDraft(
  this: CommunicationsService,
  actor: Principal,
  input: unknown,
) {
  assertCoordinator(actor);
  const data = draftInput.parse(input);
  await this.validateAttachments(actor, data.matterId, data.attachmentIds);
  if (data.replyToMessageId) {
    const message = await prisma.emailMessage.findUnique({
      where: { id: data.replyToMessageId },
      include: { thread: true },
    });
    if (
      !message ||
      message.thread.matterId !== data.matterId ||
      message.thread.ownerId !== actor.id
    )
      throw new HttpError(
        422,
        "INVALID_REPLY",
        "Reply message must belong to this matter",
      );
  }
  if (data.templateId) {
    const t = await prisma.communicationTemplate.findUnique({
      where: { id: data.templateId },
    });
    if (!t || t.revision !== data.templateRevision)
      throw new HttpError(
        409,
        "TEMPLATE_CHANGED",
        "Render the current template before saving",
      );
  }
  return prisma.$transaction(async (tx) => {
    const matter = await requireMatter(actor, data.matterId, true, tx);
    const rendered = data.templateId
      ? await this.renderInDb(
          actor,
          data.templateId,
          {
            matterId: data.matterId,
            values: data.templateValues || {},
          },
          tx,
          data.saveForLater === true,
        )
      : null;
    if (
      rendered &&
      data.templatePreviewFingerprint &&
      rendered.previewFingerprint !== data.templatePreviewFingerprint
    )
      throw new HttpError(
        409,
        "SOURCE_PREVIEW_CHANGED",
        "Template fields changed after the displayed preview. Refill the template and review it before saving or sending.",
      );

    const hasFields = /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(
      data.subject + data.body,
    );
    const filled = hasFields
      ? await renderEmailFields(
          actor,
          matter.id,
          data.subject,
          data.body,
          tx,
          data.templateValues,
          data.templateId,
        )
      : null;
    if (
      filled &&
      data.fieldPreviewFingerprint &&
      data.fieldPreviewFingerprint !== filled.fingerprint
    )
      throw new HttpError(
        409,
        "SOURCE_PREVIEW_CHANGED",
        "Fields changed after the displayed preview. Review the refreshed preview before saving or sending.",
      );
    const recipients = await recipientPolicy(
      actor,
      matter.id,
      data.to,
      data.cc,
      tx,
      {
        // A scratch API request without composer defaults supplies its own addresses.
        entered:
          data.enteredRecipients ??
          (data.templateId || data.replyToMessageId
            ? []
            : [...data.to, ...data.cc]),
      },
    );
    let workItemId: string | null = null;
    if (recipients.matter.checklistVersion !== null || data.saveForLater) {
      const current = await requireEmailWorkFile(tx, actor, matter.id);
      const work = data.templateId
        ? await ensureTemplateWork(tx, current, data.templateId)
        : await tx.emailWork.create({
            data: { matterId: current.id },
            select: { id: true },
          });
      workItemId = work.id;
    }
    const draft = await tx.emailDraft.create({
      data: {
        matterId: data.matterId,
        workItemId,
        createdById: actor.id,
        to: recipients.to,
        cc: recipients.cc,
        subject: filled?.subject ?? data.subject,
        body: filled?.body ?? data.body,
        attachmentIds: data.attachmentIds,
        status: "draft",
        details: {
          authoredMerge: filled
            ? {
                subjectSource: data.subject,
                bodySource: data.body,
                fingerprint: filled.fingerprint,
                values: data.templateValues || {},
              }
            : null,
          recipientEvidence: recipients.recipientEvidence,
          formerRecipientEvidence: recipients.formerRecipientEvidence,
          knownRecipients: recipients.knownRecipients,
          templateId: data.templateId || null,
          templateRevision: data.templateRevision || null,
          templatePreviewFingerprint: rendered?.previewFingerprint ?? null,
          templateValues: data.templateValues || {},
          templateSnapshot: rendered
            ? { subject: rendered.subject, body: rendered.body }
            : null,
          subjectOverride: rendered ? rendered.subject !== data.subject : false,
          bodyOverride: rendered ? rendered.body !== data.body : false,
          replyToMessageId: data.replyToMessageId || null,
        },
      },
    });
    if (data.saveForLater && workItemId)
      await tx.emailWork.update({
        where: { id: workItemId },
        data: {
          laterAt: new Date(),
          remindOn: data.remindOn ?? null,
          manualCompletedAt: null,
          manualCompletedById: null,
          checkedOverride: false,
          revision: { increment: 1 },
        },
      });
    await audit(
      tx,
      actor,
      "email.draft_created",
      "EmailDraft",
      draft.id,
      draft.matterId,
    );
    return draft;
  });
}

export async function updateDraft(
  this: CommunicationsService,
  actor: Principal,
  id: string,
  input: unknown,
) {
  assertCoordinator(actor);
  const {
    expectedRevision,
    saveForLater,
    remindOn,
    fieldPreviewFingerprint,
    enteredRecipients,
    ...patch
  } = z
    .object({
      expectedRevision: revision,
      to: recipientArray.optional(),
      enteredRecipients: z.array(z.email()).max(80).optional(),
      saveForLater: z.boolean().optional(),
      remindOn: z.iso.date().nullable().optional(),
      fieldPreviewFingerprint: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      cc: recipientArray.optional(),
      subject: z
        .string()
        .max(998)
        .refine((v) => !/[\r\n]/.test(v))
        .optional(),
      body: z.string().max(100000).optional(),
      attachmentIds: z.array(z.string()).max(20).optional(),
    })
    .strict()
    .parse(input);
  const old = await prisma.emailDraft.findUnique({ where: { id } });
  if (!old) throw new HttpError(404, "DRAFT_NOT_FOUND", "Draft not found");
  await requireMatter(actor, old.matterId, true);
  await this.validateAttachments(
    actor,
    old.matterId,
    patch.attachmentIds || textArray(old.attachmentIds),
  );
  return prisma.$transaction(async (tx) => {
    const file = await requireMatter(actor, old.matterId, true, tx);
    if (file.checklistVersion !== null)
      await requireEmailWorkFile(tx, actor, old.matterId);
    const details = asRecord(old.details);
    let workItemId = old.workItemId;
    if (saveForLater && !workItemId) {
      await requireEmailWorkFile(tx, actor, file.id);
      const work =
        typeof details.templateId === "string"
          ? await ensureTemplateWork(tx, file, details.templateId)
          : await tx.emailWork.create({
              data: { matterId: file.id },
              select: { id: true },
            });
      workItemId = work.id;
    }
    const subjectSource = patch.subject ?? old.subject,
      bodySource = patch.body ?? old.body;
    const hasFields = /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(
      subjectSource + bodySource,
    );
    const templateValues = Object.fromEntries(
      Object.entries(asRecord(details.templateValues)).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    const filled = hasFields
      ? await renderEmailFields(
          actor,
          old.matterId,
          subjectSource,
          bodySource,
          tx,
          templateValues,
          typeof details.templateId === "string"
            ? details.templateId
            : undefined,
        )
      : null;
    if (
      filled &&
      fieldPreviewFingerprint &&
      fieldPreviewFingerprint !== filled.fingerprint
    )
      throw new HttpError(
        409,
        "SOURCE_PREVIEW_CHANGED",
        "Fields changed after the displayed preview. Review the refreshed preview before saving or sending.",
      );
    if (
      !saveForLater &&
      (!subjectSource.trim() ||
        !bodySource.trim() ||
        !(patch.to ?? textArray(old.to)).length)
    )
      throw new HttpError(
        422,
        "INCOMPLETE_EMAIL",
        "Add a subject, message and To recipient, or save this email for later.",
      );
    const recipients = await recipientPolicy(
      actor,
      old.matterId,
      patch.to || textArray(old.to),
      patch.cc || textArray(old.cc),
      tx,
      { saved: details.formerRecipientEvidence, entered: enteredRecipients },
    );
    const removedRecipients = textArray(details.knownRecipients);
    if (
      recipients.directoryRecipients.some((address) =>
        removedRecipients.includes(address),
      )
    )
      throw new HttpError(
        409,
        "RECIPIENT_RETIRED",
        "A file recipient was removed or replaced. Review the recipients and remove the old address.",
      );
    const changed = await tx.emailDraft.updateMany({
      where: { id, revision: expectedRevision, status: "draft" },
      data: {
        ...patch,
        ...(workItemId ? { workItemId } : {}),
        ...(filled ? { subject: filled.subject, body: filled.body } : {}),
        to: recipients.to,
        cc: recipients.cc,
        details: {
          ...details,
          ...(patch.subject !== undefined || patch.body !== undefined
            ? {
                authoredMerge: filled
                  ? {
                      subjectSource,
                      bodySource,
                      fingerprint: filled.fingerprint,
                      values: templateValues,
                    }
                  : null,
              }
            : {}),
          recipientEvidence: recipients.recipientEvidence,
          formerRecipientEvidence: recipients.formerRecipientEvidence,
          knownRecipients: recipients.knownRecipients,
          sendFailure: null,
        },
        revision: { increment: 1 },
      },
    });
    if (!changed.count)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "Draft changed or is already queued/sent",
      );
    if (saveForLater && workItemId)
      await tx.emailWork.update({
        where: { id: workItemId },
        data: {
          laterAt: new Date(),
          remindOn: remindOn ?? null,
          manualCompletedAt: null,
          manualCompletedById: null,
          checkedOverride: false,
          revision: { increment: 1 },
        },
      });
    await audit(
      tx,
      actor,
      "email.draft_updated",
      "EmailDraft",
      id,
      old.matterId,
    );
    return tx.emailDraft.findUniqueOrThrow({ where: { id } });
  });
}

export async function deleteDraft(
  actor: Principal,
  id: string,
  expectedRevision: number,
) {
  assertCoordinator(actor);
  const old = await prisma.emailDraft.findUnique({ where: { id } });
  if (!old) throw new HttpError(404, "DRAFT_NOT_FOUND", "Draft not found");
  return prisma.$transaction(async (tx) => {
    const matter = await requireMatter(actor, old.matterId, true, tx);
    if (matter.checklistVersion !== null)
      await requireEmailWorkFile(tx, actor, matter.id);
    const changed = await tx.emailDraft.updateMany({
      where: { id, revision: expectedRevision, status: "draft" },
      data: { status: "cancelled", revision: { increment: 1 } },
    });
    if (!changed.count)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "Draft changed or is already queued",
      );
    if (old.workItemId)
      await tx.emailWork.deleteMany({
        where: {
          id: old.workItemId,
          templateId: null,
          drafts: { every: { status: "cancelled" } },
        },
      });
    return { cancelled: true };
  });
}

export async function validateAttachments(
  actor: Principal,
  matterId: string,
  ids: string[],
) {
  for (const id of ids) {
    const doc = await prisma.document.findFirst({
      where: { id, matterId },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!doc?.versions.length)
      throw new HttpError(
        422,
        "INVALID_ATTACHMENT",
        "Each attachment must be a saved document on this matter",
      );
    await requireMatter(actor, matterId);
  }
}
