import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@weatherly/db";
import { listMatters, updateTask } from "@weatherly/matters";
import { HttpError, type Principal } from "@weatherly/platform";
import {
  createPrivateReminderService,
  reminderLocalClock,
  reminderScheduleDue,
} from "../src/reminders";

const run = randomUUID();
const ownerId = `reminder-owner-${run}`;
const approvedEmail = `reminder-${run}@example.org`;
const actor: Principal = {
  id: ownerId,
  name: "Synthetic Ireland",
  email: approvedEmail,
  role: "coordinator",
  sessionId: run,
};
const matters: string[] = [];
const recordIds: string[] = [];
const defaultEnv = () =>
  ({
    PRIVATE_REMINDERS_ENABLED: "true",
    OUTBOUND_EMAIL_ENABLED: "true",
    REMINDER_RECIPIENT_USER_ID: ownerId,
    RESEND_API_KEY: "re_synthetic_never_external",
    SYSTEM_EMAIL_FROM: "Weatherly <system@example.org>",
  }) as Record<string, string | undefined>;
function fixture(
  options: {
    fetch?: typeof fetch;
    listMatters?: typeof listMatters;
    date?: string;
  } = {},
) {
  let environment = defaultEnv();
  let clock = new Date(options.date || "2026-11-05T13:00:00Z");
  const send = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ id: "synthetic-provider-accepted" }), {
        status: 200,
      }),
  );
  const service = createPrivateReminderService({
    env: () => environment,
    now: () => clock,
    fetch: options.fetch || send,
    approvedRecipientEmail: approvedEmail,
    ...(options.listMatters ? { listMatters: options.listMatters } : {}),
  });
  return {
    service,
    send,
    env: () => environment,
    configure: (patch: Record<string, string | undefined>) => {
      environment = { ...environment, ...patch };
    },
    setClock: (date: string) => {
      clock = new Date(date);
    },
  };
}
async function queued() {
  return prisma.outboxJob.findFirstOrThrow({
    where: {
      topic: "reminder.digest",
      idempotencyKey: { startsWith: `private-reminder:${ownerId}:` },
    },
    orderBy: { createdAt: "desc" },
  });
}
async function dueMatter(extra: Record<string, unknown> = {}) {
  const matter = await prisma.matter.create({
    data: {
      title: "SECRET_CLIENT_NAMES_DO_NOT_EMAIL",
      propertyAddress: `42 Synthetic Reminder Way ${run}`,
      side: "buyer",
      packageCode: "essentials",
      stage: "under_contract",
      details: {
        clientEmail: "SECRET_CLIENT_EMAIL",
        documentText: "SECRET_PRIVATE_DOCUMENT",
      },
      deadlines: {
        create: [
          {
            label: "Synthetic deadline",
            date: "2026-11-06",
            status: "confirmed",
          },
        ],
      },
      ...extra,
    },
  });
  matters.push(matter.id);
  return matter;
}
beforeAll(async () => {
  await prisma.user.create({
    data: {
      id: ownerId,
      name: actor.name,
      email: approvedEmail,
      role: "coordinator",
      emailVerified: true,
    },
  });
});
afterEach(async () => {
  await prisma.outboxJob.deleteMany({
    where: {
      topic: "reminder.digest",
      idempotencyKey: { startsWith: `private-reminder:${ownerId}:` },
    },
  });
  await prisma.auditEvent.deleteMany({ where: { entityId: ownerId } });
  await prisma.user.update({
    where: { id: ownerId },
    data: { role: "coordinator", emailVerified: true, email: approvedEmail },
  });
});
afterAll(async () => {
  await prisma.matter.deleteMany({ where: { id: { in: matters } } });
  await prisma.user.delete({ where: { id: ownerId } });
  await prisma.$disconnect();
});

describe("private Ireland-only reminder digests", () => {
  it("reports the latest failed job without claiming delivery and gives disabled gates precedence", async () => {
    const f = fixture();
    await f.service.enqueueScheduled();
    await prisma.outboxJob.update({
      where: { id: (await queued()).id },
      data: { state: "failed", error: "REMINDER_PROVIDER_FAILED" },
    });
    expect(await f.service.status(actor)).toMatchObject({
      ready: true,
      status: "failed",
      deliveryStatus: "not_delivering",
      lastRun: { state: "failed", error: "REMINDER_PROVIDER_FAILED" },
    });
    f.configure({ PRIVATE_REMINDERS_ENABLED: "false" });
    expect(await f.service.status(actor)).toMatchObject({
      ready: false,
      status: "disabled",
      deliveryStatus: "not_delivering",
      lastRun: { state: "failed" },
    });
    expect(f.send).not.toHaveBeenCalled();
  });

  it("keeps the approved weekday 8am New York schedule disabled without complete delivery gates", async () => {
    const f = fixture();
    f.configure({
      PRIVATE_REMINDERS_ENABLED: undefined,
      REMINDER_RECIPIENT_USER_ID: undefined,
    });
    const disabled = await f.service.status(actor);
    expect(disabled).toMatchObject({
      ready: false,
      status: "disabled",
      deliveryStatus: "not_delivering",
      schedule: {
        timeZone: "America/New_York",
        localTime: "08:00",
        weekdays: [1, 2, 3, 4, 5],
        leadDays: 7,
      },
    });
    expect(await f.service.enqueueScheduled()).toMatchObject({
      enqueued: false,
    });
    for (const patch of [
      { REMINDER_RECIPIENT_USER_ID: undefined },
      { OUTBOUND_EMAIL_ENABLED: "false" },
      { RESEND_API_KEY: "" },
      { SYSTEM_EMAIL_FROM: "bad\nheader@example.org" },
      { REMINDER_TIMEZONE: "Invalid/Nowhere" },
      { REMINDER_LOCAL_TIME: "25:01" },
      { REMINDER_WEEKDAYS: "" },
      { REMINDER_LEAD_DAYS: "-1" },
    ]) {
      const current = fixture();
      current.configure(patch);
      expect(await current.service.enqueueScheduled()).toMatchObject({
        enqueued: false,
      });
    }
    expect(
      await prisma.outboxJob.count({
        where: {
          topic: "reminder.digest",
          idempotencyKey: { startsWith: `private-reminder:${ownerId}:` },
        },
      }),
    ).toBe(0);
    expect(f.send).not.toHaveBeenCalled();
  });

  it("handles DST gaps/repeated hours and enqueues once per local date after the chosen time", async () => {
    const sunday = {
      timeZone: "America/New_York",
      localTime: "02:30",
      weekdays: [0],
    };
    expect(
      reminderScheduleDue(sunday, new Date("2026-03-08T06:59:00Z")).due,
    ).toBe(false);
    expect(
      reminderScheduleDue(sunday, new Date("2026-03-08T07:00:00Z")).due,
    ).toBe(true);
    expect(
      reminderLocalClock(new Date("2026-07-08T12:00:00Z"), "America/New_York")
        .minute,
    ).toBe(480);
    expect(
      reminderLocalClock(new Date("2026-12-08T13:00:00Z"), "America/New_York")
        .minute,
    ).toBe(480);
    const f = fixture({ date: "2026-11-01T05:30:00Z" });
    f.configure({ REMINDER_WEEKDAYS: "0", REMINDER_LOCAL_TIME: "01:30" });
    const results = await Promise.all([
      f.service.enqueueScheduled(),
      f.service.enqueueScheduled(),
    ]);
    expect(results.filter((result) => result.enqueued)).toHaveLength(1);
    f.setClock("2026-11-01T06:30:00Z");
    expect(await f.service.enqueueScheduled()).toMatchObject({
      enqueued: false,
      reason: "ALREADY_SCHEDULED",
    });
    expect(await queued()).toMatchObject({
      payload: { dateKey: "2026-11-01" },
    });
    const before = fixture({ date: "2026-11-06T12:59:00Z" });
    expect(await before.service.enqueueScheduled()).toMatchObject({
      reason: "NOT_DUE",
    });
    before.setClock("2026-11-07T14:00:00Z");
    expect(await before.service.enqueueScheduled()).toMatchObject({
      reason: "NOT_DUE",
    });
  });

  it("previews all pages, uses only approved dates, deduplicates workflow records and omits completed/inactive milestones", async () => {
    const ids = Array.from(
      { length: 205 },
      (_, i) => `reminder-page-${run}-${i}`,
    );
    await prisma.matter.createMany({
      data: ids.map((id) => ({
        id,
        title: "SECRET_CLIENT_NAMES_DO_NOT_EMAIL",
        propertyAddress: `Synthetic paginated address ${id}`,
        side: "buyer",
        packageCode: "essentials",
      })),
    });
    matters.push(...ids);
    await prisma.deadline.createMany({
      data: ids.map((matterId) => ({
        matterId,
        label: "Paginated approved deadline",
        date: "2026-11-06",
        status: "confirmed",
      })),
    });
    const special = await dueMatter({
      details: {
        workflow: {
          definition: {
            steps: [
              {
                key: "active",
                title: "Active deadline",
                kind: "checklist",
                visibility: "agent",
                rule: {
                  anchor: "Effective date",
                  offsetDays: 0,
                  businessDays: false,
                  skipDates: [],
                },
              },
              {
                key: "finished",
                title: "Finished milestone",
                kind: "checklist",
                visibility: "agent",
              },
              {
                key: "proposal",
                title: "Unapproved rule",
                kind: "checklist",
                visibility: "agent",
                rule: {
                  anchor: "Effective date",
                  offsetDays: 1,
                  businessDays: false,
                  skipDates: [],
                },
              },
            ],
          },
        },
      },
      deadlines: {
        create: [
          {
            label: "Active <b>deadline</b>\n",
            date: "2026-11-06",
            status: "confirmed",
            details: { workflowKey: "active" },
          },
          {
            label: "Finished milestone",
            date: "2026-11-04",
            status: "confirmed",
            details: { workflowKey: "finished" },
          },
          {
            label: "SECRET_PROPOSED",
            date: "2026-11-04",
            status: "proposed",
            details: { workflowKey: "proposal" },
          },
          {
            label: "Out of approved lead window",
            date: "2026-11-13",
            status: "confirmed",
          },
        ],
      },
      tasks: {
        create: [
          {
            title: "Same active record",
            dueDate: "2026-11-06",
            details: {
              workflowKey: "active",
              privateNote: "SECRET_PRIVATE_NOTE",
            },
          },
          {
            title: "Finished milestone",
            dueDate: "2026-11-04",
            status: "completed",
            details: { workflowKey: "finished" },
          },
          {
            title: "SECRET_PROPOSED_TASK",
            dueDate: "2026-11-04",
            details: { workflowKey: "proposal" },
          },
          { title: "Overdue manual call", dueDate: "2026-11-04" },
          { title: "SECRET_SIGNED", dueDate: "2026-11-04", status: "signed" },
          {
            title: "SECRET_NOT_APPLICABLE",
            dueDate: "2026-11-04",
            status: "not_applicable",
          },
        ],
      },
    });
    for (const stage of ["closed", "terminated", "archived"])
      await dueMatter({ stage });
    const read = vi.fn(listMatters);
    const f = fixture({ listMatters: read });
    const result = await f.service.preview(actor, {
      timeZone: "America/New_York",
      leadDays: 7,
    });
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(
      ids.every((id) => result.items.some((item) => item.matterId === id)),
    ).toBe(true);
    const selected = result.items.filter(
      (item) => item.matterId === special.id,
    );
    expect(selected).toHaveLength(2);
    expect(
      selected
        .find((item) => item.label === "Active deadline")
        ?.sourceRefs.map((source) => source.kind)
        .sort(),
    ).toEqual(["deadline", "task"]);
    expect(
      selected.find((item) => item.label === "Overdue manual call")?.bucket,
    ).toBe("overdue");
    expect(JSON.stringify(selected)).not.toContain("SECRET_");
    expect(
      await prisma.outboxJob.count({
        where: {
          topic: "reminder.digest",
          idempotencyKey: { startsWith: `private-reminder:${ownerId}:` },
        },
      }),
    ).toBe(0);
    expect(f.send).not.toHaveBeenCalled();
    recordIds.push(special.id);
  });

  it("sends plaintext only to the pinned coordinator, keeps the payload free of PII and retains a redacted acceptance receipt", async () => {
    await dueMatter();
    const f = fixture();
    await f.service.enqueueScheduled();
    const job = await queued();
    expect(Object.keys(job.payload as object).sort()).toEqual([
      "dateKey",
      "recipientUserId",
      "settingsFingerprint",
    ]);
    expect(JSON.stringify(job.payload)).not.toContain(approvedEmail);
    await expect(
      f.service.handleDigest({
        ...(job.payload as object),
        to: "client@example.org",
      }),
    ).rejects.toBeDefined();
    const result = await f.service.handleDigest(job.payload);
    expect(result).toEqual({ providerAccepted: true });
    expect(f.send).toHaveBeenCalledTimes(1);
    const [url, request] = f.send.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(request!.body));
    expect(Object.keys(body).sort()).toEqual(["from", "subject", "text", "to"]);
    expect(body.to).toEqual([approvedEmail]);
    for (const secret of [
      "SECRET_CLIENT_NAMES_DO_NOT_EMAIL",
      "SECRET_PRIVATE_DOCUMENT",
      "SECRET_CLIENT_EMAIL",
      "SECRET_PRIVATE_NOTE",
      "SECRET_PROPOSED_TASK",
      "SECRET_SIGNED",
      "SECRET_NOT_APPLICABLE",
    ])
      expect(body.text).not.toContain(secret);
    expect(body.text).toContain("Sources:");
    expect(request!.signal).toBeInstanceOf(AbortSignal);
    expect(
      (request!.headers as Record<string, string>)["Idempotency-Key"],
    ).toMatch(/^weatherly-private-reminder-/);
    expect((await queued()).payload).toMatchObject({
      redacted: true,
      providerMessageId: "synthetic-provider-accepted",
    });
    await f.service.handleDigest(job.payload);
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("rechecks disabling, recipient identity/verification, changed schedule and stale dates before sending", async () => {
    await dueMatter();
    for (const change of [
      "disabled",
      "outbound",
      "recipient_id",
      "sender",
      "provider_key",
      "email",
      "role",
      "verification",
      "schedule",
      "stale",
      "revoked",
    ] as const) {
      const f = fixture();
      await f.service.enqueueScheduled();
      const job = await queued();
      if (change === "disabled")
        f.configure({ PRIVATE_REMINDERS_ENABLED: "false" });
      if (change === "outbound")
        f.configure({ OUTBOUND_EMAIL_ENABLED: "false" });
      if (change === "recipient_id")
        f.configure({ REMINDER_RECIPIENT_USER_ID: "unapproved-account" });
      if (change === "sender")
        f.configure({ SYSTEM_EMAIL_FROM: "Other <other@example.org>" });
      if (change === "provider_key")
        f.configure({ RESEND_API_KEY: "re_synthetic_changed" });
      if (change === "email")
        await prisma.user.update({
          where: { id: ownerId },
          data: { email: `changed-${run}@example.org` },
        });
      if (change === "role")
        await prisma.user.update({
          where: { id: ownerId },
          data: { role: "agent" },
        });
      if (change === "verification")
        await prisma.user.update({
          where: { id: ownerId },
          data: { emailVerified: false },
        });
      if (change === "schedule") f.configure({ REMINDER_LEAD_DAYS: "8" });
      if (change === "stale") f.setClock("2026-11-06T13:00:00Z");
      if (change === "revoked")
        await prisma.auditEvent.create({
          data: {
            actorId: ownerId,
            entityType: "User",
            entityId: ownerId,
            action: "identity.access_revoked",
            details: {},
          },
        });
      await f.service.handleDigest(job.payload);
      expect(f.send).not.toHaveBeenCalled();
      await prisma.user.update({
        where: { id: ownerId },
        data: {
          email: approvedEmail,
          role: "coordinator",
          emailVerified: true,
        },
      });
      await prisma.auditEvent.deleteMany({ where: { entityId: ownerId } });
      await prisma.outboxJob.delete({ where: { id: job.id } });
    }
    const wrong = createPrivateReminderService({
      env: () => defaultEnv(),
      approvedRecipientEmail: "different-owner@example.org",
    });
    expect(await wrong.enqueueScheduled()).toMatchObject({ enqueued: false });
  });

  it("rechecks flags after recomputing records and retries provider failure with a stable key", async () => {
    const f = fixture();
    await dueMatter();
    const initial = f.env();
    const guarded = createPrivateReminderService({
      env: f.env,
      now: () => new Date("2026-11-05T13:00:00Z"),
      fetch: f.send,
      approvedRecipientEmail: approvedEmail,
      listMatters: async (...args) => {
        const page = await listMatters(...args);
        f.configure({ OUTBOUND_EMAIL_ENABLED: "false" });
        return page;
      },
    });
    await guarded.enqueueScheduled();
    await guarded.handleDigest((await queued()).payload);
    expect(f.send).not.toHaveBeenCalled();
    await prisma.outboxJob.deleteMany({
      where: {
        topic: "reminder.digest",
        idempotencyKey: { startsWith: `private-reminder:${ownerId}:` },
      },
    });
    f.configure(initial);
    f.send.mockResolvedValueOnce(
      new Response("provider unavailable", { status: 503 }),
    );
    await f.service.enqueueScheduled();
    const job = await queued();
    await expect(f.service.handleDigest(job.payload)).rejects.toMatchObject({
      code: "REMINDER_PROVIDER_FAILED",
      status: 502,
    });
    expect((await queued()).payload).not.toHaveProperty("redacted");
    await f.service.handleDigest(job.payload);
    expect(f.send).toHaveBeenCalledTimes(2);
    const keys = f.send.mock.calls.map(
      ([, request]) =>
        (request!.headers as Record<string, string>)["Idempotency-Key"],
    );
    expect(keys[0]).toBe(keys[1]);
  });

  it("denies agent/client previews and validates timezone/window input", async () => {
    const f = fixture();
    for (const role of ["agent", "client"] as const) {
      await expect(
        f.service.preview(
          { ...actor, role },
          { timeZone: "America/New_York", leadDays: 7 },
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(f.service.status({ ...actor, role })).rejects.toMatchObject({
        status: 403,
      });
    }
    for (const input of [
      { timeZone: "Invalid/Zone", leadDays: 7 },
      { timeZone: "America/New_York", leadDays: -1 },
      { timeZone: "UTC", leadDays: 7, to: "client@example.org" },
    ])
      await expect(f.service.preview(actor, input)).rejects.toBeDefined();
  });

  it("withholds pending-review and source-conflicted files even when an internal date is confirmed", async () => {
    const pendingStage = await dueMatter({ stage: "pending_review" });
    const pendingMetadata = await dueMatter({
      details: { fileReview: { status: "pending" } },
    });
    const conflicting = await dueMatter({
      details: {
        fileReview: { status: "confirmed" },
        sourceConflicts: [
          {
            kind: "deadline",
            label: "Synthetic deadline",
            values: ["2026-11-06", "2026-11-07"],
          },
        ],
      },
    });
    const approved = await dueMatter({
      details: { fileReview: { status: "confirmed" }, sourceConflicts: [] },
    });
    const f = fixture();
    const digest = await f.service.preview(actor, {
      timeZone: "America/New_York",
      leadDays: 7,
    });
    for (const matter of [pendingStage, pendingMetadata, conflicting])
      expect(digest.items.some((item) => item.matterId === matter.id)).toBe(
        false,
      );
    expect(digest.items.some((item) => item.matterId === approved.id)).toBe(
      true,
    );
  });

  it("restarts the complete portfolio scan when its pagination cursor disappears", async () => {
    const ids = Array.from(
      { length: 205 },
      (_, i) => `reminder-cursor-${run}-${i}`,
    );
    await prisma.matter.createMany({
      data: ids.map((id) => ({
        id,
        title: "Synthetic cursor check",
        propertyAddress: id,
        side: "buyer",
        packageCode: "essentials",
      })),
    });
    matters.push(...ids);
    await prisma.deadline.createMany({
      data: ids.map((matterId) => ({
        matterId,
        label: "Cursor-safe deadline",
        date: "2026-11-06",
        status: "confirmed",
      })),
    });
    let reads = 0;
    const f = fixture({
      listMatters: async (...args) => {
        if (++reads === 2)
          throw new HttpError(
            404,
            "MATTER_NOT_FOUND",
            "Synthetic deleted cursor",
          );
        return listMatters(...args);
      },
    });
    const digest = await f.service.preview(actor, {
      timeZone: "America/New_York",
      leadDays: 7,
    });
    expect(reads).toBeGreaterThanOrEqual(4);
    expect(
      ids.every((id) => digest.items.some((item) => item.matterId === id)),
    ).toBe(true);
    expect(f.send).not.toHaveBeenCalled();
  });

  it("does not omit an unread transaction that is edited during pagination", async () => {
    const ids = Array.from(
      { length: 205 },
      (_, i) => `reminder-moving-${run}-${i}`,
    );
    await prisma.matter.createMany({
      data: ids.map((id) => ({
        id,
        title: "Synthetic concurrent portfolio edit",
        propertyAddress: id,
        side: "buyer",
        packageCode: "essentials",
      })),
    });
    matters.push(...ids);
    await prisma.deadline.createMany({
      data: ids.map((matterId) => ({
        matterId,
        label: "Concurrent approved deadline",
        date: "2026-11-06",
        status: "confirmed",
      })),
    });
    let movedId: string | undefined;
    const f = fixture({
      listMatters: async (...args) => {
        const page = await listMatters(...args);
        if (!movedId) {
          movedId = ids.find((id) => !page.some((matter) => matter.id === id))!;
          expect(movedId).toBeDefined();
          await prisma.matter.update({
            where: { id: movedId },
            data: {
              title: "A legitimate coordinator correction",
              revision: { increment: 1 },
              updatedAt: new Date(Date.now() + 10_000),
            },
          });
        }
        return page;
      },
    });
    const digest = await f.service.preview(actor, {
      timeZone: "America/New_York",
      leadDays: 7,
    });
    expect(digest.items.some((item) => item.matterId === movedId)).toBe(true);
    expect(f.send).not.toHaveBeenCalled();
  });

  it("does not email a task completed while the portfolio scan was running", async () => {
    const label = `Completed during scan ${randomUUID()}`;
    const matter = await dueMatter({
      deadlines: { create: [] },
      tasks: {
        create: [
          {
            title: label,
            dueDate: "2026-11-06",
          },
        ],
      },
    });
    const task = await prisma.task.findFirstOrThrow({
      where: { matterId: matter.id },
    });
    let changed = false;
    const f = fixture({
      listMatters: async (...args) => {
        const page = await listMatters(...args);
        if (!changed && page.some((row) => row.id === matter.id)) {
          changed = true;
          await updateTask(actor, matter.id, task.id, {
            expectedRevision: task.revision,
            status: "completed",
          });
        }
        return page;
      },
    });
    await f.service.enqueueScheduled();
    await f.service.handleDigest((await queued()).payload);
    expect(changed).toBe(true);
    for (const [, request] of f.send.mock.calls)
      expect(
        String(JSON.parse(String(request!.body)).text).includes(label),
      ).toBe(false);
  });
});
