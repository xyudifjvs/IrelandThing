import { type Prisma } from "@weatherly/db";
import { validDate } from "@weatherly/platform";
import { approvedWorkflowTaskDates } from "../rules";
import { projectTaskFields } from "../projections/task-fields";
import { appointmentCalendarLabel, calendarStepKey } from "./calendar-labels";

export const activePortfolioStages = ["under_contract", "closing", "listing"];
export const completedMilestoneStates = new Set(["completed", "signed"]);
export const portfolioTimeZone = "America/New_York";
export const milestoneInclude = { tasks: true, deadlines: true } as const;
export type MilestoneMatter = Prisma.MatterGetPayload<{
  include: typeof milestoneInclude;
}>;
export type PortfolioMilestone = {
  id: string;
  matterId: string;
  propertyAddress: string;
  label: string;
  day: string;
  at?: string;
  kind: "deadline" | "task" | "appointment" | "email";
  status: string;
  location?: string;
};

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function civilDay(at: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: portfolioTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function addCivilDays(day: string, days: number) {
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function workflowKey(value: unknown) {
  const key = object(value).workflowKey;
  return typeof key === "string" ? key.trim().toLowerCase() : "";
}

function activeTask(status: string) {
  return (
    !completedMilestoneStates.has(status) &&
    status !== "not_applicable" &&
    status !== "proposed"
  );
}

export function portfolioMilestones(
  matter: MilestoneMatter,
  history = false,
  calendarView = false,
  completionDays: ReadonlyMap<string, string> = new Map(),
  options: {
    preferAppointments?: boolean;
    hideSkippedDeadlines?: boolean;
  } = {},
) {
  const canonical = matter.checklistVersion !== null;
  const tasks = canonical
    ? matter.tasks.filter((task) => task.stepKey !== null)
    : approvedWorkflowTaskDates(matter.tasks, matter.deadlines, matter.details);
  const events: PortfolioMilestone[] = [];
  const keys = new Set<string>();
  const base = { matterId: matter.id, propertyAddress: matter.propertyAddress };
  let closing: string | null = null;
  for (const task of tasks) {
    if (
      task.status === "not_applicable" ||
      task.status === "proposed" ||
      (options.hideSkippedDeadlines && task.status === "not_needed")
    )
      continue;
    const isClosing = canonical
      ? task.stepKey === "closing"
      : /^(closing|closing date)$/i.test(task.title.trim());
    if (isClosing) {
      const date =
        matter.stage === "closed"
          ? (task.actualDate ?? task.dueDate)
          : task.dueDate;
      if (date && validDate(date)) closing = date;
    }
    if (!history && !activeTask(task.status)) continue;
    const { appointmentAt } = projectTaskFields(task);
    const hasAppointment =
      !!appointmentAt && Number.isFinite(Date.parse(appointmentAt));
    if (
      calendarView &&
      calendarStepKey(task) === "appraisal_ordered" &&
      !hasAppointment
    ) {
      const completedOn =
        completionDays.get(task.id) ||
        task.actualDate ||
        (task.actualAt ? civilDay(task.actualAt) : null);
      if (
        completedMilestoneStates.has(task.status) &&
        completedOn &&
        validDate(completedOn)
      )
        events.push({
          ...base,
          id: task.id,
          label: "Appraisal ordered",
          day: completedOn,
          kind: "task",
          status: task.status,
        });
      continue;
    }
    if (
      task.dueDate &&
      validDate(task.dueDate) &&
      !(options.preferAppointments && hasAppointment)
    ) {
      const key = workflowKey(task.details);
      if (!canonical && key) keys.add(key);
      events.push({
        ...base,
        id: task.id,
        label: task.title,
        day: task.dueDate,
        kind: "task",
        status: task.status,
        ...(task.dueAt ? { at: task.dueAt.toISOString() } : {}),
      });
    }
    if (appointmentAt) {
      const at = new Date(appointmentAt);
      if (!Number.isNaN(at.valueOf()))
        events.push({
          ...base,
          id: task.id,
          label: calendarView
            ? appointmentCalendarLabel(task)
            : task.title + " appointment",
          day: civilDay(at),
          at: appointmentAt,
          kind: "appointment",
          status: task.status,
          ...(calendarView &&
          typeof object(task.details).appointmentPlace === "string"
            ? { location: String(object(task.details).appointmentPlace) }
            : {}),
        });
    }
  }
  if (!canonical) {
    for (const deadline of matter.deadlines) {
      if (
        deadline.status !== "confirmed" ||
        !deadline.date ||
        !validDate(deadline.date)
      )
        continue;
      if (/^(closing|closing date)$/i.test(deadline.label.trim()))
        closing ??= deadline.date;
      const key = workflowKey(deadline.details);
      const matches = tasks.filter((task) =>
        key
          ? workflowKey(task.details) === key
          : task.title.trim().toLowerCase() ===
            deadline.label.trim().toLowerCase(),
      );
      if (
        options.preferAppointments &&
        matches.some((task) => {
          const at = projectTaskFields(task).appointmentAt;
          return !!at && Number.isFinite(Date.parse(at));
        })
      )
        continue;
      if (
        calendarView &&
        matches.some((task) => calendarStepKey(task) === "appraisal_ordered")
      )
        continue;
      if (
        options.hideSkippedDeadlines &&
        matches.length &&
        matches.every((task) =>
          ["not_applicable", "not_needed", "proposed"].includes(task.status),
        )
      )
        continue;
      if (
        matches.length &&
        ((!history && matches.every((task) => !activeTask(task.status))) ||
          matches.some((task) => task.dueDate === deadline.date))
      )
        continue;
      if (key && keys.has(key)) continue;
      events.push({
        ...base,
        id: deadline.id,
        label: deadline.label,
        day: deadline.date,
        kind: "deadline",
        status: deadline.status,
      });
      if (key) keys.add(key);
    }
  }
  events.sort(compareMilestones);
  return { events, closing };
}

export function compareMilestones(
  a: PortfolioMilestone,
  b: PortfolioMilestone,
) {
  return (
    a.day.localeCompare(b.day) ||
    (a.at ?? "").localeCompare(b.at ?? "") ||
    a.propertyAddress.localeCompare(b.propertyAddress) ||
    a.label.localeCompare(b.label) ||
    a.id.localeCompare(b.id)
  );
}
