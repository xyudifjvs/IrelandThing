import { z } from "zod";
import { prisma } from "@weatherly/db";
import {
  HttpError,
  assertCoordinator,
  type Principal,
} from "@weatherly/platform";
import { requireMatter, audit, revision } from "@weatherly/matters";
import { assertConfigured } from "./gateway";
import {
  asRecord,
  assertReviewedMatter,
  textArray,
  recipientPolicy,
  requireSameRecipients,
  requireResolved,
} from "./policy";
import type { CommunicationsService } from "./service";
import { finishSentWork, requireEmailWorkFile } from "./email-work";
import { recordSentDirectoryContacts } from "./directory-history";

export async function queueSend(
  this: CommunicationsService,
  actor: Principal,
  id: string,
  input: unknown,
) {
  assertCoordinator(actor);
  const { revision: expectedRevision } = z
    .object({ revision, confirmed: z.literal(true) })
    .strict()
    .parse(input);
  const old = await prisma.emailDraft.findUnique({ where: { id } });
  if (!old) throw new HttpError(404, "DRAFT_NOT_FOUND", "Draft not found");
  const sendKey = `gmail-draft:${id}:${expectedRevision}`;
  if (
    old.sendKey === sendKey &&
    ["queued", "sending", "sent", "delivery_unknown"].includes(old.status)
  )
    return old;
  if (old.revision !== expectedRevision || old.status !== "draft")
    throw new HttpError(
      409,
      "REVISION_CONFLICT",
      "Draft changed; review before sending",
    );
  return prisma.$transaction(async (tx) => {
    const matter = await requireMatter(actor, old.matterId, true, tx);
    assertReviewedMatter(matter);
    if (matter.checklistVersion !== null)
      await requireEmailWorkFile(tx, actor, matter.id);
    const details = asRecord(old.details);
    if (details.templateNeedsRebind === true)
      throw new HttpError(
        409,
        "TEMPLATE_CHANGED",
        "Choose a current template and review the saved wording before sending.",
      );
    if (typeof details.templateId === "string") {
      const template = await tx.communicationTemplate.findUnique({
        where: { id: details.templateId },
      });
      if (!template?.active || template.revision !== details.templateRevision)
        throw new HttpError(
          409,
          "TEMPLATE_CHANGED",
          "Open the current template and review the draft.",
        );
      if (template.isPlaceholder)
        throw new HttpError(
          422,
          "TEMPLATE_PLACEHOLDER",
          "Add the template's approved content before sending.",
        );
      const current = await this.renderInDb(
        actor,
        template.id,
        {
          matterId: old.matterId,
          values: asRecord(details.templateValues),
        },
        tx,
        true,
      );
      const preview = asRecord(details.templateSnapshot);
      if (preview.subject !== current.subject || preview.body !== current.body)
        throw new HttpError(
          409,
          "SOURCE_PREVIEW_CHANGED",
          "Transaction fields changed. Refresh this draft and review it again.",
        );
      if (
        (current.missingSubjectFields.length &&
          old.subject === current.subject) ||
        (current.missingBodyFields.length && old.body === current.body)
      )
        throw new HttpError(
          422,
          "MISSING_MERGE_FIELD",
          "Fill or remove the blank fields in this email before sending.",
        );
    }
    assertConfigured(this.config, true);
    requireResolved(old.subject, old.body);
    const recipients = await recipientPolicy(
      actor,
      matter.id,
      textArray(old.to),
      textArray(old.cc),
      tx,
      { saved: details.formerRecipientEvidence },
    );
    requireSameRecipients(recipients, {
      to: old.to,
      cc: old.cc,
      recipientEvidence: details.recipientEvidence,
    });
    const connection = await tx.integrationConnection.findUnique({
      where: { provider_ownerId: { provider: "gmail", ownerId: actor.id } },
    });
    if (connection?.status !== "connected")
      throw new HttpError(
        503,
        "GMAIL_NOT_CONNECTED",
        "Connect the Weatherly mailbox first",
      );
    const attachments = await tx.documentVersion.findMany({
      where: {
        documentId: { in: textArray(old.attachmentIds) },
        document: { matterId: matter.id },
      },
      orderBy: { version: "desc" },
    });
    const selected = new Map<string, (typeof attachments)[number]>();
    for (const attachment of attachments)
      if (!selected.has(attachment.documentId))
        selected.set(attachment.documentId, attachment);
    if (selected.size !== new Set(textArray(old.attachmentIds)).size)
      throw new HttpError(
        422,
        "INVALID_ATTACHMENT",
        "Each attachment must be a saved document on this matter",
      );
    const snapshot = {
      to: recipients.to,
      cc: recipients.cc,
      recipientEvidence: recipients.recipientEvidence,
      formerRecipientEvidence: recipients.formerRecipientEvidence,
      directoryRecipients: recipients.directoryRecipients,
      subject: old.subject,
      body: old.body,
      attachments: [...selected.values()].map((v) => ({
        documentId: v.documentId,
        versionId: v.id,
        checksum: v.checksum,
      })),
      replyToMessageId: details.replyToMessageId || null,
      approvedById: actor.id,
      approvedAt: new Date().toISOString(),
      approvedRevision: expectedRevision,
      sourceMatterRevision: matter.revision,
      ...(typeof details.templateId === "string"
        ? {
            templateId: details.templateId,
            templateRevision: details.templateRevision as number,
            sourceTasks: await tx.task.findMany({
              where: { matterId: matter.id, dueDate: { not: null } },
              select: { id: true, revision: true },
            }),
            sourceDeadlines: await tx.deadline.findMany({
              where: { matterId: matter.id },
              select: { id: true, revision: true },
            }),
          }
        : {}),
    };
    if (old.workItemId) {
      const another = await tx.emailDraft.findFirst({
        where: {
          id: { not: old.id },
          workItemId: old.workItemId,
          status: { in: ["queued", "sending", "sent", "delivery_unknown"] },
        },
        select: { id: true },
      });
      if (another)
        throw new HttpError(
          409,
          "EMAIL_ALREADY_APPROVED",
          "This email already has an approved or sent draft.",
        );
    }
    const changed = await tx.emailDraft.updateMany({
      where: { id, revision: expectedRevision, status: "draft" },
      data: {
        status: "queued",
        approvedAt: new Date(),
        sendKey,
        details: { ...details, sendFailure: null, approvedSnapshot: snapshot },
        revision: { increment: 1 },
      },
    });
    if (!changed.count) {
      const existing = await tx.emailDraft.findUniqueOrThrow({
        where: { id },
      });
      if (existing.sendKey === sendKey) return existing;
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "Draft changed; review before sending",
      );
    }
    await tx.outboxJob.create({
      data: {
        topic: "gmail.send",
        idempotencyKey: sendKey,
        payload: { draftId: id, ownerId: actor.id, sendKey },
      },
    });
    await audit(
      tx,
      actor,
      "email.send_approved",
      "EmailDraft",
      id,
      old.matterId,
      { sendKey },
    );
    return tx.emailDraft.findUniqueOrThrow({ where: { id } });
  });
}

export async function reconcileSend(
  this: CommunicationsService,
  actor: Principal,
  id: string,
  input: unknown,
) {
  assertCoordinator(actor);
  const { expectedRevision } = z
    .object({ expectedRevision: revision, confirmed: z.literal(true) })
    .strict()
    .parse(input);
  const draft = await prisma.emailDraft.findUnique({ where: { id } });
  if (!draft) throw new HttpError(404, "DRAFT_NOT_FOUND", "Draft not found");
  await requireMatter(actor, draft.matterId, true);
  if (!["delivery_unknown", "sending"].includes(draft.status))
    throw new HttpError(
      409,
      "RECONCILIATION_NOT_REQUIRED",
      "Only uncertain delivery requires reconciliation",
    );
  const messageId = asRecord(draft.details).deliveryMessageId;
  if (typeof messageId !== "string")
    throw new HttpError(
      422,
      "MISSING_DELIVERY_ID",
      "No delivery identifier is available",
    );
  const result = await this.request<{
    messages?: { id: string; threadId: string }[];
  }>(
    actor.id,
    `/messages?maxResults=2&q=${encodeURIComponent(`in:sent rfc822msgid:${messageId}`)}`,
  );
  if (result.messages?.length !== 1)
    return {
      found: false,
      status: "delivery_unknown",
      message: "No unique sent message was found; no retry was authorized",
    };
  const candidate = result.messages[0];
  const evidence = await this.request<{
    labelIds?: string[];
    payload?: { headers?: { name: string; value: string }[] };
  }>(
    actor.id,
    `/messages/${encodeURIComponent(candidate.id)}?format=metadata&metadataHeaders=Message-ID`,
  );
  if (
    !evidence.labelIds?.includes("SENT") ||
    !evidence.payload?.headers?.some(
      (h) =>
        h.name.toLowerCase() === "message-id" && h.value.trim() === messageId,
    )
  )
    throw new HttpError(
      409,
      "RECONCILIATION_MISMATCH",
      "Sent-message evidence did not match the approved delivery identifier",
    );
  return prisma.$transaction(async (tx) => {
    const sentAt = new Date();
    const changed = await tx.emailDraft.updateMany({
      where: {
        id,
        revision: expectedRevision,
        status: { in: ["delivery_unknown", "sending"] },
      },
      data: {
        status: "sent",
        providerMessageId: candidate.id,
        sentAt,
        revision: { increment: 1 },
        details: {
          ...asRecord(draft.details),
          reconciledById: actor.id,
          reconciledAt: new Date().toISOString(),
        },
      },
    });
    if (!changed.count)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "Delivery record changed; refresh",
      );
    await finishSentWork(tx, draft.workItemId);
    await recordSentDirectoryContacts(
      tx,
      actor.id,
      asRecord(asRecord(draft.details).approvedSnapshot),
      sentAt,
    );
    await audit(
      tx,
      actor,
      "email.delivery_reconciled",
      "EmailDraft",
      id,
      draft.matterId,
      { providerMessageId: candidate.id },
    );
    return {
      found: true,
      draft: await tx.emailDraft.findUniqueOrThrow({ where: { id } }),
    };
  });
}
