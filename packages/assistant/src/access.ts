import { z } from "zod";
import { prisma } from "@weatherly/db";
import {
  hashToken,
  newToken,
  HttpError,
  assertCoordinator,
  type Principal,
} from "@weatherly/platform";
import { audit } from "@weatherly/matters";

const manifestSchema = z.array(
  z.object({
    id: z.string().min(1),
    redirectUris: z.array(z.url()).min(1),
    evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
);
export function approvedManifest() {
  try {
    return manifestSchema.parse(
      JSON.parse(process.env.MCP_APPROVED_CLIENTS_JSON || "[]"),
    );
  } catch {
    throw new HttpError(
      503,
      "MCP_CONFIGURATION",
      "Approved assistant deployments are not configured correctly.",
    );
  }
}
export function mcpEnabled() {
  return process.env.MCP_ENABLED === "true" && approvedManifest().length > 0;
}
export async function registerClient(actor: Principal, raw: unknown) {
  assertCoordinator(actor);
  const input = z
    .object({
      id: z.string().max(100),
      name: z.string().min(1).max(100),
      complianceEvidence: z.string().min(50).max(10000),
    })
    .strict()
    .parse(raw);
  const trusted = approvedManifest().find(
    (c) =>
      c.id === input.id &&
      c.evidenceHash === hashToken(input.complianceEvidence),
  );
  if (!trusted)
    throw new HttpError(
      403,
      "CLIENT_NOT_APPROVED",
      "The deployment and its OpenRouter ZDR controls must be independently approved in the server configuration first.",
    );
  for (const value of trusted.redirectUris) {
    const url = new URL(value);
    if (
      url.protocol !== "https:" &&
      !(
        process.env.APP_ENV === "local" &&
        ["127.0.0.1", "localhost"].includes(url.hostname)
      )
    )
      throw new HttpError(
        422,
        "INVALID_REDIRECT",
        "Approved clients must use HTTPS redirect URLs.",
      );
    if (url.hash || url.username || url.password)
      throw new HttpError(422, "INVALID_REDIRECT", "Invalid redirect URI.");
  }
  const client = await prisma.assistantClient.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      name: input.name,
      redirectUris: trusted.redirectUris,
      approved: true,
      complianceEvidence: input.complianceEvidence,
      approvedById: actor.id,
    },
    update: {
      name: input.name,
      redirectUris: trusted.redirectUris,
      approved: true,
      complianceEvidence: input.complianceEvidence,
      approvedById: actor.id,
    },
  });
  await audit(
    prisma,
    actor,
    "assistant.client_approved",
    "AssistantClient",
    client.id,
    null,
    { evidenceHash: trusted.evidenceHash },
  );
  return { id: client.id, name: client.name, approved: true };
}
export async function trustedClient(id: string) {
  const client = await prisma.assistantClient.findUnique({ where: { id } });
  const manifest = approvedManifest().find((c) => c.id === id);
  if (
    !mcpEnabled() ||
    !client?.approved ||
    !manifest ||
    hashToken(client.complianceEvidence) !== manifest.evidenceHash ||
    JSON.stringify(client.redirectUris) !==
      JSON.stringify(manifest.redirectUris)
  )
    throw new HttpError(
      403,
      "CLIENT_NOT_APPROVED",
      "This external assistant deployment is not approved for client information.",
    );
  return client;
}
export async function grantPrincipal(token: string) {
  const grant = await prisma.assistantGrant.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (
    !grant ||
    !grant.clientId ||
    !grant.approvedClient ||
    grant.revokedAt ||
    grant.expiresAt <= new Date()
  )
    throw new HttpError(
      401,
      "INVALID_TOKEN",
      "The assistant grant expired or was revoked.",
    );
  await trustedClient(grant.clientId);
  const user = await prisma.user.findUnique({ where: { id: grant.userId } });
  const access = await prisma.auditEvent.findFirst({
    where: {
      entityType: "User",
      entityId: grant.userId,
      action: { in: ["identity.access_revoked", "identity.access_restored"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (
    access?.action === "identity.access_revoked" ||
    !user ||
    user.role !== "coordinator"
  )
    throw new HttpError(
      403,
      "ACCESS_REVOKED",
      "The account no longer has coordinator access.",
    );
  if (!Array.isArray(grant.scopes) || !grant.scopes.includes("weatherly:read"))
    throw new HttpError(403, "SCOPE_DENIED", "A read grant is required.");
  return {
    grant,
    actor: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: "coordinator",
      sessionId: `mcp:${grant.id}`,
    } as Principal,
  };
}
export async function consentDetails(actor: Principal, id: string) {
  assertCoordinator(actor);
  const request = await prisma.assistantAuthorization.findFirst({
    where: {
      id,
      userId: actor.id,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!request)
    throw new HttpError(
      404,
      "CONSENT_EXPIRED",
      "This authorization request expired.",
    );
  const client = await trustedClient(request.clientId);
  return {
    id: request.id,
    clientName: client.name,
    scope: "weatherly:read",
    expiresAt: request.expiresAt,
    warning:
      "This assistant can read your authorized transaction records. Its deployment has been approved to process them only through OpenRouter ZDR. Revoke access at any time.",
  };
}
export async function approveConsent(
  actor: Principal,
  id: string,
  approved: boolean,
) {
  await consentDetails(actor, id);
  const code = newToken();
  return prisma.$transaction(async (tx) => {
    const request = await tx.assistantAuthorization.findUniqueOrThrow({
      where: { id },
    });
    const changed = await tx.assistantAuthorization.updateMany({
      where: {
        id,
        userId: actor.id,
        authorizedAt: null,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: approved
        ? { authorizedAt: new Date(), codeHash: hashToken(code) }
        : { consumedAt: new Date() },
    });
    if (!changed.count)
      throw new HttpError(
        409,
        "CONSENT_HANDLED",
        "This authorization request has already been handled.",
      );
    const redirect = new URL(request.redirectUri);
    if (request.state) redirect.searchParams.set("state", request.state);
    if (approved) redirect.searchParams.set("code", code);
    else redirect.searchParams.set("error", "access_denied");
    await audit(
      tx,
      actor,
      approved ? "assistant.consent_approved" : "assistant.consent_denied",
      "AssistantAuthorization",
      id,
      null,
      { clientId: request.clientId },
    );
    return { redirectUrl: redirect.toString() };
  });
}
export async function revokeGrant(actor: Principal, id: string) {
  assertCoordinator(actor);
  const changed = await prisma.assistantGrant.updateMany({
    where: { id, userId: actor.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!changed.count)
    throw new HttpError(404, "NOT_FOUND", "Active grant not found.");
  await audit(
    prisma,
    actor,
    "assistant.grant_revoked",
    "AssistantGrant",
    id,
    null,
  );
  return { revoked: true };
}
