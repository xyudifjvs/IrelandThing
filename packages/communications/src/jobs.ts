import { z } from "zod";
import { simpleParser } from "mailparser";
import { prisma, Prisma } from "@weatherly/db";
import {
  HttpError,
  decryptSecret,
  hashToken,
  encryptSecret,
  type Principal,
} from "@weatherly/platform";
import { audit, requireMatter } from "@weatherly/matters";
import {
  createObjectStore,
  uploadDocument,
  type ObjectStore,
} from "@weatherly/documents";
import { CommunicationsService } from "./service";
import {
  agentInvitationEmailTopic,
  sendQueuedAgentInvitation,
} from "./agent-invitation-email";
import { asRecord, textArray } from "./policy";
import { assertConfigured } from "./gateway";
import { jobActor } from "./gmail-job-actor";
import { sendGmailJob } from "./gmail-send-job";
const ownerInput = z.object({ ownerId: z.string() }).passthrough();
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
    // Re-imports belong to their original local lifecycle forever. A provider
    // thread may span multiple contracts, but historical messages never move.
    let thread = previous
      ? await prisma.emailThread.findUnique({
          where: { id: previous.threadId },
        })
      : await prisma.emailThread.findFirst({
          where: { ownerId: actor.id, providerThreadId: message.threadId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
    if (!previous) {
      const matters = await prisma.matter.findMany({
        where: { stage: { not: "archived" } },
        select: { id: true, propertyAddress: true, stage: true },
      });
      const text = (
        (parsed.subject || "") +
        " " +
        (parsed.text || "")
      ).toLowerCase();
      const candidates = matters
        .filter(
          (m) =>
            m.propertyAddress.trim() &&
            text.includes(m.propertyAddress.toLowerCase()),
        )
        .map((m) => m.id);
      const associated = thread?.matterId
        ? await prisma.matter.findUnique({ where: { id: thread.matterId } })
        : null;
      const replacement = associated
        ? await prisma.matter.findFirst({
            where: {
              details: { path: ["replacesMatterId"], equals: associated.id },
            },
            select: { id: true },
          })
        : null;
      const closedLifecycle =
        associated?.stage === "terminated" || !!replacement;
      const reviewedCandidates =
        thread && asRecord(thread.details).associationReviewedAt
          ? textArray(asRecord(thread.details).candidateMatterIds)
          : [];
      const differentCandidate =
        !!associated &&
        candidates.some(
          (id) => id !== associated.id && !reviewedCandidates.includes(id),
        );
      if (!thread || closedLifecycle || differentCandidate) {
        const previousThread = thread;
        const lifecycleKey = previousThread
          ? "review:" + previousThread.id
          : "primary";
        thread = await prisma.emailThread.upsert({
          where: {
            ownerId_providerThreadId_lifecycleKey: {
              ownerId: actor.id,
              providerThreadId: message.threadId,
              lifecycleKey,
            },
          },
          create: {
            ownerId: actor.id,
            providerThreadId: message.threadId,
            lifecycleKey,
            subject: (parsed.subject || "(No subject)").slice(0, 998),
            status:
              previousThread || candidates.length
                ? "review_required"
                : "unassigned",
            details: {
              candidateMatterIds: candidates,
              associationSource: previousThread
                ? "contract_lifecycle_review"
                : "property_text_candidate_only",
              ...(previousThread
                ? {
                    previousLifecycleThreadId: previousThread.id,
                    previousMatterId: previousThread.matterId,
                    reviewReason: closedLifecycle
                      ? "terminated_or_replaced_contract"
                      : "different_matter_candidate",
                  }
                : {}),
            },
          },
          update: {},
        });
      }
    }
    if (!thread)
      throw new HttpError(
        409,
        "EMAIL_THREAD_UNAVAILABLE",
        "The original local message lifecycle is unavailable; review the source before importing.",
      );
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
        let pageToken: string | undefined =
          typeof details.historyPageToken === "string"
            ? details.historyPageToken
            : undefined;
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
          details = {
            ...details,
            historyPageToken: pageToken || null,
            historyStart: pageToken ? connection.cursor : null,
            importStatus: pageToken ? "history_importing" : "complete",
            syncLeaseUntil: new Date(Date.now() + 600000).toISOString(),
          };
          await prisma.integrationConnection.update({
            where: { id: connection.id },
            data: { details: details as Prisma.InputJsonValue },
          });
        } while (pageToken && pages < 20);
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
              historyPageToken: null,
              historyStart: null,
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
        purpose: z.enum(["password_reset", "intake_received"]),
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
    "gmail.send": (payload: unknown) => sendGmailJob(service, store, payload),
    "gmail.renew": renew,
    "system.email": systemEmail,
    [agentInvitationEmailTopic]: (payload: unknown) =>
      sendQueuedAgentInvitation(service, payload),
  };
}
import { createHash, randomUUID } from "node:crypto";
function createHashSafe(v: string) {
  return createHash("sha256").update(v).digest("hex").slice(0, 40);
}
