import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import {
  HttpError,
  assertCoordinator,
  type Principal,
} from "@weatherly/platform";
import { requireMatter, audit, revision } from "@weatherly/matters";
import {
  textArray,
  draftInput,
  recipientArray,
  recipientPolicy,
} from "./policy";
import type { CommunicationsService } from "./service";

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
  const recipients = await recipientPolicy(
    actor,
    data.matterId,
    data.to,
    data.cc,
  );
  await this.validateAttachments(actor, data.matterId, data.attachmentIds);
  if (data.replyToMessageId) {
    const message = await prisma.emailMessage.findUnique({
      where: { id: data.replyToMessageId },
      include: { thread: true },
    });
    if (!message || message.thread.matterId !== data.matterId)
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
    const draft = await tx.emailDraft.create({
      data: {
        matterId: data.matterId,
        createdById: actor.id,
        to: recipients.to,
        cc: recipients.cc,
        subject: data.subject,
        body: data.body,
        attachmentIds: data.attachmentIds,
        status: "draft",
        details: {
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
  const recipients = await recipientPolicy(
    actor,
    old.matterId,
    patch.to || textArray(old.to),
    patch.cc || textArray(old.cc),
  );
  await this.validateAttachments(
    actor,
    old.matterId,
    patch.attachmentIds || textArray(old.attachmentIds),
  );
  return prisma.$transaction(async (tx) => {
    const changed = await tx.emailDraft.updateMany({
      where: { id, revision: expectedRevision, status: "draft" },
      data: {
        ...patch,
        to: recipients.to,
        cc: recipients.cc,
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
  await requireMatter(actor, old.matterId, true);
  const changed = await prisma.emailDraft.updateMany({
    where: { id, revision: expectedRevision, status: "draft" },
    data: { status: "cancelled", revision: { increment: 1 } },
  });
  if (!changed.count)
    throw new HttpError(
      409,
      "REVISION_CONFLICT",
      "Draft changed or is already queued",
    );
  return { cancelled: true };
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
