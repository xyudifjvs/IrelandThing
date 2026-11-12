import { prisma } from "@weatherly/db";
import type { listMatters } from "@weatherly/matters";
import {
  assertCoordinator,
  HttpError,
  validDate,
  type Principal,
} from "@weatherly/platform";
import { reminderLocalClock } from "./schedule";
import { clean } from "./content";

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
export async function collectReminderDates(
  actor: Principal,
  settings: { timeZone: string; leadDays: number },
  at: Date,
  readMatters: typeof listMatters,
) {
  assertCoordinator(actor);
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
      const source = record(matter);
      const details = record(source.details);
      if (
        record(details.fileReview).status === "pending" ||
        (source.checklistVersion == null &&
          Array.isArray(details.sourceConflicts) &&
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
        const matches = key ? tasks.filter((task) => keyFor(task) === key) : [];
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
export async function sourcesStillCurrent(revisions: Map<string, number>) {
  // Canonical task/date edits increment the matter revision. Validate every
  // scanned record, including previously empty/pending files, before dispatch.
  const pending = await prisma.intakeSubmission.findMany({
    where: { processedAt: null },
    select: { matterId: true },
  });
  const excluded = pending.map((row) => row.matterId);
  if (
    (await prisma.matter.count({ where: { id: { notIn: excluded } } })) !==
      revisions.size ||
    excluded.some((id) => revisions.has(id))
  )
    return false;
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
