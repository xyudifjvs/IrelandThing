import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import { asyncHandler, HttpError } from "@weatherly/platform";

const apiUri = (kind: string) =>
  z
    .string()
    .regex(new RegExp(`^https://api\\.calendly\\.com/${kind}/[A-Za-z0-9-]+$`));
const eventUri = apiUri("scheduled_events");
const inviteeUri = z
  .string()
  .regex(
    /^https:\/\/api\.calendly\.com\/scheduled_events\/[A-Za-z0-9-]+\/invitees\/[A-Za-z0-9-]+$/,
  );
export function schedulingConfig(
  env: Record<string, string | undefined> = process.env,
) {
  let eventUrl: string | null = null;
  try {
    const u = new URL(env.CALENDLY_EVENT_URL || "");
    if (
      u.protocol === "https:" &&
      u.hostname === "calendly.com" &&
      !u.port &&
      !u.username &&
      !u.password &&
      /^\/[^/]+\/[^/]+\/?$/.test(u.pathname) &&
      !u.search &&
      !u.hash
    )
      eventUrl = u.href;
  } catch {
    /* fail closed */
  }
  const configured = !!eventUrl;
  const syncConfigured = !!(
    configured &&
    env.CALENDLY_WEBHOOK_SIGNING_KEY &&
    apiUri("event_types").safeParse(env.CALENDLY_EVENT_TYPE_URI).success
  );
  return { configured, eventUrl, syncConfigured };
}
export function verifyCalendlySignature(
  raw: Buffer,
  header: string | undefined,
  key: string,
  now = Date.now(),
) {
  if (!Buffer.isBuffer(raw) || !header || !key) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const ts = parts.filter(([k]) => k === "t");
  if (ts.length !== 1 || !/^\d+$/.test(ts[0][1] || "")) return false;
  const timestamp = ts[0][1];
  if (
    !Number.isSafeInteger(Number(timestamp)) ||
    Math.abs(now / 1000 - Number(timestamp)) > 180
  )
    return false;
  const expected = createHmac("sha256", key)
    .update(timestamp + ".")
    .update(raw)
    .digest();
  return parts
    .filter(([k]) => k === "v1")
    .some(
      ([, value]) =>
        /^[a-fA-F0-9]{64}$/.test(value || "") &&
        timingSafeEqual(expected, Buffer.from(value, "hex")),
    );
}
const date = z.iso.datetime({ offset: true });
const scheduledEvent = z.object({
  uri: eventUri,
  event_type: apiUri("event_types"),
  start_time: date,
  end_time: date,
});
const webhook = z.object({
  event: z.enum(["invitee.created", "invitee.canceled"]),
  created_at: date,
  payload: z.object({
    uri: inviteeUri,
    event: eventUri,
    name: z.string().max(500),
    email: z.email(),
    timezone: z.string().max(100).nullable().optional(),
    status: z.enum(["active", "canceled"]),
    created_at: date,
    updated_at: date,
    rescheduled: z.boolean().optional(),
    old_invitee: inviteeUri.nullable().optional(),
    new_invitee: inviteeUri.nullable().optional(),
    scheduled_event: scheduledEvent.optional(),
  }),
});
export async function processCalendlyDelivery(
  raw: Buffer,
  header: string | undefined,
) {
  if (!schedulingConfig().syncConfigured)
    throw new HttpError(
      503,
      "SCHEDULING_UNCONFIGURED",
      "Scheduling is not configured.",
    );
  if (
    !verifyCalendlySignature(
      raw,
      header,
      process.env.CALENDLY_WEBHOOK_SIGNING_KEY!,
    )
  )
    throw new HttpError(401, "INVALID_SIGNATURE", "Invalid webhook signature.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_WEBHOOK", "Invalid webhook payload.");
  }
  const data = webhook.parse(parsed);
  const p = data.payload;
  if (!p.uri.startsWith(p.event + "/invitees/"))
    throw new HttpError(400, "INVALID_WEBHOOK", "Invitee event mismatch.");
  let event = p.scheduled_event;
  if (!event) {
    if (!process.env.CALENDLY_API_TOKEN)
      throw new HttpError(
        503,
        "EVENT_LOOKUP_UNCONFIGURED",
        "Event verification is unavailable.",
      );
    // p.event passed an exact api.calendly.com resource allowlist. Never follow redirects.
    const response = await fetch(p.event, {
      headers: { Authorization: `Bearer ${process.env.CALENDLY_API_TOKEN}` },
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
      throw new HttpError(
        503,
        "EVENT_LOOKUP_FAILED",
        "Event verification is unavailable.",
      );
    event = scheduledEvent.parse(
      ((await response.json()) as { resource: unknown }).resource,
    );
  }
  if (
    event.uri !== p.event ||
    event.event_type !== process.env.CALENDLY_EVENT_TYPE_URI
  )
    throw new HttpError(
      403,
      "SCHEDULING_SCOPE_MISMATCH",
      "Webhook is outside the configured event type.",
    );
  if (new Date(event.end_time) <= new Date(event.start_time))
    throw new HttpError(400, "INVALID_WEBHOOK", "Invalid event time range.");
  if ((data.event === "invitee.canceled") !== (p.status === "canceled"))
    throw new HttpError(400, "INVALID_WEBHOOK", "Invalid invitee status.");
  const hash = createHash("sha256").update(raw).digest("hex");
  const status =
    p.status === "canceled"
      ? p.rescheduled
        ? "rescheduled"
        : "canceled"
      : "confirmed";
  const sourceUpdatedAt = new Date(p.updated_at);
  const verifiedEvent = event;
  return prisma.$transaction(async (tx) => {
    // Serialize this adapter across replicas, including first delivery and cross-invitee reschedules.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(872641203)`;
    if (
      await tx.schedulingDelivery.findUnique({ where: { deliveryHash: hash } })
    )
      return { duplicate: true };
    const existing = await tx.schedulingBooking.findUnique({
      where: { inviteeUri: p.uri },
    });
    // A cancellation is terminal for an invitee URI. Reschedules create a different URI.
    const terminal = existing && existing.status !== "confirmed";
    const fresh =
      !existing ||
      sourceUpdatedAt > existing.sourceUpdatedAt ||
      (sourceUpdatedAt.getTime() === existing.sourceUpdatedAt.getTime() &&
        status !== "confirmed");
    let applied = false;
    if (fresh && !(terminal && status === "confirmed")) {
      const values = {
        eventUri: p.event,
        eventTypeUri: verifiedEvent.event_type,
        name: p.name,
        email: p.email,
        timezone: p.timezone ?? null,
        startAt: new Date(verifiedEvent.start_time),
        endAt: new Date(verifiedEvent.end_time),
        status,
        oldInviteeUri: p.old_invitee ?? null,
        newInviteeUri: p.new_invitee ?? null,
        sourceUpdatedAt,
        lastDeliveryHash: hash,
        verifiedAt: new Date(),
        provenance: "calendly_signed_webhook",
      };
      await tx.schedulingBooking.upsert({
        where: { inviteeUri: p.uri },
        create: { inviteeUri: p.uri, ...values },
        update: values,
      });
      applied = true;
    }
    // The replacement's signed reference retires an older booking, even if cancellation arrives late.
    if (status === "confirmed" && p.old_invitee)
      await tx.schedulingBooking.updateMany({
        where: {
          inviteeUri: p.old_invitee,
          eventTypeUri: verifiedEvent.event_type,
          status: "confirmed",
        },
        data: { status: "rescheduled", newInviteeUri: p.uri },
      });
    // If replacement arrived first, do not resurrect the old invitee on its delayed create.
    if (
      status === "confirmed" &&
      (await tx.schedulingBooking.findFirst({
        where: { oldInviteeUri: p.uri, eventTypeUri: verifiedEvent.event_type },
      }))
    )
      await tx.schedulingBooking.updateMany({
        where: { inviteeUri: p.uri, status: "confirmed" },
        data: { status: "rescheduled" },
      });
    await tx.schedulingDelivery.create({
      data: {
        deliveryHash: hash,
        event: data.event,
        inviteeUri: p.uri,
        sourceAt: new Date(data.created_at),
        applied,
        payload: data as unknown as Prisma.InputJsonValue,
      },
    });
    return { duplicate: false, applied };
  });
}
export const calendlyWebhook = asyncHandler(async (req, res) => {
  if (!Buffer.isBuffer(req.body))
    throw new HttpError(400, "RAW_BODY_REQUIRED", "Raw webhook body required.");
  await processCalendlyDelivery(
    req.body,
    req.get("Calendly-Webhook-Signature"),
  );
  res.json({ received: true });
});
