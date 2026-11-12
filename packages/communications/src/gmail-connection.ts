import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@weatherly/db";
import {
  HttpError,
  assertCoordinator,
  encryptSecret,
  decryptSecret,
  hashToken,
  type Principal,
} from "@weatherly/platform";
import { audit } from "@weatherly/matters";
import { type Credentials } from "google-auth-library";
import { GMAIL_SCOPES, assertConfigured } from "./gateway";
import { asRecord } from "./policy";
import type { CommunicationsService } from "./service";

export async function connectionStatus(
  this: CommunicationsService,
  actor: Principal,
) {
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

export async function connect(this: CommunicationsService, actor: Principal) {
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

export async function callback(
  this: CommunicationsService,
  actor: Principal,
  input: unknown,
) {
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

export async function disconnect(
  this: CommunicationsService,
  actor: Principal,
) {
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

export async function requestGmail<T>(
  service: Pick<CommunicationsService, "provider">,
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
    const response = await service.provider.request<T>(
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

export async function queueSync(this: CommunicationsService, actor: Principal) {
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
