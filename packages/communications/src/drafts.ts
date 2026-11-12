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
  const rendered = data.templateId
    ? await this.renderInDb(actor, data.templateId, {
        matterId: data.matterId,
        values: data.templateValues || {},
      })
    : null;
  return prisma.$transaction(async (tx) => {
    const matter = await requireMatter(actor, data.matterId, true, tx);
    const recipients = await recipientPolicy(
      actor,
      matter.id,
      data.to,
      data.cc,
      tx,
    );
    let workItemId: string | null = null;
    if (recipients.matter.checklistVersion !== null) {
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
        subject: data.subject,
        body: data.body,
        attachmentIds: data.attachmentIds,
        status: "draft",
        details: {
          recipientEvidence: recipients.recipientEvidence,
          knownRecipients: recipients.knownRecipients,
          templateId: data.templateId || null,
          templateRevision: data.templateRevision || null,
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
  const { expectedRevision, ...patch } = z
    .object({
      expectedRevision: revision,
      to: recipientArray.min(1).optional(),
      cc: recipientArray.optional(),
      subject: z
        .string()
        .min(1)
        .max(998)
        .refine((v) => !/[\r\n]/.test(v))
        .optional(),
      body: z.string().min(1).max(100000).optional(),
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
    const recipients = await recipientPolicy(
      actor,
      old.matterId,
      patch.to || textArray(old.to),
      patch.cc || textArray(old.cc),
      tx,
    );
    const details = asRecord(old.details);
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
        to: recipients.to,
        cc: recipients.cc,
        details: {
          ...details,
          recipientEvidence: recipients.recipientEvidence,
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
