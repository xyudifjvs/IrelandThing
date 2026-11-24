import { emailMimeContent } from "./email-html";
import { createHash } from "node:crypto";
import { z } from "zod";
import nodemailer from "nodemailer";
import { prisma, type Prisma } from "@weatherly/db";
import { HttpError } from "@weatherly/platform";
import { audit, requireMatter } from "@weatherly/matters";
import { readDocumentVersion, type ObjectStore } from "@weatherly/documents";
import type { CommunicationsService } from "./service";
import { finishSentWork } from "./email-work";
import { recordSentDirectoryContacts } from "./directory-history";
import {
  asRecord,
  assertReviewedMatter,
  textArray,
  recipientPolicy,
  requireResolved,
  requireSameRecipients,
} from "./policy";
import { assertConfigured } from "./gateway";
import { jobActor } from "./gmail-job-actor";
import { validateAuthoredMergeFields } from "./render-email-fields";

const sendPayload = z.object({
  draftId: z.string(),
  ownerId: z.string(),
  sendKey: z.string(),
});

export async function sendGmailJob(
  service: CommunicationsService,
  store: ObjectStore,
  payload: unknown,
) {
  const input = sendPayload.parse(payload);
  try {
    return await dispatchGmail(service, store, input);
  } catch (error) {
    const permanent =
      error instanceof HttpError &&
      error.status < 500 &&
      ![408, 429].includes(error.status);
    const exhausted =
      !permanent &&
      ((
        await prisma.outboxJob.findUnique({
          where: { idempotencyKey: input.sendKey },
          select: { attempts: true },
        })
      )?.attempts ?? 0) >= 6;
    if (permanent || exhausted) {
      const draft = await prisma.emailDraft.findUnique({
        where: { id: input.draftId },
      });
      if (
        draft?.status === "queued" &&
        draft.sendKey === input.sendKey &&
        asRecord(asRecord(draft.details).approvedSnapshot).approvedById ===
          input.ownerId
      ) {
        const { approvedSnapshot: _, ...details } = asRecord(draft.details);
        await prisma.emailDraft.updateMany({
          where: {
            id: draft.id,
            revision: draft.revision,
            status: "queued",
            sendKey: input.sendKey,
          },
          data: {
            status: "draft",
            sendKey: null,
            approvedAt: null,
            revision: { increment: 1 },
            details: {
              ...details,
              sendFailure:
                error instanceof HttpError
                  ? error.code
                  : "SEND_PREPARATION_FAILED",
              reviewNeeded: true,
            },
          },
        });
      }
    }
    throw error;
  }
}

async function dispatchGmail(
  service: CommunicationsService,
  store: ObjectStore,
  { draftId, ownerId, sendKey }: z.infer<typeof sendPayload>,
) {
  const actor = await jobActor(ownerId);
  assertConfigured(service.config, true);
  const draft = await prisma.emailDraft.findUnique({ where: { id: draftId } });
  if (!draft || draft.sendKey !== sendKey)
    throw new HttpError(
      409,
      "SEND_SNAPSHOT_CHANGED",
      "Approved message no longer matches the queued send",
    );
  if (draft.status === "sent")
    return { sent: true, providerMessageId: draft.providerMessageId };
  if (draft.status === "delivery_unknown" || draft.status === "sending") {
    await prisma.emailDraft.updateMany({
      where: { id: draftId, status: "sending" },
      data: { status: "delivery_unknown" },
    });
    throw new HttpError(
      409,
      "DELIVERY_UNKNOWN",
      "Delivery may already have occurred; reconcile in Gmail before any retry",
    );
  }
  if (draft.status !== "queued")
    throw new HttpError(
      409,
      "SEND_NOT_APPROVED",
      "Only an approved queued draft may send",
    );
  const snapshot = asRecord(asRecord(draft.details).approvedSnapshot);
  if (!snapshot.subject || !snapshot.body || snapshot.approvedById !== ownerId)
    throw new HttpError(
      409,
      "MISSING_SEND_SNAPSHOT",
      "Message must be reviewed again",
    );
  requireResolved(String(snapshot.subject), String(snapshot.body));
  const validateSources = async (
    db: Prisma.TransactionClient | typeof prisma = prisma,
    lock = false,
  ) => {
    const currentMatter = await requireMatter(actor, draft.matterId, lock, db);
    await validateAuthoredMergeFields(actor, draft, db);
    assertReviewedMatter(currentMatter);
    if (!["under_contract", "closing", "listing"].includes(currentMatter.stage))
      throw new HttpError(
        409,
        "EMAIL_FILE_READ_ONLY",
        "This file no longer permits sending.",
      );
    const binding = asRecord(draft.details);
    const templateId = snapshot.templateId ?? binding.templateId;
    if (typeof templateId === "string") {
      if (lock)
        await db.$queryRaw`SELECT id FROM "CommunicationTemplate" WHERE id = ${templateId} FOR SHARE`;
      const template = await db.communicationTemplate.findUnique({
        where: { id: templateId },
      });
      if (template?.isPlaceholder)
        throw new HttpError(
          422,
          "TEMPLATE_PLACEHOLDER",
          "Add the template's approved content before sending.",
        );
      if (
        !template?.active ||
        template.revision !==
          (snapshot.templateRevision ?? binding.templateRevision)
      )
        throw new HttpError(
          409,
          "TEMPLATE_CHANGED",
          "The approved template changed before sending.",
        );
    }
    if (Array.isArray(snapshot.sourceDeadlines)) {
      const current = await db.deadline.findMany({
        where: { matterId: draft.matterId },
        select: { id: true, revision: true },
      });
      const expected = new Map(
        snapshot.sourceDeadlines.map((v) => {
          const d = asRecord(v);
          return [String(d.id), Number(d.revision)];
        }),
      );
      if (
        current.length !== expected.size ||
        current.some((d) => expected.get(d.id) !== d.revision)
      )
        throw new HttpError(
          409,
          "SOURCE_DEADLINES_CHANGED",
          "Dates changed after send approval; review a new draft before sending",
        );
    }
    if (Array.isArray(snapshot.sourceTasks)) {
      const current = await db.task.findMany({
        where: { matterId: draft.matterId, dueDate: { not: null } },
        select: { id: true, revision: true },
      });
      const expected = new Map(
        snapshot.sourceTasks.map((v) => {
          const t = asRecord(v);
          return [String(t.id), Number(t.revision)];
        }),
      );
      if (
        current.length !== expected.size ||
        current.some((t) => expected.get(t.id) !== t.revision)
      )
        throw new HttpError(
          409,
          "SOURCE_DATES_CHANGED",
          "Task dates changed after approval; review a new draft",
        );
    }
    const recipients = await recipientPolicy(
      actor,
      draft.matterId,
      textArray(snapshot.to),
      textArray(snapshot.cc),
      db,
      { saved: snapshot.formerRecipientEvidence },
    );
    requireSameRecipients(recipients, {
      to: snapshot.to,
      cc: snapshot.cc,
      recipientEvidence: snapshot.recipientEvidence,
    });
    if (
      !Number.isSafeInteger(snapshot.sourceMatterRevision) ||
      snapshot.sourceMatterRevision !== currentMatter.revision
    )
      throw new HttpError(
        409,
        "SOURCE_MATTER_CHANGED",
        "Transaction facts changed after approval; review a new draft before sending.",
      );
    return recipients;
  };
  const recipients = await validateSources();
  const attachments: {
    filename: string;
    content: Buffer;
    contentType: string;
  }[] = [];
  for (const source of Array.isArray(snapshot.attachments)
    ? snapshot.attachments
    : []) {
    const a = asRecord(source);
    const document = await readDocumentVersion(
      actor,
      String(a.documentId),
      String(a.versionId),
      store,
    );
    if (document.checksum !== a.checksum)
      throw new HttpError(
        409,
        "ATTACHMENT_CHANGED",
        "Approved attachment failed integrity validation",
      );
    attachments.push({
      filename: document.name,
      content: document.bytes,
      contentType: document.mimeType,
    });
  }
  let replyLocalThreadId: string | undefined;
  let reply: { threadId?: string; inReplyTo?: string; references?: string } =
    {};
  if (snapshot.replyToMessageId) {
    const original = await prisma.emailMessage.findUnique({
      where: { id: String(snapshot.replyToMessageId) },
      include: { thread: true },
    });
    if (
      !original ||
      original.thread.matterId !== draft.matterId ||
      original.thread.ownerId !== ownerId
    )
      throw new HttpError(
        422,
        "INVALID_REPLY",
        "Reply source no longer belongs to this matter",
      );
    replyLocalThreadId = original.thread.id;
    const messageId = asRecord(original.details).internetMessageId;
    if (typeof messageId === "string" && /^<[^\r\n<>]+>$/.test(messageId))
      reply = {
        threadId: original.thread.providerThreadId,
        inReplyTo: messageId,
        references: messageId,
      };
  }
  const messageId = `<weatherly-${createHash("sha256").update(sendKey).digest("hex").slice(0, 40)}@${service.config.mailbox!.split("@")[1]}>`;
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "windows",
  });
  const compiled = await transport.sendMail({
    from: service.config.mailbox,
    to: recipients.to,
    cc: recipients.cc,
    subject: String(snapshot.subject),
    ...emailMimeContent(
      String(snapshot.body),
      snapshot.bodyFormat,
      String(snapshot.subject),
    ),
    attachments,
    messageId,
    inReplyTo: reply.inReplyTo,
    references: reply.references,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  // Attachment reads and MIME preparation can await slow storage. Recheck
  // every mutable source under the matter lock before claiming dispatch.
  await jobActor(ownerId);
  await prisma.$transaction(async (tx) => {
    await validateSources(tx, true);
    for (const source of Array.isArray(snapshot.attachments)
      ? snapshot.attachments
      : []) {
      const a = asRecord(source);
      const document = await tx.document.findFirst({
        where: { id: String(a.documentId), matterId: draft.matterId },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
      if (
        !document ||
        document.versions[0]?.id !== a.versionId ||
        document.versions[0]?.checksum !== a.checksum
      )
        throw new HttpError(
          409,
          "ATTACHMENT_CHANGED",
          "Attachment sources changed during preparation; review a new draft.",
        );
    }
    if (snapshot.replyToMessageId) {
      const original = await tx.emailMessage.findUnique({
        where: { id: String(snapshot.replyToMessageId) },
        include: { thread: true },
      });
      if (
        !original ||
        original.thread.matterId !== draft.matterId ||
        original.thread.ownerId !== ownerId ||
        original.thread.id !== replyLocalThreadId ||
        (reply.threadId && original.thread.providerThreadId !== reply.threadId)
      )
        throw new HttpError(
          409,
          "INVALID_REPLY",
          "Reply association changed during preparation; review a new draft.",
        );
    }
    const claimed = await tx.emailDraft.updateMany({
      where: {
        id: draftId,
        revision: draft.revision,
        status: "queued",
        sendKey,
      },
      data: {
        status: "sending",
        details: {
          ...asRecord(draft.details),
          deliveryMessageId: messageId,
          attemptStartedAt: new Date().toISOString(),
        },
      },
    });
    if (!claimed.count)
      throw new HttpError(
        409,
        "SEND_ALREADY_CLAIMED",
        "Another worker claimed this message",
      );
  });
  try {
    const sent = await service.request<{ id: string; threadId: string }>(
      ownerId,
      "/messages/send",
      "POST",
      {
        raw: (compiled.message as Buffer).toString("base64url"),
        ...(reply.threadId ? { threadId: reply.threadId } : {}),
      },
    );
    await prisma.$transaction(async (tx) => {
      const sentAt = new Date();
      await tx.emailDraft.update({
        where: { id: draftId },
        data: {
          status: "sent",
          providerMessageId: sent.id,
          sentAt,
          revision: { increment: 1 },
        },
      });
      await finishSentWork(tx, draft.workItemId);
      await recordSentDirectoryContacts(tx, ownerId, snapshot, sentAt);
      const replyThread = replyLocalThreadId
        ? await tx.emailThread.findUnique({
            where: { id: replyLocalThreadId },
          })
        : null;
      const existingThread =
        replyThread?.providerThreadId === sent.threadId
          ? replyThread
          : await tx.emailThread.findFirst({
              where: {
                ownerId,
                providerThreadId: sent.threadId,
                matterId: draft.matterId,
              },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            });
      const thread =
        existingThread ||
        (await tx.emailThread.upsert({
          where: {
            ownerId_providerThreadId_lifecycleKey: {
              ownerId,
              providerThreadId: sent.threadId,
              lifecycleKey: "matter:" + draft.matterId,
            },
          },
          create: {
            ownerId,
            providerThreadId: sent.threadId,
            lifecycleKey: "matter:" + draft.matterId,
            matterId: draft.matterId,
            subject: String(snapshot.subject),
            status: "assigned",
          },
          update: {},
        }));
      await tx.emailMessage.upsert({
        where: { providerMessageId: sent.id },
        create: {
          providerMessageId: sent.id,
          threadId: thread.id,
          fromEmail: service.config.mailbox!,
          to: recipients.to,
          cc: recipients.cc,
          subject: String(snapshot.subject),
          text: emailMimeContent(
            String(snapshot.body),
            snapshot.bodyFormat,
            String(snapshot.subject),
          ).text,
          html: emailMimeContent(
            String(snapshot.body),
            snapshot.bodyFormat,
            String(snapshot.subject),
          ).html,
          sentAt: new Date(),
          direction: "outbound",
          details: {
            visibility: "coordinator",
            internetMessageId: messageId,
            approvedDraftId: draftId,
            documentIds: attachments.map((_a, i) =>
              String(
                asRecord((snapshot.attachments as unknown[])[i]).documentId,
              ),
            ),
          },
        },
        update: {},
      });
      await audit(
        tx,
        actor,
        "email.sent",
        "EmailDraft",
        draftId,
        draft.matterId,
        { providerMessageId: sent.id, sendKey },
      );
    });
    return { sent: true, providerMessageId: sent.id };
  } catch (error) {
    await prisma.emailDraft.updateMany({
      where: { id: draftId, status: "sending" },
      data: {
        status: "delivery_unknown",
        details: {
          ...asRecord(draft.details),
          deliveryMessageId: messageId,
          lastError: "Provider outcome uncertain; reconcile before retry",
        },
      },
    });
    throw error;
  }
}
