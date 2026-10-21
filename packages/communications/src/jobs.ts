import { z } from "zod";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { prisma, Prisma } from "@weatherly/db";
import {
  HttpError,
  decryptSecret,
  hashToken,
  encryptSecret,
  type Principal,
} from "@weatherly/platform";
import { audit } from "@weatherly/matters";
import {
  createObjectStore,
  uploadDocument,
  readDocumentVersion,
  type ObjectStore,
} from "@weatherly/documents";
import { CommunicationsService } from "./service";
import {
  asRecord,
  textArray,
  recipientPolicy,
  requireResolved,
} from "./policy";
import { assertConfigured } from "./gateway";
const ownerInput = z.object({ ownerId: z.string() }).passthrough();
async function jobActor(ownerId: string): Promise<Principal> {
  const user = await prisma.user.findUnique({ where: { id: ownerId } });
  if (!user || user.role !== "coordinator")
    throw new HttpError(
      403,
      "WORKER_SCOPE_DENIED",
      "Mailbox jobs require the current coordinator",
    );
  const access = await prisma.auditEvent.findFirst({
    where: {
      entityType: "User",
      entityId: ownerId,
      action: { in: ["identity.access_revoked", "identity.access_restored"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (access?.action === "identity.access_revoked")
    throw new HttpError(
      403,
      "ACCOUNT_REVOKED",
      "Mailbox owner access was revoked",
    );
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: "coordinator",
    sessionId: "worker",
  };
}
interface GmailMessage {
  id: string;
  threadId: string;
  raw?: string;
  internalDate?: string;
  historyId?: string;
  labelIds?: string[];
}
interface GmailList {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}
interface GmailHistory {
  history?: {
    messagesAdded?: { message: { id: string; threadId: string } }[];
    messagesDeleted?: { message: { id: string } }[];
    labelsAdded?: {
      message: { id: string; threadId: string };
      labelIds: string[];
    }[];
    labelsRemoved?: {
      message: { id: string; threadId: string };
      labelIds: string[];
    }[];
  }[];
  nextPageToken?: string;
  historyId: string;
}
function addresses(value: unknown): string[] {
  const header = value as
    | { value?: { address?: string }[] }
    | { value?: { address?: string }[] }[]
    | undefined;
  const headers = Array.isArray(header) ? header : [header];
  return headers
    .flatMap((h) => h?.value || [])
    .map((a) => a.address?.toLowerCase())
    .filter((s): s is string => !!s);
}
export function createCommunicationJobHandlers(
  service: CommunicationsService,
  options: { store?: ObjectStore } = {},
) {
  const store = options.store || createObjectStore();
  async function ingest(actor: Principal, id: string) {
    const message = await service.request<GmailMessage>(
      actor.id,
      `/messages/${encodeURIComponent(id)}?format=raw`,
    );
    if (!message.raw)
      throw new HttpError(
        502,
        "MISSING_MESSAGE_BODY",
        "Gmail did not return the original MIME message",
      );
    if (message.raw.length > 64 * 1024 * 1024)
      throw new HttpError(
        413,
        "EMAIL_TOO_LARGE",
        "This email exceeds the import limit",
      );
    const raw = Buffer.from(message.raw, "base64url");
    const parsed = await simpleParser(raw, {
      skipHtmlToText: false,
      skipTextToHtml: true,
      maxHtmlLengthToParse: 200000,
    });
    const from = addresses(parsed.from)[0] || "unknown@invalid.example";
    const to = addresses(parsed.to),
      cc = addresses(parsed.cc);
    const previous = await prisma.emailMessage.findUnique({
      where: { providerMessageId: message.id },
    });
    const previousDetails = asRecord(previous?.details);
    let thread = await prisma.emailThread.findUnique({
      where: {
        ownerId_providerThreadId: {
          ownerId: actor.id,
          providerThreadId: message.threadId,
        },
      },
    });
    if (!thread) {
      const matters = await prisma.matter.findMany({
        where: { stage: { not: "archived" } },
        select: { id: true, propertyAddress: true },
        take: 1000,
      });
      const text = (parsed.subject || "") + " " + (parsed.text || "");
      const candidates = matters
        .filter((m) =>
          text.toLowerCase().includes(m.propertyAddress.toLowerCase()),
        )
        .map((m) => m.id);
      thread = await prisma.emailThread.upsert({
        where: {
          ownerId_providerThreadId: {
            ownerId: actor.id,
            providerThreadId: message.threadId,
          },
        },
        create: {
          ownerId: actor.id,
          providerThreadId: message.threadId,
          subject: (parsed.subject || "(No subject)").slice(0, 998),
          status: candidates.length ? "review_required" : "unassigned",
          details: {
            candidateMatterIds: candidates,
            associationSource: "property_text_candidate_only",
          },
        },
        update: {},
      });
    }
    const documentIds = textArray(previousDetails.documentIds);
    const descriptors: Array<Record<string, Prisma.InputJsonValue>> = [];
    for (let i = 0; i < parsed.attachments.length; i++) {
      const attachment = parsed.attachments[i];
      const filename = attachment.filename || `attachment-${i + 1}`;
      const old = Array.isArray(previousDetails.attachments)
        ? previousDetails.attachments
            .map(asRecord)
            .find((a) => a.index === i && a.checksum === attachment.checksum)
        : undefined;
      if (old?.documentId) {
        descriptors.push(old as Record<string, Prisma.InputJsonValue>);
        continue;
      }
      const descriptor: Record<string, Prisma.InputJsonValue> = {
        index: i,
        filename,
        contentType: attachment.contentType,
        size: attachment.size,
        checksum: attachment.checksum,
        sourceMessageId: message.id,
      };
      try {
        const doc = await uploadDocument(
          actor,
          {
            ...(thread.matterId ? { matterId: thread.matterId } : {}),
            visibility: "coordinator",
            category: "email_attachment",
          },
          {
            originalname: filename,
            buffer: attachment.content,
            size: attachment.size,
          },
          store,
        );
        documentIds.push(doc.id);
        descriptor.documentId = doc.id;
        descriptor.status = "saved";
      } catch (error) {
        descriptor.status = "import_failed";
        descriptor.error =
          error instanceof HttpError
            ? error.message
            : "Attachment import failed; original remains available in Gmail";
      }
      descriptors.push(descriptor);
    }
    const record = {
      fromEmail: from,
      to,
      cc,
      subject: (parsed.subject || "(No subject)").slice(0, 998),
      text: (parsed.text || "").slice(0, 1000000),
      html:
        typeof parsed.html === "string" ? parsed.html.slice(0, 1000000) : null,
      sentAt: new Date(
        Number(message.internalDate) || parsed.date?.getTime() || Date.now(),
      ),
      direction:
        from === service.config.mailbox?.toLowerCase() ? "outbound" : "inbound",
      details: {
        ...previousDetails,
        visibility: previousDetails.visibility || "coordinator",
        documentIds: [...new Set(documentIds)],
        attachments: descriptors,
        source: "gmail",
        untrustedContent: true,
        providerHistoryId: message.historyId || null,
        labelIds: message.labelIds || [],
        internetMessageId: parsed.messageId || null,
        inReplyTo: parsed.inReplyTo || null,
        importedAt: new Date().toISOString(),
      },
    };
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "EmailMessage" WHERE "providerMessageId" = ${message.id} FOR UPDATE`;
      const latest = await tx.emailMessage.findUnique({
        where: { providerMessageId: message.id },
      });
      const latestDetails = asRecord(latest?.details);
      const safeRecord = {
        ...record,
        details: {
          ...latestDetails,
          ...record.details,
          visibility: latestDetails.visibility || "coordinator",
          documentIds: [
            ...new Set([
              ...textArray(latestDetails.documentIds),
              ...documentIds,
            ]),
          ],
        },
      };
      await tx.emailMessage.upsert({
        where: { providerMessageId: message.id },
        create: {
          ...safeRecord,
          providerMessageId: message.id,
          threadId: thread.id,
        },
        update: safeRecord,
      });
    });
    await prisma.emailThread.update({
      where: { id: thread.id },
      data: { updatedAt: new Date() },
    });
  }
  async function sync(payload: unknown) {
    const { ownerId } = ownerInput.parse(payload);
    const actor = await jobActor(ownerId);
    assertConfigured(service.config);
    let connection = await prisma.integrationConnection.findUnique({
      where: { provider_ownerId: { provider: "gmail", ownerId } },
    });
    if (connection?.status !== "connected")
      throw new HttpError(
        503,
        "GMAIL_NOT_CONNECTED",
        "Reconnect mailbox before synchronization",
      );
    let details = asRecord(connection.details);
    if (
      typeof details.syncLeaseUntil === "string" &&
      new Date(details.syncLeaseUntil).getTime() > Date.now()
    )
      return { alreadyRunning: true };
    const leaseId = randomUUID();
    details = {
      ...details,
      syncLeaseId: leaseId,
      syncLeaseUntil: new Date(Date.now() + 600000).toISOString(),
    };
    const claimed = await prisma.integrationConnection.updateMany({
      where: {
        id: connection.id,
        status: "connected",
        details: { equals: connection.details as Prisma.InputJsonValue },
      },
      data: { details: details as Prisma.InputJsonValue },
    });
    if (!claimed.count) return { alreadyRunning: true };
    const heartbeat = async () => {
      const latest = await prisma.integrationConnection.findUniqueOrThrow({
        where: { id: connection.id },
      });
      const d = asRecord(latest.details);
      if (d.syncLeaseId !== leaseId || latest.status !== "connected")
        throw new HttpError(
          409,
          "SYNC_LEASE_LOST",
          "Synchronization ownership changed",
        );
      await prisma.integrationConnection.updateMany({
        where: {
          id: connection.id,
          details: { path: ["syncLeaseId"], equals: leaseId },
        },
        data: {
          details: {
            ...d,
            syncLeaseUntil: new Date(Date.now() + 600000).toISOString(),
          },
        },
      });
    };
    let cursor = connection.cursor;
    let pages = 0;
    let imported = 0;
    try {
      if (cursor) {
        let pageToken: string | undefined;
        do {
          const response: GmailHistory = await service.request<GmailHistory>(
            ownerId,
            `/history?startHistoryId=${encodeURIComponent(cursor!)}&maxResults=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
          );
          const changed = new Set<string>();
          for (const h of response.history || []) {
            for (const a of h.messagesAdded || []) changed.add(a.message.id);
            for (const a of [
              ...(h.labelsAdded || []),
              ...(h.labelsRemoved || []),
            ])
              changed.add(a.message.id);
            for (const d of h.messagesDeleted || []) {
              const old = await prisma.emailMessage.findUnique({
                where: { providerMessageId: d.message.id },
              });
              if (old)
                await prisma.emailMessage.update({
                  where: { id: old.id },
                  data: {
                    details: {
                      ...asRecord(old.details),
                      deletedFromProvider: true,
                    },
                  },
                });
            }
          }
          for (const id of changed) {
            try {
              await heartbeat();
              await ingest(actor, id);
              imported++;
            } catch (error) {
              if (!(
                error instanceof HttpError && error.code === "GMAIL_NOT_FOUND"
              ))
                throw error;
            }
          }
          pageToken = response.nextPageToken;
          pages++;
          if (!pageToken) cursor = response.historyId;
        } while (pageToken && pages < 20);
        if (pageToken)
          throw new HttpError(
            503,
            "SYNC_PAGE_LIMIT",
            "Mailbox update batch is large; retry will resume safely from the saved cursor",
          );
      } else {
        const query = process.env.GMAIL_IMPORT_QUERY;
        if (!query)
          throw new HttpError(
            503,
            "IMPORT_SCOPE_REQUIRED",
            "Configure the approved historical Gmail import query; use all only for an approved whole-mailbox import",
          );
        const profile = await service.request<{ historyId: string }>(
          ownerId,
          "/profile",
        );
        const baseline = String(details.initialHistoryId || profile.historyId);
        let pageToken =
          typeof details.initialPageToken === "string"
            ? details.initialPageToken
            : undefined;
        do {
          const response = await service.request<GmailList>(
            ownerId,
            `/messages?maxResults=100&includeSpamTrash=false${query === "all" ? "" : `&q=${encodeURIComponent(query)}`}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
          );
          for (const m of response.messages || []) {
            await heartbeat();
            await ingest(actor, m.id);
            imported++;
          }
          pageToken = response.nextPageToken;
          pages++;
          details = {
            ...details,
            initialHistoryId: baseline,
            syncLeaseUntil: new Date(Date.now() + 600000).toISOString(),
            initialPageToken: pageToken || null,
            importStatus: pageToken ? "importing" : "complete",
          };
          await prisma.integrationConnection.update({
            where: { id: connection.id },
            data: { details: details as Prisma.InputJsonValue },
          });
        } while (pageToken && pages < 5);
        if (!pageToken) cursor = baseline;
      }
      await prisma.integrationConnection.update({
        where: { id: connection.id },
        data: {
          cursor,
          lastSyncedAt: new Date(),
          details: {
            ...details,
            syncLeaseUntil: new Date(Date.now() + 600000).toISOString(),
            lastError: null,
            lastImportedCount: imported,
          },
        },
      });
      const now = Date.now();
      await prisma.outboxJob.upsert({
        where: {
          idempotencyKey: `gmail-sync-periodic:${ownerId}:${Math.floor(now / 300000) + 1}`,
        },
        create: {
          topic: "gmail.sync",
          idempotencyKey: `gmail-sync-periodic:${ownerId}:${Math.floor(now / 300000) + 1}`,
          payload: { ownerId },
          availableAt: new Date(now + 300000),
        },
        update: {},
      });
      return { imported, pages, cursor };
    } catch (error) {
      if (
        error instanceof HttpError &&
        error.code === "GMAIL_NOT_FOUND" &&
        connection.cursor
      ) {
        await prisma.integrationConnection.update({
          where: { id: connection.id },
          data: {
            cursor: null,
            details: {
              ...details,
              initialPageToken: null,
              initialHistoryId: null,
              importStatus: "full_resync_required",
              lastError: "History cursor expired; full import will resume",
            },
          },
        });
        await prisma.outboxJob.upsert({
          where: {
            idempotencyKey: `gmail-resync:${connection.id}:${connection.cursor}`,
          },
          create: {
            topic: "gmail.sync",
            idempotencyKey: `gmail-resync:${connection.id}:${connection.cursor}`,
            payload: { ownerId },
          },
          update: {},
        });
        return { resyncRequired: true };
      }
      await prisma.integrationConnection.update({
        where: { id: connection.id },
        data: {
          details: {
            ...details,
            lastError:
              error instanceof HttpError
                ? error.message
                : "Synchronization failed",
          },
        },
      });
      throw error;
    } finally {
      const latest = await prisma.integrationConnection.findUnique({
        where: { id: connection.id },
      });
      const d = asRecord(latest?.details);
      if (d.syncLeaseId === leaseId)
        await prisma.integrationConnection.updateMany({
          where: {
            id: connection.id,
            details: { equals: latest!.details as Prisma.InputJsonValue },
          },
          data: { details: { ...d, syncLeaseId: null, syncLeaseUntil: null } },
        });
    }
  }
  async function send(payload: unknown) {
    const { draftId, ownerId, sendKey } = z
      .object({ draftId: z.string(), ownerId: z.string(), sendKey: z.string() })
      .parse(payload);
    const actor = await jobActor(ownerId);
    assertConfigured(service.config, true);
    let draft = await prisma.emailDraft.findUnique({ where: { id: draftId } });
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
    if (!snapshot.subject || !snapshot.body)
      throw new HttpError(
        409,
        "MISSING_SEND_SNAPSHOT",
        "Message must be reviewed again",
      );
    requireResolved(String(snapshot.subject), String(snapshot.body));
    if (
      Array.isArray(snapshot.sourceDeadlines) &&
      snapshot.sourceDeadlines.length
    ) {
      const current = await prisma.deadline.findMany({
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
    if (Array.isArray(snapshot.sourceTasks) && snapshot.sourceTasks.length) {
      const current = await prisma.task.findMany({
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
    );
    if (
      JSON.stringify(recipients.to) !== JSON.stringify(snapshot.to) ||
      JSON.stringify(recipients.cc) !== JSON.stringify(snapshot.cc)
    )
      throw new HttpError(
        409,
        "RECIPIENT_POLICY_CHANGED",
        "Recipient policy changed after approval; review a new draft",
      );
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
    let reply: { threadId?: string; inReplyTo?: string; references?: string } =
      {};
    if (snapshot.replyToMessageId) {
      const original = await prisma.emailMessage.findUnique({
        where: { id: String(snapshot.replyToMessageId) },
        include: { thread: true },
      });
      if (!original || original.thread.matterId !== draft.matterId)
        throw new HttpError(
          422,
          "INVALID_REPLY",
          "Reply source no longer belongs to this matter",
        );
      const messageId = asRecord(original.details).internetMessageId;
      if (typeof messageId === "string" && /^<[^\r\n<>]+>$/.test(messageId))
        reply = {
          threadId: original.thread.providerThreadId,
          inReplyTo: messageId,
          references: messageId,
        };
    }
    const messageId = `<weatherly-${createHashSafe(sendKey)}@${service.config.mailbox!.split("@")[1]}>`;
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
      text: String(snapshot.body),
      attachments,
      messageId,
      inReplyTo: reply.inReplyTo,
      references: reply.references,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const claimed = await prisma.emailDraft.updateMany({
      where: { id: draftId, status: "queued", sendKey },
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
        await tx.emailDraft.update({
          where: { id: draftId },
          data: {
            status: "sent",
            providerMessageId: sent.id,
            sentAt: new Date(),
            revision: { increment: 1 },
          },
        });
        const thread = await tx.emailThread.upsert({
          where: {
            ownerId_providerThreadId: {
              ownerId,
              providerThreadId: sent.threadId,
            },
          },
          create: {
            ownerId,
            providerThreadId: sent.threadId,
            matterId: draft!.matterId,
            subject: String(snapshot.subject),
            status: "assigned",
          },
          update: {},
        });
        await tx.emailMessage.upsert({
          where: { providerMessageId: sent.id },
          create: {
            providerMessageId: sent.id,
            threadId: thread.id,
            fromEmail: service.config.mailbox!,
            to: recipients.to,
            cc: recipients.cc,
            subject: String(snapshot.subject),
            text: String(snapshot.body),
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
          draft!.matterId,
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
  async function renew(payload: unknown) {
    const { ownerId } = ownerInput.parse(payload);
    await jobActor(ownerId);
    if (!service.config.pubsubTopic)
      return { configured: false, mode: "polling" };
    const watch = await service.request<{
      historyId: string;
      expiration: string;
    }>(ownerId, "/watch", "POST", { topicName: service.config.pubsubTopic });
    const connection = await prisma.integrationConnection.findUniqueOrThrow({
      where: { provider_ownerId: { provider: "gmail", ownerId } },
    });
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: {
        details: {
          ...asRecord(connection.details),
          watchExpiresAt: new Date(Number(watch.expiration)).toISOString(),
          watchRenewedAt: new Date().toISOString(),
        },
      },
    });
    const at = new Date(Date.now() + 24 * 3600000),
      key = `gmail-renew:${ownerId}:${at.toISOString().slice(0, 10)}`;
    await prisma.outboxJob.upsert({
      where: { idempotencyKey: key },
      create: {
        topic: "gmail.renew",
        idempotencyKey: key,
        payload: { ownerId },
        availableAt: at,
      },
      update: {},
    });
    return { renewed: true, expiresAt: watch.expiration };
  }
  async function systemEmail(payload: unknown) {
    const existing = asRecord(payload);
    if (existing.redacted === true)
      return { providerMessageId: existing.providerMessageId, redacted: true };
    const input = z
      .object({
        to: z.email(),
        subject: z.string().max(998),
        text: z.string().max(20000),
        purpose: z.literal("password_reset"),
        expiresAt: z.iso.datetime().optional(),
      })
      .parse(payload);
    if (
      !service.config.outboundEnabled ||
      !service.config.resendApiKey ||
      !service.config.systemFrom ||
      service.config.systemFrom.toLowerCase().includes("ireland@ireland.com")
    )
      throw new HttpError(
        503,
        "SYSTEM_EMAIL_NOT_CONFIGURED",
        "System email delivery is not configured",
      );
    if (input.to.toLowerCase() === "ireland@ireland.com")
      throw new HttpError(
        503,
        "PLACEHOLDER_EMAIL",
        "The preview address cannot receive external messages",
      );
    const key = `system-email:${hashToken(JSON.stringify({ to: input.to, subject: input.subject, text: input.text, purpose: input.purpose }))}`;
    if (input.expiresAt && new Date(input.expiresAt) <= new Date()) {
      await prisma.outboxJob.updateMany({
        where: { idempotencyKey: key },
        data: {
          payload: {
            to: input.to,
            purpose: input.purpose,
            redacted: true,
            expired: true,
          },
        },
      });
      return { expired: true };
    }
    const response = await service.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${service.config.resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `weatherly-${createHashSafe(JSON.stringify(input))}`,
      },
      body: JSON.stringify({
        from: service.config.systemFrom,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new HttpError(
        502,
        "SYSTEM_EMAIL_FAILED",
        "System notification delivery failed",
      );
    const result = z.object({ id: z.string() }).parse(await response.json());
    await prisma.outboxJob.updateMany({
      where: { idempotencyKey: key, topic: "system.email" },
      data: {
        payload: {
          to: input.to,
          purpose: input.purpose,
          redacted: true,
          providerMessageId: result.id,
        },
      },
    });
    return { providerMessageId: result.id };
  }
  return {
    "gmail.sync": sync,
    "gmail.send": send,
    "gmail.renew": renew,
    "system.email": systemEmail,
  };
}
import { createHash, randomUUID } from "node:crypto";
function createHashSafe(v: string) {
  return createHash("sha256").update(v).digest("hex").slice(0, 40);
}
