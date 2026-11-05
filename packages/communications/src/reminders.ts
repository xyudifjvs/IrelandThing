import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import { listMatters } from "@weatherly/matters";
import {
  assertCoordinator,
  asyncHandler,
  HttpError,
  principal,
  validDate,
  type Principal,
} from "@weatherly/platform";

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
type Settings = z.infer<typeof settingsInput>;
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
const terminalTasks = new Set(["completed", "signed", "not_applicable"]);
const inactiveMatters = new Set([
  "pending_review",
  "closed",
  "terminated",
  "archived",
]);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const clean = (value: string, length: number) =>
  value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, length);

/** Local civil dates, independent of the host timezone and DST offset. */
export function reminderLocalClock(at: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const field = (name: string) =>
    parts.find((part) => part.type === name)!.value;
  const dateKey = `${field("year")}-${field("month")}-${field("day")}`;
  return {
    dateKey,
    minute: Number(field("hour")) * 60 + Number(field("minute")),
    weekday: new Date(`${dateKey}T12:00:00Z`).getUTCDay(),
  };
}
export function reminderScheduleDue(
  settings: Pick<Settings, "timeZone" | "localTime" | "weekdays">,
  at: Date,
) {
  const clock = reminderLocalClock(at, settings.timeZone);
  const [hour, minute] = settings.localTime.split(":").map(Number);
  return {
    ...clock,
    due:
      settings.weekdays.includes(clock.weekday) &&
      clock.minute >= hour * 60 + minute,
  };
}
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
export type ReminderSource = {
  kind: "task" | "deadline";
  id: string;
  matterId: string;
  date: string;
};
export type ReminderItem = {
  matterId: string;
  propertyAddress: string;
  label: string;
  date: string;
  bucket: "overdue" | "upcoming";
  sourceRefs: ReminderSource[];
};
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
  async function collect(actor: Principal, input: unknown, at = now()) {
    assertCoordinator(actor);
    const settings = previewInput.parse(input);
    const { dateKey } = reminderLocalClock(at, settings.timeZone);
    const end = new Date(`${dateKey}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + settings.leadDays);
    const endKey = end.toISOString().slice(0, 10);
    const items: ReminderItem[] = [];
    const seenMatters = new Set<string>();
    const revisions = new Map<string, number>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let mattersScanned = 0;
    let cursorRestarts = 0;
    while (true) {
      let page: Awaited<ReturnType<typeof listMatters>>;
      try {
        page = await readMatters(actor, {
          limit: 200,
          order: "id",
          ...(cursor ? { cursor } : {}),
        });
      } catch (error) {
        if (
          cursor &&
          error instanceof HttpError &&
          error.code === "MATTER_NOT_FOUND"
        ) {
          if (++cursorRestarts > 3)
            throw new HttpError(
              503,
              "REMINDER_PAGINATION_CHANGED",
              "Transaction records changed while preparing reminders; retry the complete preview.",
            );
          // Deletion of a cursor must not omit the rest of the portfolio or
          // permanently fail a digest. Restart the full scan, never truncate it.
          cursor = undefined;
          items.length = 0;
          mattersScanned = 0;
          seenMatters.clear();
          revisions.clear();
          seenCursors.clear();
          continue;
        }
        throw error;
      }
      for (const matter of page) {
        if (seenMatters.has(matter.id)) continue;
        seenMatters.add(matter.id);
        revisions.set(matter.id, matter.revision);
        mattersScanned++;
        if (inactiveMatters.has(matter.stage)) continue;
        const details = record(record(matter).details);
        if (
          record(details.fileReview).status === "pending" ||
          (Array.isArray(details.sourceConflicts) &&
            details.sourceConflicts.length)
        )
          continue;
        const groups = new Map<string, ReminderItem>();
        const tasks = matter.tasks;
        const keyFor = (row: unknown) => {
          const key = record(record(row).details).workflowKey;
          return typeof key === "string" && key ? key : null;
        };
        const eligibleDate = (date: string | null) =>
          Boolean(date && validDate(date) && date <= endKey);
        const add = (
          kind: "task" | "deadline",
          id: string,
          label: string,
          date: string,
          key: string | null,
        ) => {
          const group = key ? `workflow:${key}` : `${kind}:${id}`;
          const source: ReminderSource = {
            kind,
            id,
            matterId: matter.id,
            date,
          };
          const previous = groups.get(group);
          if (previous) {
            previous.sourceRefs.push(source);
            return;
          }
          groups.set(group, {
            matterId: matter.id,
            propertyAddress: clean(matter.propertyAddress, 300),
            label: clean(label, 200),
            date,
            bucket: date < dateKey ? "overdue" : "upcoming",
            sourceRefs: [source],
          });
        };
        for (const deadline of matter.deadlines) {
          if (deadline.status !== "confirmed" || !eligibleDate(deadline.date))
            continue;
          const key = keyFor(deadline);
          const matches = key
            ? tasks.filter((task) => keyFor(task) === key)
            : [];
          if (
            matches.length &&
            matches.every((task) => terminalTasks.has(task.status))
          )
            continue;
          add("deadline", deadline.id, deadline.label, deadline.date!, key);
        }
        for (const task of tasks) {
          if (
            terminalTasks.has(task.status) ||
            task.status === "proposed" ||
            !eligibleDate(task.dueDate)
          )
            continue;
          add("task", task.id, task.title, task.dueDate!, keyFor(task));
        }
        items.push(...groups.values());
      }
      if (page.length < 200) break;
      cursor = page.at(-1)!.id;
      if (seenCursors.has(cursor))
        throw new HttpError(
          503,
          "REMINDER_PAGINATION_CHANGED",
          "Transaction ordering changed while preparing reminders; preview again.",
        );
      seenCursors.add(cursor);
    }
    items.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.propertyAddress.localeCompare(b.propertyAddress) ||
        a.label.localeCompare(b.label),
    );
    return {
      revisions,
      digest: {
        generatedAt: at.toISOString(),
        dateKey,
        ...settings,
        items,
        counts: {
          mattersScanned,
          overdue: items.filter((item) => item.bucket === "overdue").length,
          upcoming: items.filter((item) => item.bucket === "upcoming").length,
        },
      },
    };
  }
  async function preview(actor: Principal, input: unknown, at = now()) {
    return (await collect(actor, input, at)).digest;
  }
  async function sourcesStillCurrent(revisions: Map<string, number>) {
    // Canonical task/date edits increment the matter revision. Validate every
    // scanned record, including previously empty/pending files, before dispatch.
    if ((await prisma.matter.count()) !== revisions.size) return false;
    const ids = [...revisions.keys()];
    for (let index = 0; index < ids.length; index += 200) {
      const rows = await prisma.matter.findMany({
        where: { id: { in: ids.slice(index, index + 200) } },
        select: { id: true, revision: true },
      });
      if (
        rows.length !== Math.min(200, ids.length - index) ||
        rows.some((row) => revisions.get(row.id) !== row.revision)
      )
        return false;
    }
    return true;
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
  async function enqueueScheduled(at = now()) {
    const ready = await readiness();
    if (!ready.ready) return { enqueued: false, reason: "NOT_DELIVERING" };
    const clock = reminderScheduleDue(ready.settings, at);
    if (!clock.due) return { enqueued: false, reason: "NOT_DUE" };
    const payload: Payload = {
      recipientUserId: ready.user.id,
      dateKey: clock.dateKey,
      settingsFingerprint: ready.fingerprint,
    };
    try {
      await prisma.outboxJob.create({
        data: {
          topic: "reminder.digest",
          idempotencyKey: jobKey(payload),
          payload,
        },
      });
      return { enqueued: true, dateKey: clock.dateKey };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return { enqueued: false, reason: "ALREADY_SCHEDULED" };
      throw error;
    }
  }
  async function handleDigest(payload: unknown) {
    const finished = finishedPayload.safeParse(payload);
    if (finished.success) return { redacted: true };
    const input = digestPayload.parse(payload);
    const stored = await prisma.outboxJob.findUnique({
      where: { idempotencyKey: jobKey(input) },
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
    if (
      JSON.stringify(stored.payload) !== JSON.stringify(input) &&
      !digestPayload.safeParse(stored.payload).success
    )
      throw new HttpError(
        409,
        "REMINDER_JOB_MISMATCH",
        "This private reminder job changed.",
      );
    const queued = digestPayload.parse(stored.payload);
    if (queued.settingsFingerprint !== input.settingsFingerprint)
      throw new HttpError(
        409,
        "REMINDER_JOB_MISMATCH",
        "This private reminder job changed.",
      );
    const redact = async (result: {
      skipped?: string;
      providerMessageId?: string;
    }) => {
      await prisma.outboxJob.updateMany({
        where: { topic: "reminder.digest", idempotencyKey: jobKey(input) },
        data: { payload: { ...input, redacted: true, ...result } },
      });
      return result;
    };
    const eligible = async () => {
      const current = await readiness();
      if (!current.ready) return { skipped: "NOT_DELIVERING" } as const;
      if (
        input.recipientUserId !== current.user.id ||
        input.settingsFingerprint !== current.fingerprint
      )
        return { skipped: "SETTINGS_CHANGED" } as const;
      const clock = reminderScheduleDue(current.settings, now());
      if (!clock.due || clock.dateKey !== input.dateKey)
        return { skipped: "STALE_SCHEDULE" } as const;
      return { current } as const;
    };
    let check = await eligible();
    if ("skipped" in check) return redact({ skipped: check.skipped });
    let prepared = await collect(asActor(check.current.user), {
      timeZone: check.current.settings.timeZone,
      leadDays: check.current.settings.leadDays,
    });
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
      prepared = await collect(asActor(check.current.user), {
        timeZone: check.current.settings.timeZone,
        leadDays: check.current.settings.leadDays,
      });
    }
    const digest = prepared.digest;
    // Recheck the exact transport, recipient and local date after source validation.
    check = await eligible();
    if ("skipped" in check) return redact({ skipped: check.skipped });
    const current = check.current;
    if (!digest.items.length) return redact({ skipped: "NO_DUE_ITEMS" });
    const text = [
      `Weatherly private reminders — ${digest.dateKey}`,
      `Only for your coordinator account. Dates use ${digest.timeZone}.`,
      `Overdue: ${digest.counts.overdue}. Upcoming through ${digest.leadDays} calendar days: ${digest.counts.upcoming}.`,
      "",
      ...digest.items.map(
        (item) =>
          `${item.bucket === "overdue" ? "OVERDUE" : "UPCOMING"} ${item.date} — ${item.propertyAddress || `Transaction ${item.matterId}`} — ${item.label}\nSources: ${item.sourceRefs.map((source) => `${source.kind}:${source.id}`).join(", ")}`,
      ),
      "",
      "Review the current transaction record before acting. No agent or client received this digest.",
    ].join("\n");
    if (text.length > 200000)
      throw new HttpError(
        413,
        "REMINDER_DIGEST_TOO_LARGE",
        "The private digest exceeds the safe email size; review the complete preview instead.",
      );
    const response = await send("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${current.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `weatherly-private-reminder-${hash(jobKey(input))}`,
      },
      body: JSON.stringify({
        from: current.from,
        to: [current.user.email],
        subject: `Weatherly private reminders · ${digest.dateKey}`,
        text,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new HttpError(
        response.status >= 500 || response.status === 429 ? 502 : 422,
        "REMINDER_PROVIDER_FAILED",
        "Private reminder provider acceptance failed; no delivery is asserted.",
      );
    const result = z
      .object({ id: z.string().min(1).max(200) })
      .parse(await response.json());
    await redact({ providerMessageId: result.id });
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
