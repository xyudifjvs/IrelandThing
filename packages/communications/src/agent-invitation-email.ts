import { prisma, type Prisma } from "@weatherly/db";
import {
  decryptSecret,
  encryptSecret,
  hashToken,
  HttpError,
} from "@weatherly/platform";
import { z } from "zod";
import { communicationsConfig, type CommunicationsConfig } from "./gateway";
import type { CommunicationsService } from "./service";
import {
  invitationFrom,
  invitationSubject,
  renderAgentInvitation,
} from "./agent-invitation-template";

export const agentInvitationEmailTopic = "agent.invitation.email";
const sendWindowMs = 23 * 60 * 60 * 1000;

function configured(config: CommunicationsConfig) {
  return Boolean(
    config.outboundEnabled &&
    config.resendApiKey &&
    config.systemFrom &&
    !config.systemFrom.toLowerCase().includes("ireland@ireland.com"),
  );
}

function inviteUrl(token: string) {
  if (!process.env.WEB_ORIGIN) return null;
  let url: URL;
  try {
    url = new URL("/invite", process.env.WEB_ORIGIN);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" &&
    !["127.0.0.1", "localhost"].includes(url.hostname)
  )
    return null;
  url.searchParams.set("token", token);
  return url.href;
}

export async function queueAgentInvitation(
  tx: Prisma.TransactionClient,
  invitation: {
    id: string;
    email: string;
    expiresAt: Date;
    acceptanceToken: string;
  },
  config = communicationsConfig(),
) {
  const url = inviteUrl(invitation.acceptanceToken);
  if (
    !configured(config) ||
    !url ||
    invitation.email.toLowerCase() === "ireland@ireland.com"
  )
    return false;
  const idempotencyKey = `system-invitation:${invitation.id}`;
  const encryptedToken = encryptSecret(
    JSON.stringify({ token: invitation.acceptanceToken, url }),
  );
  await tx.outboxJob.upsert({
    where: { idempotencyKey },
    create: {
      topic: agentInvitationEmailTopic,
      idempotencyKey,
      payload: { invitationId: invitation.id, encryptedToken },
    },
    update: {},
  });
  return true;
}

export async function sendQueuedAgentInvitation(
  service: CommunicationsService,
  payload: unknown,
) {
  const input = z
    .object({
      invitationId: z.string().min(1),
      encryptedToken: z.string().optional(),
      redacted: z.boolean().optional(),
    })
    .parse(payload);
  if (input.redacted) return { alreadyHandled: true };
  const invite = await prisma.invitation.findUnique({
    where: { id: input.invitationId },
  });
  const key = `system-invitation:${input.invitationId}`;
  async function redact(data: Prisma.InputJsonObject) {
    await prisma.outboxJob.updateMany({
      where: { topic: agentInvitationEmailTopic, idempotencyKey: key },
      data: {
        payload: { invitationId: input.invitationId, redacted: true, ...data },
      },
    });
  }
  const now = Date.now();
  if (
    !invite ||
    invite.role !== "agent" ||
    invite.email.toLowerCase() === "ireland@ireland.com" ||
    invite.acceptedAt ||
    invite.expiresAt.getTime() <= now ||
    invite.createdAt.getTime() + sendWindowMs <= now
  ) {
    await redact({ expired: true });
    return { expired: true };
  }
  if (!input.encryptedToken || !configured(service.config))
    throw new HttpError(
      503,
      "SYSTEM_EMAIL_NOT_CONFIGURED",
      "System invitation delivery is unavailable.",
    );
  const { token, url } = z
    .object({ token: z.string().min(1), url: z.url() })
    .parse(JSON.parse(decryptSecret(input.encryptedToken)));
  if (hashToken(token) !== invite.tokenHash)
    throw new HttpError(
      409,
      "INVITATION_CHANGED",
      "The invitation no longer matches the queued email.",
    );
  const [settings, roster, account] = await Promise.all([
    prisma.mergeFieldSettings.findUnique({
      where: { ownerId: invite.invitedById },
      select: { signature: true },
    }),
    invite.rosterAgentId
      ? prisma.rosterAgent.findUnique({
          where: { id: invite.rosterAgentId },
          select: { name: true },
        })
      : null,
    prisma.user.findUnique({
      where: { email: invite.email },
      select: { name: true },
    }),
  ]);
  const message = renderAgentInvitation({
    url,
    name: roster?.name || account?.name,
    signature: settings?.signature,
  });
  const response = await service.fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${service.config.resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify({
      from: invitationFrom,
      reply_to: "ireland@weatherlytc.com",
      to: [invite.email],
      subject: invitationSubject,
      ...message,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new HttpError(
      502,
      "SYSTEM_EMAIL_FAILED",
      "System invitation delivery failed.",
    );
  const result = z
    .object({ id: z.string().min(1) })
    .parse(await response.json());
  await redact({ providerMessageId: result.id });
  return { providerMessageId: result.id };
}
