import { Router } from "express";
import { z } from "zod";
import { createHash } from "node:crypto";
import { prisma } from "@weatherly/db";
import {
  HttpError,
  assertCoordinator,
  principal,
  asyncHandler,
  encryptSecret,
  decryptSecret,
  newToken,
  hashToken,
  type Principal,
} from "@weatherly/platform";
import { requireMatter, audit, matterScope } from "@weatherly/matters";
import {
  uploadDocument,
  listDocuments,
  getDocument,
  createObjectStore,
} from "@weatherly/documents";
const base = "https://api-gateway.dotloop.com/public/v2";
const idSchema = z.string().regex(/^\d{1,20}$/);
const tokensSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  scope: z.string().optional(),
});
export function dotloopConfigured() {
  return Boolean(
    process.env.DOTLOOP_ENABLED === "true" &&
    process.env.DOTLOOP_CLIENT_ID &&
    process.env.DOTLOOP_CLIENT_SECRET &&
    process.env.DOTLOOP_REDIRECT_URI &&
    process.env.CREDENTIAL_ENCRYPTION_KEY,
  );
}
function configured() {
  if (!dotloopConfigured())
    throw new HttpError(
      503,
      "DOTLOOP_NOT_CONFIGURED",
      "Dotloop developer approval and account credentials must be configured first.",
    );
}
async function exchange(params: Record<string, string>) {
  configured();
  const response = await fetch("https://auth.dotloop.com/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.DOTLOOP_CLIENT_ID}:${process.env.DOTLOOP_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new HttpError(
      502,
      "DOTLOOP_AUTH_FAILED",
      "Dotloop authorization failed. Reconnect the approved account.",
    );
  return tokensSchema.parse(await response.json());
}
async function accessToken(ownerId: string) {
  configured();
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "IntegrationConnection" WHERE provider='dotloop' AND "ownerId"=${ownerId} FOR UPDATE`;
      const connection = await tx.integrationConnection.findUnique({
        where: { provider_ownerId: { provider: "dotloop", ownerId } },
      });
      if (!connection?.credentials || connection.status !== "connected")
        throw new HttpError(
          503,
          "DOTLOOP_DISCONNECTED",
          "Connect the approved Dotloop account.",
        );
      let tokens = tokensSchema.parse(
        JSON.parse(decryptSecret(connection.credentials)),
      );
      if (
        !connection.expiresAt ||
        connection.expiresAt.valueOf() < Date.now() + 60000
      ) {
        tokens = await exchange({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
        });
        await tx.integrationConnection.update({
          where: { id: connection.id },
          data: {
            credentials: encryptSecret(JSON.stringify(tokens)),
            expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          },
        });
      }
      return tokens.access_token;
    },
    { timeout: 45000 },
  );
}
async function request<T>(
  ownerId: string,
  path: string,
  binary = false,
): Promise<T> {
  const token = await accessToken(ownerId);
  const response = await fetch(base + path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: binary ? "application/pdf" : "application/json",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 301)
    throw new HttpError(
      409,
      "DOTLOOP_LOOP_MOVED",
      "This loop was merged in Dotloop. Review and relink the current loop.",
    );
  if (response.status === 401 || response.status === 403)
    throw new HttpError(
      403,
      "DOTLOOP_ACCESS_DENIED",
      "Dotloop access is missing or was revoked. Reconnect or use a manual upload.",
    );
  if (!response.ok)
    throw new HttpError(
      response.status === 404 ? 404 : 502,
      "DOTLOOP_REQUEST_FAILED",
      "Dotloop could not return this record. Check access or upload the document manually.",
    );
  if (binary) {
    if (!response.headers.get("content-type")?.includes("application/pdf"))
      throw new HttpError(
        422,
        "DOTLOOP_BINARY_UNAVAILABLE",
        "This account did not return a PDF. Upload the source manually.",
      );
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > 20 * 1024 * 1024)
      throw new HttpError(
        413,
        "DOCUMENT_TOO_LARGE",
        "Dotloop document exceeds20MB.",
      );
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing body");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.length;
      if (length > 20 * 1024 * 1024) {
        await reader.cancel();
        throw new HttpError(
          413,
          "DOCUMENT_TOO_LARGE",
          "Dotloop document exceeds20MB.",
        );
      }
      chunks.push(result.value);
    }
    return Buffer.concat(chunks) as T;
  }
  const body = (await response.json()) as { data: T };
  return body.data;
}
export async function connectDotloop(actor: Principal) {
  assertCoordinator(actor);
  configured();
  const state = newToken();
  await prisma.oAuthState.create({
    data: {
      provider: "dotloop",
      userId: actor.id,
      stateHash: hashToken(state),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  const url = new URL("https://auth.dotloop.com/oauth/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: process.env.DOTLOOP_CLIENT_ID!,
    redirect_uri: process.env.DOTLOOP_REDIRECT_URI!,
    state,
    redirect_on_deny: "true",
  }).toString();
  return { url: url.toString() };
}
export async function finishDotloop(actor: Principal, raw: unknown) {
  assertCoordinator(actor);
  configured();
  const input = z
    .object({
      state: z.string().min(32).max(200),
      code: z.string().min(1).max(500),
    })
    .parse(raw);
  const state = await prisma.oAuthState.findUnique({
    where: { stateHash: hashToken(input.state) },
  });
  if (!state || state.userId !== actor.id || state.provider !== "dotloop")
    throw new HttpError(
      400,
      "INVALID_OAUTH_STATE",
      "Invalid Dotloop authorization.",
    );
  const claimed = await prisma.oAuthState.updateMany({
    where: { id: state.id, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (!claimed.count)
    throw new HttpError(
      400,
      "INVALID_OAUTH_STATE",
      "Expired or already used Dotloop authorization.",
    );
  const tokens = await exchange({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: process.env.DOTLOOP_REDIRECT_URI!,
    state: input.state,
  });
  await prisma.integrationConnection.upsert({
    where: { provider_ownerId: { provider: "dotloop", ownerId: actor.id } },
    create: {
      provider: "dotloop",
      ownerId: actor.id,
      status: "connected",
      credentials: encryptSecret(JSON.stringify(tokens)),
      scopes: (tokens.scope || "").split(/[, ]+/),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
    update: {
      status: "connected",
      credentials: encryptSecret(JSON.stringify(tokens)),
      scopes: (tokens.scope || "").split(/[, ]+/),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
  });
  await audit(
    prisma,
    actor,
    "dotloop.connected",
    "IntegrationConnection",
    "dotloop",
    null,
  );
  return { connected: true };
}
export async function listDotloopLinks(actor: Principal, matterId?: string) {
  if (matterId) await requireMatter(actor, matterId);
  const allowed = await prisma.matter.findMany({
    where: { ...matterScope(actor), ...(matterId ? { id: matterId } : {}) },
    select: { id: true },
  });
  return prisma.dotloopLink.findMany({
    where: { matterId: { in: allowed.map((m) => m.id) } },
    select: {
      id: true,
      matterId: true,
      profileId: true,
      loopId: true,
      revision: true,
      status: true,
      lastSyncedAt: true,
      error: true,
    },
  });
}
export async function queueDotloopSync(actor: Principal, id: string) {
  assertCoordinator(actor);
  const link = await prisma.dotloopLink.findUnique({ where: { id } });
  if (!link || link.ownerId !== actor.id)
    throw new HttpError(404, "NOT_FOUND", "Loop link not found.");
  await requireMatter(actor, link.matterId);
  return prisma.outboxJob.create({
    data: {
      topic: "dotloop.sync",
      payload: { linkId: id },
      idempotencyKey: `dotloop:${id}:${newToken()}`,
    },
  });
}
export async function syncDotloop(linkId: string) {
  const link = await prisma.dotloopLink.findUniqueOrThrow({
    where: { id: linkId },
  });
  const user = await prisma.user.findUnique({ where: { id: link.ownerId } });
  const access = await prisma.auditEvent.findFirst({
    where: {
      entityType: "User",
      entityId: link.ownerId,
      action: { in: ["identity.access_revoked", "identity.access_restored"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (
    !user ||
    user.role !== "coordinator" ||
    access?.action === "identity.access_revoked"
  )
    throw new HttpError(
      403,
      "ACCESS_REVOKED",
      "Coordinator access was revoked.",
    );
  const actor: Principal = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: "coordinator",
    sessionId: "worker",
  };
  await requireMatter(actor, link.matterId);
  const claim = await prisma.dotloopLink.updateMany({
    where: {
      id: link.id,
      OR: [{ status: { not: "syncing" } }, { leaseUntil: { lt: new Date() } }],
    },
    data: {
      status: "syncing",
      leaseUntil: new Date(Date.now() + 120000),
      error: null,
    },
  });
  if (!claim.count)
    throw new HttpError(429, "SYNC_BUSY", "Another sync is running.");
  try {
    const folders = await request<{ id: number; name: string }[]>(
      link.ownerId,
      `/profile/${link.profileId}/loop/${link.loopId}/folder`,
    );
    const inventory: {
      id: string;
      folderId: string;
      name: string;
      updated: string;
      documentId?: string;
      status: string;
    }[] = [];
    for (const folder of folders) {
      idSchema.parse(String(folder.id));
      const documents = await request<
        { id: number; filename?: string; name?: string; updated?: string }[]
      >(
        link.ownerId,
        `/profile/${link.profileId}/loop/${link.loopId}/folder/${folder.id}/document`,
      );
      for (const document of documents) {
        idSchema.parse(String(document.id));
        await prisma.dotloopLink.update({
          where: { id: link.id },
          data: { leaseUntil: new Date(Date.now() + 120000) },
        });
        const name = (
          document.filename ||
          document.name ||
          `Dotloop-${document.id}.pdf`
        ).replace(/[^a-zA-Z0-9 ._-]/g, "_");
        const item = {
          id: String(document.id),
          folderId: String(folder.id),
          name,
          updated: document.updated || "",
          status: "manual_upload_required",
        };
        if (process.env.DOTLOOP_BINARY_DOWNLOAD_VERIFIED !== "true") {
          inventory.push(item);
          continue;
        }
        const bytes = await request<Buffer>(
          link.ownerId,
          `/profile/${link.profileId}/loop/${link.loopId}/folder/${folder.id}/document/${document.id}`,
          true,
        );
        const checksum = createHash("sha256").update(bytes).digest("hex");
        const category = `dotloop:${link.id}:${document.id}`;
        // Category is a provider identity, not an arbitrary upload URL. Reuse the
        // same document across retries even when a matter has >200 documents.
        const prior = await prisma.document.findFirst({
          where: { matterId: link.matterId, category },
        });
        const latest = prior
          ? (await getDocument(actor, prior.id)).versions[0]
          : undefined;
        let storedId = prior?.id;
        if (latest?.checksum !== checksum) {
          const stored = await uploadDocument(
            actor,
            { matterId: link.matterId, visibility: "coordinator", category },
            {
              originalname: name.endsWith(".pdf") ? name : name + ".pdf",
              buffer: bytes,
              size: bytes.length,
            },
            createObjectStore(),
            prior?.id,
          );
          storedId = stored.id;
        }
        inventory.push({ ...item, status: "imported", documentId: storedId });
      }
    }
    await prisma.dotloopLink.update({
      where: { id: link.id },
      data: {
        status: inventory.some((d) => d.status !== "imported")
          ? "manual_upload_required"
          : "synced",
        leaseUntil: null,
        lastSyncedAt: new Date(),
        metadata: { documents: inventory },
        error: inventory.some((d) => d.status !== "imported")
          ? "Binary download capability must be verified for this account; use manual upload until then."
          : null,
      },
    });
    await audit(
      prisma,
      actor,
      "dotloop.synced",
      "DotloopLink",
      link.id,
      link.matterId,
      { documentCount: inventory.length },
    );
  } catch (error) {
    await prisma.dotloopLink.update({
      where: { id: link.id },
      data: {
        status: "error",
        leaseUntil: null,
        error:
          error instanceof HttpError
            ? error.message
            : "Sync failed. Retry or use manual upload.",
      },
    });
    throw error;
  }
}
export function createDotloopRouter() {
  const r = Router();
  r.post(
    "/connect",
    asyncHandler(async (req, res) =>
      res.json(await connectDotloop(principal(req))),
    ),
  );
  r.get(
    "/callback",
    asyncHandler(async (req, res) => {
      await finishDotloop(principal(req), req.query);
      res.redirect(`${process.env.WEB_ORIGIN}/workspace/settings`);
    }),
  );
  r.post(
    "/disconnect",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      assertCoordinator(actor);
      await prisma.integrationConnection.updateMany({
        where: { provider: "dotloop", ownerId: actor.id },
        data: { status: "disconnected", credentials: null },
      });
      await audit(
        prisma,
        actor,
        "dotloop.disconnected",
        "IntegrationConnection",
        "dotloop",
        null,
      );
      res.json({ disconnected: true, providerRevocationRequired: true });
    }),
  );
  r.get(
    "/profiles",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      assertCoordinator(actor);
      res.json(await request(actor.id, "/profile"));
    }),
  );
  r.get(
    "/profiles/:id/loops",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      assertCoordinator(actor);
      const profile = idSchema.parse(req.params.id);
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .parse(req.query.page || 1);
      res.json(
        await request(
          actor.id,
          `/profile/${profile}/loop?batch_size=100&batch_number=${page}`,
        ),
      );
    }),
  );
  r.get(
    "/links",
    asyncHandler(async (req, res) =>
      res.json(
        await listDotloopLinks(
          principal(req),
          typeof req.query.matterId === "string"
            ? req.query.matterId
            : undefined,
        ),
      ),
    ),
  );
  r.post(
    "/links",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      assertCoordinator(actor);
      const input = z
        .object({
          matterId: z.string(),
          profileId: idSchema,
          loopId: idSchema,
          expectedRevision: z.number().int().positive().optional(),
        })
        .strict()
        .parse(req.body);
      await requireMatter(actor, input.matterId);
      await request(
        actor.id,
        `/profile/${input.profileId}/loop/${input.loopId}`,
      );
      const result = await prisma.$transaction(async (tx) => {
        const old = await tx.dotloopLink.findUnique({
          where: { matterId: input.matterId },
        });
        if (old) {
          const changed = await tx.dotloopLink.updateMany({
            where: {
              id: old.id,
              revision: input.expectedRevision || -1,
              status: { not: "syncing" },
            },
            data: {
              ownerId: actor.id,
              profileId: input.profileId,
              loopId: input.loopId,
              revision: { increment: 1 },
              status: "linked",
              metadata: {},
              error: null,
            },
          });
          if (!changed.count)
            throw new HttpError(
              409,
              "REVISION_CONFLICT",
              "The loop link changed or is syncing.",
            );
          return tx.dotloopLink.findUniqueOrThrow({ where: { id: old.id } });
        }
        return tx.dotloopLink.create({
          data: {
            matterId: input.matterId,
            ownerId: actor.id,
            profileId: input.profileId,
            loopId: input.loopId,
          },
        });
      });
      await audit(
        prisma,
        actor,
        "dotloop.linked",
        "DotloopLink",
        result.id,
        input.matterId,
        { profileId: input.profileId, loopId: input.loopId },
      );
      res.status(201).json(result);
    }),
  );
  r.post(
    "/links/:id/sync",
    asyncHandler(async (req, res) =>
      res
        .status(202)
        .json(await queueDotloopSync(principal(req), String(req.params.id))),
    ),
  );
  return r;
}
