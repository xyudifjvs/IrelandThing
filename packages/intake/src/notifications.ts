import { prisma } from "@weatherly/db";
import { createCommunicationsService } from "@weatherly/communications";
import { z } from "zod";

export async function notifyIntakeReceived(
  payload: unknown,
  service = createCommunicationsService(),
) {
  const { submissionId } = z
    .object({ submissionId: z.string() })
    .parse(payload);
  const submission = await prisma.intakeSubmission.findUniqueOrThrow({
    where: { id: submissionId },
  });
  if (submission.processedAt) return { skipped: "already_processed" };
  if (
    !service.config.outboundEnabled ||
    !service.config.resendApiKey ||
    !service.config.systemFrom
  )
    return { skipped: "email_not_configured" };
  const email =
    process.env.INTAKE_NOTIFICATION_EMAIL || "ireland@weatherlytc.com";
  const owner = await prisma.user.findFirst({
    where: { email, role: "coordinator" },
  });
  if (!owner) return { skipped: "coordinator_not_found" };
  const origin = new URL(process.env.WEB_ORIGIN || "http://127.0.0.1:3000");
  const link = new URL(
    `/workspace/intakes/${encodeURIComponent(submissionId)}`,
    origin,
  ).toString();
  await service.sendSystemEmail({
    to: owner.email,
    subject: "New intake ready for your review",
    text: `A new agent intake is ready. Open it to review the contact information and attached documents, then create the transaction.\n\n${link}`,
    purpose: "intake_received",
  });
  return { queued: true };
}
