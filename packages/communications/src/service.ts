import { mergeFields } from "./merge-fields";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import {
  HttpError,
  assertCoordinator,
  encryptSecret,
  decryptSecret,
  hashToken,
  type Principal,
} from "@weatherly/platform";
import {
  requireMatter,
  matterScope,
  audit,
  revision,
} from "@weatherly/matters";
import { assignDocumentToMatter } from "@weatherly/documents";
import { type Credentials } from "google-auth-library";
import {
  GMAIL_SCOPES,
  communicationsConfig,
  createGmailProvider,
  assertConfigured,
  type CommunicationsConfig,
  type GmailProvider,
} from "./gateway";
import {
  asRecord,
  textArray,
  draftInput,
  recipientArray,
  recipientPolicy,
  validateMerge,
  mergeText,
  requireResolved,
} from "./policy";
export interface CommunicationsDependencies {
  config?: CommunicationsConfig;
  provider?: GmailProvider;
  fetch?: typeof fetch;
}
export class CommunicationsService {
  readonly config: CommunicationsConfig;
  readonly provider: GmailProvider;
  readonly fetch: typeof fetch;
  constructor(deps: CommunicationsDependencies = {}) {
    this.config = deps.config || communicationsConfig();
    this.provider = deps.provider || createGmailProvider(this.config);
    this.fetch = deps.fetch || fetch;
  }
  async connectionStatus(actor: Principal) {
    assertCoordinator(actor);
    const c = await prisma.integrationConnection.findUnique({
      where: { provider_ownerId: { provider: "gmail", ownerId: actor.id } },
    });
    let configured = true;
    try {
      assertConfigured(this.config);
    } catch {
      configured = false;
    }
    const details = asRecord(c?.details);
    return {
      provider: "gmail",
      configured,
      status: c?.status || "disconnected",
      displayEmail:
        c?.displayEmail || this.config.mailbox || "ireland@ireland.com",
      lastSyncedAt: c?.lastSyncedAt || null,
      outboundEnabled: this.config.outboundEnabled,
      watchExpiresAt: details.watchExpiresAt || null,
      lastError: details.lastError || null,
      importStatus: details.importStatus || null,
    };
  }
  async connect(actor: Principal) {
    assertCoordinator(actor);
    assertConfigured(this.config);
    const state = randomBytes(32).toString("base64url"),
      verifier = randomBytes(48).toString("base64url");
    await prisma.oAuthState.create({
      data: {
        provider: "gmail",
        stateHash: hashToken(state),
        userId: actor.id,
        verifier: encryptSecret(verifier),
        expiresAt: new Date(Date.now() + 10 * 60000),
      },
    });
    return {
      url: this.provider.authorizationUrl(
        state,
        createHash("sha256").update(verifier).digest("base64url"),
      ),
    };
  }
  async callback(actor: Principal, input: unknown) {
    assertCoordinator(actor);
    assertConfigured(this.config);
    const { state, code } = z
      .object({ state: z.string().min(30), code: z.string().min(1).max(5000) })
      .strict()
      .parse(input);
    const found = await prisma.oAuthState.findUnique({
      where: { stateHash: hashToken(state) },
    });
    if (
      !found ||
      found.userId !== actor.id ||
      found.provider !== "gmail" ||
      found.consumedAt ||
      found.expiresAt <= new Date() ||
      !found.verifier
    )
      throw new HttpError(
        400,
        "INVALID_OAUTH_STATE",
        "Authorization expired or was already used; connect again",
      );
    const claim = await prisma.oAuthState.updateMany({
      where: { id: found.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (!claim.count)
      throw new HttpError(
        400,
        "INVALID_OAUTH_STATE",
        "Authorization was already used",
      );
    const tokens = await this.provider.exchange(
      code,
      decryptSecret(found.verifier),
    );
    const scopes = new Set(tokens.scope?.split(" ") || []);
    if (!GMAIL_SCOPES.every((s) => scopes.has(s)))
      throw new HttpError(
        403,
        "INSUFFICIENT_GMAIL_SCOPES",
        "Grant only the requested read and send access to connect",
      );
    const result = await this.provider.request<{
      emailAddress: string;
      historyId: string;
    }>(tokens, "/profile");
    if (
      result.data.emailAddress.toLowerCase() !==
        this.config.mailbox?.toLowerCase() ||
      result.data.emailAddress.toLowerCase() === "ireland@ireland.com"
    )
      throw new HttpError(
        403,
        "MAILBOX_MISMATCH",
        "Connect the configured Weatherly mailbox",
      );
    const old = await prisma.integrationConnection.findUnique({
      where: { provider_ownerId: { provider: "gmail", ownerId: actor.id } },
    });
    const previous = old?.credentials
      ? (JSON.parse(decryptSecret(old.credentials)) as Credentials)
      : {};
    const saved = { ...previous, ...tokens, ...result.tokens };
    if (!saved.refresh_token)
      throw new HttpError(
        422,
        "REFRESH_TOKEN_REQUIRED",
        "Reconnect with offline consent to allow reliable synchronization",
      );
    await prisma.$transaction(async (tx) => {
      await tx.integrationConnection.upsert({
        where: { provider_ownerId: { provider: "gmail", ownerId: actor.id } },
        create: {
          provider: "gmail",
          ownerId: actor.id,
          status: "connected",
          displayEmail: result.data.emailAddress,
          credentials: encryptSecret(JSON.stringify(saved)),
          scopes: [...scopes],
          expiresAt: saved.expiry_date ? new Date(saved.expiry_date) : null,
        },
        update: {
          status: "connected",
          displayEmail: result.data.emailAddress,
          credentials: encryptSecret(JSON.stringify(saved)),
          scopes: [...scopes],
          expiresAt: saved.expiry_date ? new Date(saved.expiry_date) : null,
          details: { lastError: null },
        },
      });
      await audit(
        tx,
        actor,
        "gmail.connected",
        "IntegrationConnection",
        actor.id,
        null,
        { mailbox: result.data.emailAddress },
      );
      await tx.outboxJob.create({
        data: {
          topic: "gmail.sync",
          idempotencyKey: `gmail-connect:${found.id}`,
          payload: { ownerId: actor.id },
        },
      });
      if (this.config.pubsubTopic)
        await tx.outboxJob.create({
          data: {
            topic: "gmail.renew",
            idempotencyKey: `gmail-renew-connect:${found.id}`,
            payload: { ownerId: actor.id },
          },
        });
    });
    return this.connectionStatus(actor);
  }
  async disconnect(actor: Principal) {
    assertCoordinator(actor);
    const c = await prisma.integrationConnection.findUnique({
      where: { provider_ownerId: { provider: "gmail", ownerId: actor.id } },
    });
    if (c?.credentials) {
      try {
        await this.provider.revoke(JSON.parse(decryptSecret(c.credentials)));
      } catch {
        /* Local revocation always completes; provider revocation must be confirmed in account settings if unavailable. */
      }
    }
    await prisma.$transaction(async (tx) => {
      await tx.integrationConnection.updateMany({
        where: { provider: "gmail", ownerId: actor.id },
        data: {
          credentials: null,
          status: "disconnected",
          cursor: null,
          expiresAt: null,
          details: { disconnectedAt: new Date().toISOString() },
        },
      });
      await tx.outboxJob.updateMany({
        where: {
          topic: { in: ["gmail.send", "gmail.sync", "gmail.renew"] },
          state: "pending",
          payload: { path: ["ownerId"], equals: actor.id },
        },
        data: { state: "cancelled" },
      });
      await audit(
        tx,
        actor,
        "gmail.disconnected",
        "IntegrationConnection",
        actor.id,
        null,
      );
    });
    return { disconnected: true };
  }
  async request<T>(
    ownerId: string,
    endpoint: string,
    method: "GET" | "POST" = "GET",
    body?: unknown,
  ) {
    const c = await prisma.integrationConnection.findUnique({
      where: { provider_ownerId: { provider: "gmail", ownerId } },
    });
    if (!c || c.status !== "connected" || !c.credentials)
      throw new HttpError(
        503,
        "GMAIL_NOT_CONNECTED",
        "Connect the Weatherly mailbox first",
      );
    try {
      const response = await this.provider.request<T>(
        JSON.parse(decryptSecret(c.credentials)),
        endpoint,
        method,
        body,
      );
      await prisma.integrationConnection.updateMany({
        where: { id: c.id, status: "connected" },
        data: {
          credentials: encryptSecret(JSON.stringify(response.tokens)),
          expiresAt: response.tokens.expiry_date
            ? new Date(response.tokens.expiry_date)
            : null,
        },
      });
      return response.data;
    } catch (error) {
      if (error instanceof HttpError && error.code === "GMAIL_AUTHORIZATION")
        await prisma.integrationConnection.update({
          where: { id: c.id },
          data: {
            status: "needs_reconnect",
            details: {
              ...asRecord(c.details),
              lastError: "Authorization expired or revoked",
            },
          },
        });
      throw error;
    }
  }
  async queueSync(actor: Principal) {
    assertCoordinator(actor);
    assertConfigured(this.config);
    const c = await prisma.integrationConnection.findUnique({
      where: { provider_ownerId: { provider: "gmail", ownerId: actor.id } },
    });
    if (c?.status !== "connected")
      throw new HttpError(
        503,
        "GMAIL_NOT_CONNECTED",
        "Connect the Weatherly mailbox first",
      );
    const job = await prisma.outboxJob.create({
      data: {
        topic: "gmail.sync",
        idempotencyKey: `gmail-sync-manual:${actor.id}:${randomUUID()}`,
        payload: { ownerId: actor.id },
      },
    });
    return { queued: true, jobId: job.id };
  }
  async threadReadScope(
    actor: Principal,
    matterId?: string,
  ): Promise<Prisma.EmailThreadWhereInput> {
    if (matterId) await requireMatter(actor, matterId);
    if (actor.role === "coordinator") return matterId ? { matterId } : {};
    const matters = await prisma.matter.findMany({
      where: matterScope(actor),
      select: { id: true },
    });
    const allowed = matters.map((m) => m.id);
    return { matterId: matterId ? matterId : { in: allowed } };
  }
  messageVisibility(actor: Principal): Prisma.EmailMessageWhereInput {
    return actor.role === "coordinator"
      ? {}
      : {
          OR: (actor.role === "client" ? ["client"] : ["agent", "client"]).map(
            (visibility) => ({
              details: { path: ["visibility"], equals: visibility },
            }),
          ),
        };
  }
  async listThreads(
    actor: Principal,
    matterId?: string,
    options: { cursor?: string; limit?: number } = {},
  ) {
    const limit = z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(100)
      .parse(options.limit);
    const where: Prisma.EmailThreadWhereInput = {
      ...(await this.threadReadScope(actor, matterId)),
      ...(actor.role === "coordinator"
        ? {}
        : { messages: { some: this.messageVisibility(actor) } }),
    };
    if (
      options.cursor &&
      !(await prisma.emailThread.findFirst({
        where: { AND: [where, { id: options.cursor }] },
        select: { id: true },
      }))
    )
      throw new HttpError(404, "THREAD_NOT_FOUND", "Thread cursor not found");
    const pagination = {
      orderBy: [{ updatedAt: "desc" as const }, { id: "desc" as const }],
      take: limit,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    };
    if (actor.role === "coordinator")
      return prisma.emailThread.findMany({
        where,
        ...pagination,
        include: {
          messages: {
            orderBy: [{ sentAt: "desc" }, { id: "desc" }],
            take: 100,
          },
        },
      });
    const threads = await prisma.emailThread.findMany({
      where,
      ...pagination,
      select: {
        id: true,
        matterId: true,
        subject: true,
        status: true,
        revision: true,
        updatedAt: true,
        messages: {
          where: this.messageVisibility(actor),
          select: {
            id: true,
            fromEmail: true,
            to: true,
            cc: true,
            subject: true,
            text: true,
            sentAt: true,
            direction: true,
            revision: true,
          },
          orderBy: [{ sentAt: "asc" }, { id: "asc" }],
          take: 100,
        },
      },
    });
    return threads.map((t) => ({
      ...t,
      subject: t.messages[0]?.subject || "(Shared message)",
    }));
  }
  async listMessages(
    actor: Principal,
    matterId?: string,
    options: { cursor?: string; limit?: number; q?: string } = {},
  ) {
    const limit = z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(200)
      .parse(options.limit);
    const where: Prisma.EmailMessageWhereInput = {
      AND: [
        { thread: { is: await this.threadReadScope(actor, matterId) } },
        this.messageVisibility(actor),
        options.q
          ? {
              OR: [
                { subject: { contains: options.q, mode: "insensitive" } },
                { text: { contains: options.q, mode: "insensitive" } },
              ],
            }
          : {},
      ],
    };
    if (
      options.cursor &&
      !(await prisma.emailMessage.findFirst({
        where: { AND: [where, { id: options.cursor }] },
        select: { id: true },
      }))
    )
      throw new HttpError(404, "MESSAGE_NOT_FOUND", "Message cursor not found");
    const pagination = {
      orderBy: [{ sentAt: "desc" as const }, { id: "desc" as const }],
      take: limit,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    };
    if (actor.role === "coordinator") {
      const rows = await prisma.emailMessage.findMany({
        where,
        ...pagination,
        include: { thread: { select: { id: true, matterId: true } } },
      });
      return rows.map(({ thread, ...m }) => ({
        ...m,
        matterId: thread.matterId,
      }));
    }
    const rows = await prisma.emailMessage.findMany({
      where,
      ...pagination,
      select: {
        id: true,
        threadId: true,
        fromEmail: true,
        to: true,
        cc: true,
        subject: true,
        text: true,
        sentAt: true,
        direction: true,
        revision: true,
        thread: { select: { matterId: true } },
      },
    });
    return rows.map(({ thread, ...m }) => ({
      ...m,
      matterId: thread.matterId,
    }));
  }
  async associateThread(actor: Principal, id: string, input: unknown) {
    assertCoordinator(actor);
    const { matterId, expectedRevision } = z
      .object({ matterId: z.string().nullable(), expectedRevision: revision })
      .strict()
      .parse(input);
    return prisma.$transaction(async (tx) => {
      const thread = await tx.emailThread.findUnique({
        where: { id },
        include: { messages: true },
      });
      if (!thread)
        throw new HttpError(404, "THREAD_NOT_FOUND", "Thread not found");
      if (matterId) {
        await requireMatter(actor, matterId, true, tx);
        for (const m of thread.messages)
          for (const docId of textArray(asRecord(m.details).documentIds))
            await assignDocumentToMatter(actor, docId, matterId, tx);
      }
      const claim = await tx.emailThread.updateMany({
        where: { id, revision: expectedRevision },
        data: { revision: { increment: 1 } },
      });
      if (!claim.count)
        throw new HttpError(
          409,
          "REVISION_CONFLICT",
          "Thread association changed; refresh",
        );
      if (thread.matterId !== matterId) {
        for (const message of thread.messages)
          await tx.emailMessage.update({
            where: { id: message.id },
            data: {
              revision: { increment: 1 },
              details: {
                ...asRecord(message.details),
                visibility: "coordinator",
                sharingResetReason: "Matter association changed",
              },
            },
          });
      }
      const row = await tx.emailThread.update({
        where: { id },
        data: {
          matterId,
          status: matterId ? "assigned" : "unassigned",
          details: {
            ...asRecord(thread.details),
            associationReviewedBy: actor.id,
            associationReviewedAt: new Date().toISOString(),
          },
        },
      });
      await audit(
        tx,
        actor,
        "email.thread_associated",
        "EmailThread",
        id,
        matterId,
        { previousMatterId: thread.matterId },
      );
      return row;
    });
  }
  async shareMessage(actor: Principal, id: string, input: unknown) {
    assertCoordinator(actor);
    const { expectedRevision, visibility } = z
      .object({
        expectedRevision: revision,
        visibility: z.enum(["coordinator", "agent", "client"]),
      })
      .strict()
      .parse(input);
    return prisma.$transaction(async (tx) => {
      const message = await tx.emailMessage.findUnique({
        where: { id },
        include: { thread: true },
      });
      if (!message)
        throw new HttpError(404, "MESSAGE_NOT_FOUND", "Message not found");
      if (visibility !== "coordinator" && !message.thread.matterId)
        throw new HttpError(
          422,
          "MATTER_REQUIRED",
          "Associate the message with a matter before sharing",
        );
      const changed = await tx.emailMessage.updateMany({
        where: { id, revision: expectedRevision },
        data: {
          revision: { increment: 1 },
          details: { ...asRecord(message.details), visibility },
        },
      });
      if (!changed.count)
        throw new HttpError(
          409,
          "REVISION_CONFLICT",
          "Message changed; refresh",
        );
      await audit(
        tx,
        actor,
        "email.visibility_changed",
        "EmailMessage",
        id,
        message.thread.matterId,
        { visibility },
      );
      return tx.emailMessage.findUniqueOrThrow({ where: { id } });
    });
  }
  async listDrafts(
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
  async createDraft(actor: Principal, input: unknown) {
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
            subjectOverride: rendered
              ? rendered.subject !== data.subject
              : false,
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
  async updateDraft(actor: Principal, id: string, input: unknown) {
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
  async deleteDraft(actor: Principal, id: string, expectedRevision: number) {
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
  async validateAttachments(actor: Principal, matterId: string, ids: string[]) {
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
  async queueSend(actor: Principal, id: string, input: unknown) {
    assertCoordinator(actor);
    const { revision: expectedRevision } = z
      .object({ revision, confirmed: z.literal(true) })
      .strict()
      .parse(input);
    const old = await prisma.emailDraft.findUnique({ where: { id } });
    if (!old) throw new HttpError(404, "DRAFT_NOT_FOUND", "Draft not found");
    await requireMatter(actor, old.matterId, true);
    const sendKey = `gmail-draft:${id}:${expectedRevision}`;
    if (
      old.sendKey === sendKey &&
      ["queued", "sending", "sent", "delivery_unknown"].includes(old.status)
    )
      return old;
    assertConfigured(this.config, true);
    requireResolved(old.subject, old.body);
    const recipients = await recipientPolicy(
      actor,
      old.matterId,
      textArray(old.to),
      textArray(old.cc),
    );
    if (
      JSON.stringify(recipients.to) !== JSON.stringify(old.to) ||
      JSON.stringify(recipients.cc) !== JSON.stringify(old.cc)
    )
      throw new HttpError(
        409,
        "RECIPIENT_PREVIEW_CHANGED",
        "Contact policy changed; save and review the updated recipients",
      );
    await this.validateAttachments(
      actor,
      old.matterId,
      textArray(old.attachmentIds),
    );
    const connection = await prisma.integrationConnection.findUnique({
      where: { provider_ownerId: { provider: "gmail", ownerId: actor.id } },
    });
    if (connection?.status !== "connected")
      throw new HttpError(
        503,
        "GMAIL_NOT_CONNECTED",
        "Connect the Weatherly mailbox first",
      );
    const attachments = await prisma.documentVersion.findMany({
      where: { documentId: { in: textArray(old.attachmentIds) } },
      orderBy: { version: "desc" },
    });
    const selected = new Map<string, (typeof attachments)[number]>();
    for (const a of attachments)
      if (!selected.has(a.documentId)) selected.set(a.documentId, a);
    const snapshot = {
      to: recipients.to,
      cc: recipients.cc,
      subject: old.subject,
      body: old.body,
      attachments: [...selected.values()].map((v) => ({
        documentId: v.documentId,
        versionId: v.id,
        checksum: v.checksum,
      })),
      replyToMessageId: asRecord(old.details).replyToMessageId || null,
      approvedById: actor.id,
      approvedAt: new Date().toISOString(),
      approvedRevision: expectedRevision,
      sourceTasks: asRecord(old.details).templateId
        ? await prisma.task.findMany({
            where: { matterId: old.matterId, dueDate: { not: null } },
            select: { id: true, revision: true },
          })
        : [],
      sourceDeadlines: asRecord(old.details).templateId
        ? await prisma.deadline.findMany({
            where: { matterId: old.matterId },
            select: { id: true, revision: true },
          })
        : [],
    };
    return prisma.$transaction(async (tx) => {
      const changed = await tx.emailDraft.updateMany({
        where: { id, revision: expectedRevision, status: "draft" },
        data: {
          status: "queued",
          approvedAt: new Date(),
          sendKey,
          details: { ...asRecord(old.details), approvedSnapshot: snapshot },
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
  async reconcileSend(actor: Principal, id: string, input: unknown) {
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
      const changed = await tx.emailDraft.updateMany({
        where: {
          id,
          revision: expectedRevision,
          status: { in: ["delivery_unknown", "sending"] },
        },
        data: {
          status: "sent",
          providerMessageId: candidate.id,
          sentAt: new Date(),
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
  async listTemplates(actor: Principal, includeInactive = false) {
    assertCoordinator(actor);
    return prisma.communicationTemplate.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: "asc" },
      take: 200,
    });
  }
  async saveTemplate(actor: Principal, input: unknown, id?: string) {
    assertCoordinator(actor);
    const schema = z
      .object({
        name: z.string().min(1).max(150),
        side: z.enum(["buyer", "seller", "both"]),
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
  async availableMergeFields(actor: Principal, matterId: string) {
    assertCoordinator(actor);
    return mergeFields(actor, matterId);
  }
  async renderInDb(
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
  async renderTemplate(actor: Principal, id: string, input: unknown) {
    return this.renderInDb(actor, id, input);
  }
  async refreshTemplateDrafts(
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
              subjectOverride ||
              bodyOverride ||
              !!generated.missingFields.length,
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
  async resetTemplate(actor: Principal, id: string, input: unknown) {
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
      throw new HttpError(
        422,
        "NO_TEMPLATE",
        "This draft has no saved template",
      );
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
  async sendSystemEmail(input: {
    to: string;
    subject: string;
    text: string;
    purpose: "password_reset";
  }) {
    if (
      !this.config.outboundEnabled ||
      !this.config.resendApiKey ||
      !this.config.systemFrom ||
      this.config.systemFrom.toLowerCase().includes("ireland@ireland.com")
    )
      throw new HttpError(
        503,
        "SYSTEM_EMAIL_NOT_CONFIGURED",
        "Account recovery email is not configured",
      );
    const data = z
      .object({
        to: z.email(),
        subject: z.string().max(998),
        text: z.string().max(20000),
        purpose: z.literal("password_reset"),
      })
      .parse(input);
    if (data.to.toLowerCase() === "ireland@ireland.com")
      throw new HttpError(
        503,
        "PLACEHOLDER_EMAIL",
        "The preview address cannot receive external messages",
      );
    const key = `system-email:${hashToken(JSON.stringify(data))}`;
    return prisma.outboxJob
      .upsert({
        where: { idempotencyKey: key },
        create: {
          topic: "system.email",
          idempotencyKey: key,
          payload: {
            ...data,
            expiresAt: new Date(Date.now() + 30 * 60000).toISOString(),
          },
        },
        update: {},
      })
      .then(() => undefined);
  }
}
export const createCommunicationsService = (
  deps: CommunicationsDependencies = {},
) => new CommunicationsService(deps);
