import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@weatherly/db";
import { listMatters } from "@weatherly/matters";
import {
  assertCoordinator,
  asyncHandler,
  HttpError,
  principal,
  validDate,
  type Principal,
} from "@weatherly/platform";

import {
  finalizeDigestWindow,
  listDigestIntakes,
  openDigestRequest,
  persistDigestRequest,
  readDigestWindow,
  replayable,
  reserveDigestWindow,
  sealDigestRequest,
} from "./private-reminder/intake-window";

import {
  civilScheduleDate,
  previousScheduledDate,
  reminderScheduleDue,
} from "./private-reminder/schedule";
import {
  collectReminderDates,
  sourcesStillCurrent,
} from "./private-reminder/deadline-collection";
import { renderDigest } from "./private-reminder/content";
import { intakeDatabaseClock } from "../../intake/src/receipt-clock";
export {
  reminderLocalClock,
  reminderScheduleDue,
} from "./private-reminder/schedule";
export type {
  ReminderSource,
  ReminderItem,
} from "./private-reminder/deadline-collection";

const timeZone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Use an IANA timezone");
const previewInput = z
  .object({ timeZone, leadDays: z.number().int().min(0).max(365) })
  .strict();
const settingsInput = previewInput
  .extend({
    recipientUserId: z.string().trim().min(1).max(200),
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  })
  .strict();
export const approvedReminderSchedule = {
  timeZone: "America/New_York",
  localTime: "08:00",
  weekdays: [1, 2, 3, 4, 5],
  leadDays: 7,
} as const;
const approvedReminderEmail = "ireland@weatherlytc.com";
type Environment = Record<string, string | undefined>;
const digestPayload = z
  .object({
    recipientUserId: z.string().min(1).max(200),
    dateKey: z.string().refine(validDate),
    settingsFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const dispatchSchema = z
  .object({
    attemptAt: z.iso.datetime(),
    request: z.string().min(1),
  })
  .strict();
const preparingPayload = digestPayload.extend({ dispatch: dispatchSchema });
const finishedPayload = digestPayload
  .extend({
    redacted: z.literal(true),
    providerMessageId: z.string().min(1).max(200).optional(),
    skipped: z
      .string()
      .regex(/^[A-Z_]{1,80}$/)
      .optional(),
  })
  .strict();
type Payload = z.infer<typeof digestPayload>;

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function configuredSettings(env: Environment) {
  const weekdays = (
    env.REMINDER_WEEKDAYS ?? approvedReminderSchedule.weekdays.join(",")
  )
    .split(",")
    .map((day) => (/^\s*[0-6]\s*$/.test(day) ? Number(day) : NaN));
  const lead =
    env.REMINDER_LEAD_DAYS ?? String(approvedReminderSchedule.leadDays);
  return settingsInput.safeParse({
    recipientUserId: env.REMINDER_RECIPIENT_USER_ID,
    timeZone: env.REMINDER_TIMEZONE ?? approvedReminderSchedule.timeZone,
    localTime: env.REMINDER_LOCAL_TIME ?? approvedReminderSchedule.localTime,
    weekdays: weekdays ? [...new Set(weekdays)] : undefined,
    leadDays: lead && /^\d+$/.test(lead) ? Number(lead) : undefined,
  });
}
function systemSender(value: string | undefined) {
  if (!value || /[\r\n]/.test(value)) return null;
  const address = value.match(/^[^<>]*<([^<>]+)>$/)?.[1] || value;
  if (
    !z.email().safeParse(address).success ||
    address.toLowerCase() === "ireland@ireland.com"
  )
    return null;
  return value;
}
async function recipient(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      emailVerified: true,
    },
  });
  if (
    !user ||
    user.role !== "coordinator" ||
    !user.emailVerified ||
    !z.email().safeParse(user.email).success ||
    user.email.toLowerCase() === "ireland@ireland.com"
  )
    return null;
  const access = await prisma.auditEvent.findFirst({
    where: {
      entityType: "User",
      entityId: user.id,
      action: { in: ["identity.access_revoked", "identity.access_restored"] },
    },
    orderBy: { createdAt: "desc" },
    select: { action: true },
  });
  return access?.action === "identity.access_revoked" ? null : user;
}
function asActor(
  user: NonNullable<Awaited<ReturnType<typeof recipient>>>,
): Principal {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: "coordinator",
    sessionId: "private-reminder-worker",
  };
}
type Dependencies = {
  env?: () => Environment;
  now?: () => Date;
  fetch?: typeof fetch;
  listMatters?: typeof listMatters;
  /** Synthetic tests only; production binds Ireland's approved mailbox. */
  approvedRecipientEmail?: string;
};

export function createPrivateReminderService(dependencies: Dependencies = {}) {
  const env = dependencies.env || (() => process.env);
  const now = dependencies.now || (() => new Date());
  // Production cutoff and receipt timestamps come from the same database clock.
  const scheduleClock = async () =>
    dependencies.now ? now() : intakeDatabaseClock(prisma);
  const send = dependencies.fetch || fetch;
  const readMatters = dependencies.listMatters || listMatters;
  const approvedEmail =
    dependencies.approvedRecipientEmail || approvedReminderEmail;
  async function readiness() {
    const current = env();
    if (current.PRIVATE_REMINDERS_ENABLED !== "true")
      return {
        ready: false as const,
        enabled: false,
        reason:
          "Private reminders are disabled; no reminder emails are delivering.",
      };
    const settings = configuredSettings(current);
    if (!settings.success)
      return {
        ready: false as const,
        enabled: true,
        reason:
          "Designate Ireland's recipient account and validate the approved reminder schedule; no reminder emails are delivering.",
      };
    if (
      current.OUTBOUND_EMAIL_ENABLED !== "true" ||
      !current.RESEND_API_KEY?.trim() ||
      !systemSender(current.SYSTEM_EMAIL_FROM)
    )
      return {
        ready: false as const,
        enabled: true,
        reason:
          "Outbound email and the existing system-mail sender must be configured; no reminder emails are delivering.",
      };
    const user = await recipient(settings.data.recipientUserId);
    if (!user || user.email.toLowerCase() !== approvedEmail.toLowerCase())
      return {
        ready: false as const,
        enabled: true,
        reason:
          "The designated reminder recipient must be Ireland's approved, verified coordinator account with active access; no reminder emails are delivering.",
      };
    const fingerprint = hash(
      JSON.stringify({
        ...settings.data,
        weekdays: [...settings.data.weekdays].sort(),
        email: user.email.toLowerCase(),
        from: current.SYSTEM_EMAIL_FROM,
        transportKeyHash: hash(current.RESEND_API_KEY!),
      }),
    );
    return {
      ready: true as const,
      enabled: true,
      settings: settings.data,
      user,
      fingerprint,
      from: current.SYSTEM_EMAIL_FROM!,
      apiKey: current.RESEND_API_KEY!,
    };
  }
  function collect(actor: Principal, input: unknown, at = now()) {
    return collectReminderDates(
      actor,
      previewInput.parse(input),
      at,
      readMatters,
    );
  }
  async function preview(actor: Principal, input: unknown, at = now()) {
    return (await collect(actor, input, at)).digest;
  }
  async function status(actor: Principal) {
    assertCoordinator(actor);
    const ready = await readiness();
    const configured = configuredSettings({
      ...env(),
      REMINDER_RECIPIENT_USER_ID:
        env().REMINDER_RECIPIENT_USER_ID || "not-yet-designated",
    });
    const last = await prisma.outboxJob.findFirst({
      where: { topic: "reminder.digest" },
      orderBy: { createdAt: "desc" },
      select: { state: true, error: true, updatedAt: true },
    });
    const failed = ready.ready && last?.state === "failed";
    return {
      enabled: ready.enabled,
      ready: ready.ready,
      status: ready.ready
        ? failed
          ? "failed"
          : "scheduled"
        : ready.enabled
          ? "not_configured"
          : "disabled",
      deliveryStatus:
        ready.ready && !failed ? "scheduled_not_verified" : "not_delivering",
      reason: ready.ready
        ? failed
          ? "The latest private reminder job failed. Delivery is not confirmed; review the job status before relying on reminders."
          : "Private reminders are scheduled only for the designated coordinator. Provider acceptance is not proof of delivery."
        : ready.reason,
      schedule: configured.success
        ? {
            timeZone: configured.data.timeZone,
            localTime: configured.data.localTime,
            weekdays: configured.data.weekdays,
            leadDays: configured.data.leadDays,
          }
        : null,
      approvedRecipientEmail: approvedEmail,
      recipient: ready.ready
        ? { id: ready.user.id, name: ready.user.name, email: ready.user.email }
        : null,
      lastRun: last
        ? {
            ...last,
            error:
              last.error && /^[A-Z_]{1,80}$/.test(last.error)
                ? last.error
                : null,
          }
        : null,
    };
  }
  const jobKey = (input: Pick<Payload, "recipientUserId" | "dateKey">) =>
    `private-reminder:${input.recipientUserId}:${input.dateKey}`;
  async function enqueueScheduled(at?: Date) {
    const ready = await readiness();
    if (!ready.ready) return { enqueued: false, reason: "NOT_DELIVERING" };
    const clock = reminderScheduleDue(
      ready.settings,
      at ?? (await scheduleClock()),
    );
    if (!clock.due) return { enqueued: false, reason: "NOT_DUE" };
    const payload: Payload = {
      recipientUserId: ready.user.id,
      dateKey: clock.dateKey,
      settingsFingerprint: ready.fingerprint,
    };
    const reason = await reserveDigestWindow(
      payload,
      jobKey(payload),
      previousScheduledDate(clock.dateKey, ready.settings),
      civilScheduleDate(clock.dateKey, ready.settings),
    );
    return reason
      ? { enqueued: false, reason }
      : { enqueued: true, dateKey: clock.dateKey };
  }
  async function handleDigest(payload: unknown) {
    const finished = finishedPayload.safeParse(payload);
    if (finished.success) return { redacted: true };
    const original = digestPayload.safeParse(payload);
    const { dispatch: _incomingDispatch, ...input } = original.success
      ? { ...original.data, dispatch: undefined }
      : preparingPayload.parse(payload);
    const key = jobKey(input);
    const stored = await prisma.outboxJob.findUnique({
      where: { idempotencyKey: key },
      select: { topic: true, state: true, payload: true },
    });
    if (!stored || stored.topic !== "reminder.digest")
      throw new HttpError(
        404,
        "REMINDER_JOB_NOT_FOUND",
        "This private reminder job is not queued.",
      );
    if (
      finishedPayload.safeParse(stored.payload).success ||
      stored.state === "complete"
    )
      return { redacted: true };
    const preparedPayload = preparingPayload.safeParse(stored.payload);
    const queued = preparedPayload.success
      ? preparedPayload.data
      : digestPayload.parse(stored.payload);
    if (queued.settingsFingerprint !== input.settingsFingerprint)
      throw new HttpError(
        409,
        "REMINDER_JOB_MISMATCH",
        "This private reminder job changed.",
      );
    const window = await readDigestWindow(input.recipientUserId, key);
    const dispatch = preparedPayload.success
      ? preparedPayload.data.dispatch
      : null;
    const redact = async (
      result: { skipped?: string; providerMessageId?: string },
      advance = false,
    ) => {
      await finalizeDigestWindow(
        input.recipientUserId,
        key,
        { ...input, redacted: true, ...result },
        advance,
      );
      return result;
    };
    if (window === false) return redact({ skipped: "STALE_SCHEDULE" });
    if (dispatch && !replayable(dispatch.attemptAt, now()))
      throw new HttpError(
        409,
        "REMINDER_DELIVERY_UNCONFIRMED",
        "Review the previous digest delivery before resuming the intake window.",
      );
    const eligible = async () => {
      const current = await readiness();
      if (!current.ready) return { skipped: "NOT_DELIVERING" } as const;
      if (
        input.recipientUserId !== current.user.id ||
        input.settingsFingerprint !== current.fingerprint
      )
        return { skipped: "SETTINGS_CHANGED" } as const;
      const at = await scheduleClock();
      const clock = reminderScheduleDue(current.settings, at);
      if (!dispatch && (!clock.due || clock.dateKey !== input.dateKey))
        return { skipped: "STALE_SCHEDULE" } as const;
      return { current, at } as const;
    };
    let check = await eligible();
    if ("skipped" in check) {
      if (dispatch)
        throw new HttpError(
          409,
          "REMINDER_DELIVERY_UNCONFIRMED",
          "Digest delivery settings changed after dispatch.",
        );
      return redact({ skipped: check.skipped });
    }
    let request: string;
    if (dispatch) {
      request = openDigestRequest(dispatch.request, check.current.apiKey, key);
    } else {
      const collectCurrent = () =>
        collect(
          asActor(check.current!.user),
          {
            timeZone: check.current!.settings.timeZone,
            leadDays: check.current!.settings.leadDays,
          },
          check.at,
        );
      let prepared = await collectCurrent();
      const intakes = window ? await listDigestIntakes(window) : [];
      for (let attempt = 0; ; attempt++) {
        check = await eligible();
        if ("skipped" in check) return redact({ skipped: check.skipped });
        if (await sourcesStillCurrent(prepared.revisions)) break;
        if (attempt >= 3)
          throw new HttpError(
            503,
            "REMINDER_SOURCES_CHANGED",
            "Transactions changed during digest preparation; the complete digest will retry.",
          );
        prepared = await collectCurrent();
      }
      const digest = prepared.digest;
      check = await eligible();
      if ("skipped" in check) return redact({ skipped: check.skipped });
      if (!digest.items.length && !intakes.length)
        return redact({ skipped: "NO_DUE_ITEMS" }, true);
      const text = renderDigest(digest, intakes);
      if (text.length > 200000)
        throw new HttpError(
          413,
          "REMINDER_DIGEST_TOO_LARGE",
          "The private digest exceeds the safe email size; review the complete preview instead.",
        );
      const current = check.current;
      request = JSON.stringify({
        from: current.from,
        to: [current.user.email],
        subject: `Weatherly private reminders · ${digest.dateKey}`,
        text,
      });
      const encrypted = {
        attemptAt: now().toISOString(),
        request: sealDigestRequest(request, current.apiKey, key),
      };
      const persisted = await persistDigestRequest(
        input.recipientUserId,
        key,
        stored.payload,
        {
          ...input,
          dispatch: encrypted,
        },
      );
      if (!persisted)
        throw new HttpError(
          409,
          "REMINDER_JOB_MISMATCH",
          "This private reminder job changed.",
        );
    }
    const current = check.current;
    const response = await send("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${current.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `weatherly-private-reminder-${hash(jobKey(input))}`,
      },
      body: request,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      if (
        response.status < 500 &&
        response.status !== 409 &&
        response.status !== 429
      )
        await redact({ skipped: "PROVIDER_REJECTED" });
      throw new HttpError(
        response.status >= 500 || [409, 429].includes(response.status)
          ? 502
          : 422,
        "REMINDER_PROVIDER_FAILED",
        "Private reminder provider acceptance failed; no delivery is asserted.",
      );
    }
    const result = z
      .object({ id: z.string().min(1).max(200) })
      .parse(await response.json());
    await redact({ providerMessageId: result.id }, true);
    return { providerAccepted: true };
  }
  return { status, preview, enqueueScheduled, handleDigest };
}

export function createPrivateReminderRouter(
  service = createPrivateReminderService(),
) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  router.get(
    "/status",
    asyncHandler(async (req, res) =>
      res.json(await service.status(principal(req))),
    ),
  );
  router.post(
    "/preview",
    asyncHandler(async (req, res) =>
      res.json(await service.preview(principal(req), req.body)),
    ),
  );
  return router;
}
