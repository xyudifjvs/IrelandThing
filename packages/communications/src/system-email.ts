import { z } from "zod";
import { prisma } from "@weatherly/db";
import { HttpError, hashToken } from "@weatherly/platform";
import type { CommunicationsService } from "./service";

export async function sendSystemEmail(
  this: CommunicationsService,
  input: {
    to: string;
    subject: string;
    text: string;
    purpose: "password_reset" | "intake_received";
  },
) {
  if (
    !this.config.outboundEnabled ||
    !this.config.resendApiKey ||
    !this.config.systemFrom ||
    this.config.systemFrom.toLowerCase().includes("ireland@ireland.com")
  )
    throw new HttpError(
      503,
      "SYSTEM_EMAIL_NOT_CONFIGURED",
      "System notification email is not configured",
    );
  const data = z
    .object({
      to: z.email(),
      subject: z.string().max(998),
      text: z.string().max(20000),
      purpose: z.enum(["password_reset", "intake_received"]),
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
          expiresAt: new Date(
            Date.now() +
              (data.purpose === "intake_received" ? 24 * 60 : 30) * 60000,
          ).toISOString(),
        },
      },
      update: {},
    })
    .then(() => undefined);
}
