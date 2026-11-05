import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Credentials } from "google-auth-library";
import { prisma } from "@weatherly/db";
import { encryptSecret, type Principal } from "@weatherly/platform";
import { createCommunicationsService } from "../src/service";
import { createCommunicationJobHandlers } from "../src/jobs";
import { GMAIL_SCOPES, type GmailProvider } from "../src/gateway";
const suffix = randomUUID(),
  ownerId = "lifecycle-owner-" + suffix,
  providerThreadId = "true-gmail-thread-" + suffix;
const mailbox = "lifecycle-" + suffix + "@example.test",
  lender = "lender-" + suffix + "@example.test";
const owner: Principal = {
  id: ownerId,
  name: "Synthetic owner",
  email: mailbox,
  role: "coordinator",
  sessionId: suffix,
};
const tokens = {
  access_token: "synthetic-access",
  refresh_token: "synthetic-refresh",
  scope: GMAIL_SCOPES.join(" "),
  expiry_date: Date.now() + 3600000,
};
let importIds: string[] = [],
  sendBody: Record<string, unknown> | undefined;
const provider: GmailProvider = {
  authorizationUrl: () => "",
  exchange: async () => tokens,
  revoke: async () => {},
  request: async <T>(
    _tokens: Credentials,
    path: string,
    _method?: "GET" | "POST",
    body?: unknown,
  ) => {
    let data: unknown;
    if (path.startsWith("/history?"))
      data = {
        history: [
          {
            messagesAdded: importIds.map((id) => ({
              message: { id, threadId: providerThreadId },
            })),
          },
        ],
        historyId: String(Date.now()),
      };
    else if (path.startsWith("/messages/") && path.includes("?format=raw")) {
      const id = decodeURIComponent(path.split("/messages/")[1].split("?")[0]);
      data = {
        id,
        threadId: providerThreadId,
        raw: Buffer.from(
          `From: Lender <${lender}>\r\nTo: ${mailbox}\r\nSubject: 77 Lifecycle Lane\r\nMessage-ID: <${id}@example.test>\r\nContent-Type: text/plain\r\n\r\nSynthetic ${id} about 77 Lifecycle Lane.`,
        ).toString("base64url"),
        internalDate: String(Date.now()),
      };
    } else if (path === "/messages/send") {
      sendBody = body as Record<string, unknown>;
      data = { id: "sent-" + suffix, threadId: providerThreadId };
    } else throw Error("Unexpected synthetic endpoint " + path);
    return { data: data as T, tokens };
  },
};
const service = createCommunicationsService({
  provider,
  config: {
    enabled: true,
    outboundEnabled: true,
    mailbox,
    clientId: "synthetic",
    clientSecret: "synthetic",
    redirectUri: "http://127.0.0.1/callback",
  },
});
const jobs = createCommunicationJobHandlers(service, {
  store: {
    put: async () => {},
    get: async () => Buffer.alloc(0),
    remove: async () => {},
  },
});
const matterIds: string[] = [];
beforeAll(async () => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString(
    "base64",
  );
  await prisma.user.create({
    data: {
      id: ownerId,
      name: owner.name,
      email: mailbox,
      role: "coordinator",
    },
  });
  await prisma.integrationConnection.create({
    data: {
      provider: "gmail",
      ownerId,
      status: "connected",
      displayEmail: mailbox,
      credentials: encryptSecret(JSON.stringify(tokens)),
      scopes: GMAIL_SCOPES,
      cursor: "1",
      details: {},
    },
  });
});
afterAll(async () => {
  await prisma.emailDraft.deleteMany({ where: { createdById: ownerId } });
  await prisma.emailThread.deleteMany({ where: { ownerId } });
  await prisma.integrationConnection.deleteMany({ where: { ownerId } });
  await prisma.outboxJob.deleteMany({
    where: { payload: { path: ["ownerId"], equals: ownerId } },
  });
  await prisma.matter.deleteMany({ where: { id: { in: matterIds } } });
  await prisma.auditEvent.deleteMany({ where: { actorId: ownerId } });
  await prisma.user.delete({ where: { id: ownerId } });
  await prisma.$disconnect();
});
describe("one actual Gmail thread with separate contract lifecycles", () => {
  it("keeps old messages stable, holds new-cycle mail for manual association, and replies through the actual provider ID", async () => {
    const previous = await prisma.matter.create({
      data: {
        title: "Prior terminated contract",
        propertyAddress: "77 Lifecycle Lane",
        side: "buyer",
        packageCode: "essentials",
        stage: "terminated",
      },
    });
    matterIds.push(previous.id);
    const replacement = await prisma.matter.create({
      data: {
        title: "New replacement contract",
        propertyAddress: "77 Lifecycle Lane",
        side: "buyer",
        packageCode: "essentials",
        stage: "under_contract",
        details: {
          replacesMatterId: previous.id,
          contacts: [{ email: lender, role: "lender" }],
        },
      },
    });
    matterIds.push(replacement.id);
    const oldThread = await prisma.emailThread.create({
      data: {
        ownerId,
        providerThreadId,
        lifecycleKey: "primary",
        matterId: previous.id,
        subject: "Old contract",
        status: "assigned",
        createdAt: new Date(Date.now() - 86400000),
      },
    });
    const oldMessage = await prisma.emailMessage.create({
      data: {
        providerMessageId: "old-" + suffix,
        threadId: oldThread.id,
        fromEmail: lender,
        subject: "Old evidence",
        text: "Original contract history",
        sentAt: new Date(),
        direction: "inbound",
        details: {},
      },
    });
    importIds = ["new-" + suffix];
    await jobs["gmail.sync"]({ ownerId });
    const review = await prisma.emailThread.findUniqueOrThrow({
      where: {
        ownerId_providerThreadId_lifecycleKey: {
          ownerId,
          providerThreadId,
          lifecycleKey: "review:" + oldThread.id,
        },
      },
    });
    expect(review).toMatchObject({
      matterId: null,
      status: "review_required",
      providerThreadId,
      details: {
        previousLifecycleThreadId: oldThread.id,
        previousMatterId: previous.id,
        candidateMatterIds: expect.arrayContaining([replacement.id]),
      },
    });
    expect(
      (
        await prisma.emailMessage.findUniqueOrThrow({
          where: { id: oldMessage.id },
        })
      ).threadId,
    ).toBe(oldThread.id);
    const incoming = await prisma.emailMessage.findUniqueOrThrow({
      where: { providerMessageId: "new-" + suffix },
    });
    expect(incoming.threadId).toBe(review.id);
    await service.associateThread(owner, review.id, {
      expectedRevision: review.revision,
      matterId: replacement.id,
    });
    importIds = ["old-" + suffix, "next-" + suffix];
    await jobs["gmail.sync"]({ ownerId });
    expect(
      (
        await prisma.emailMessage.findUniqueOrThrow({
          where: { id: oldMessage.id },
        })
      ).threadId,
    ).toBe(oldThread.id);
    const next = await prisma.emailMessage.findUniqueOrThrow({
      where: { providerMessageId: "next-" + suffix },
    });
    expect(next.threadId).toBe(review.id);
    expect(
      (
        await prisma.emailThread.findUniqueOrThrow({
          where: { id: oldThread.id },
        })
      ).matterId,
    ).toBe(previous.id);
    const draft = await service.createDraft(owner, {
      matterId: replacement.id,
      to: [lender],
      subject: "Re: replacement closing",
      body: "Synthetic approved reply",
      replyToMessageId: next.id,
    });
    const queued = await service.queueSend(owner, draft.id, {
      revision: draft.revision,
      confirmed: true,
    });
    await jobs["gmail.send"]({
      ownerId,
      draftId: draft.id,
      sendKey: queued.sendKey!,
    });
    expect(sendBody?.threadId).toBe(providerThreadId);
    expect(String(sendBody?.threadId)).not.toContain("review:");
    expect(
      (
        await prisma.emailMessage.findUniqueOrThrow({
          where: { providerMessageId: "sent-" + suffix },
        })
      ).threadId,
    ).toBe(review.id);
    await prisma.matter.update({
      where: { id: replacement.id },
      data: { stage: "terminated" },
    });
    importIds = ["third-" + suffix];
    await jobs["gmail.sync"]({ ownerId });
    const third = await prisma.emailMessage.findUniqueOrThrow({
      where: { providerMessageId: "third-" + suffix },
      include: { thread: true },
    });
    expect(third.thread).toMatchObject({
      matterId: null,
      status: "review_required",
      providerThreadId,
      lifecycleKey: "review:" + review.id,
    });
    expect(
      (
        await prisma.emailMessage.findUniqueOrThrow({
          where: { id: incoming.id },
        })
      ).threadId,
    ).toBe(review.id);
  });
});
