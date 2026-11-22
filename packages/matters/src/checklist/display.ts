const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function emailDate(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match
    ? `${Number(match[2])}/${Number(match[3])}/${match[1].slice(-2)}`
    : value || "";
}
export function checklistMoney(value: unknown) {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    !/^\d+$/.test(String(value))
  )
    return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number(value) % 100 ? 2 : 0,
  }).format(Number(value) / 100);
}
/** Display text is separate from the real due date and never supplies a date rule. */
export function checklistWording(
  task:
    | { dueDate?: string | null; dateRule?: unknown; details?: unknown }
    | undefined,
  stepKey: string,
) {
  if (!task) return "";
  const details = record(task.details);
  if (typeof details.dateWording === "string" && details.dateWording.trim())
    return details.dateWording;
  if (stepKey === "closing")
    return task.dueDate ? `on or before ${emailDate(task.dueDate)}` : "";
  if (stepKey === "final_walkthrough") {
    const rule = record(task.dateRule),
      offset = record(rule.offset),
      anchor = record(offset.anchor);
    if (
      rule.kind === "relative" &&
      anchor.kind === "step" &&
      anchor.key === "closing" &&
      offset.unit === "days" &&
      typeof offset.amount === "number" &&
      offset.amount <= 0
    ) {
      const days = Math.abs(offset.amount);
      return `within ${days} ${offset.counting === "business" ? "business " : ""}${days === 1 ? "day" : "days"} of closing`;
    }
    return "";
  }
  if (stepKey === "possession") {
    const rule = record(task.dateRule),
      offset = record(rule.offset),
      anchor = record(offset.anchor);
    if (
      rule.kind === "relative" &&
      anchor.kind === "step" &&
      anchor.key === "closing" &&
      typeof offset.amount === "number" &&
      ["days", "hours"].includes(String(offset.unit))
    ) {
      if (offset.amount === 0) return "at closing";
      const count = Math.abs(offset.amount),
        unit = offset.unit === "days" ? "day" : "hour";
      return `${count} ${offset.counting === "business" ? "business " : ""}${unit}${count === 1 ? "" : "s"} ${offset.amount < 0 ? "before" : "after"} closing`;
    }
  }
  return emailDate(task.dueDate);
}

/** The same public label is used for agent and client timelines. */
export function checklistDateLabel(
  task: {
    dueDate?: string | null;
    dueAt?: Date | string | null;
    dateRule?: unknown;
    details?: unknown;
  },
  stepKey: string,
  timeZone = "America/New_York",
) {
  const label = checklistWording(task, stepKey) || emailDate(task.dueDate);
  const data = record(task.details);
  if (typeof data.dateWording === "string" && data.dateWording.trim())
    return label;
  if (
    !task.dueAt ||
    !label ||
    !["", "fixed"].includes(String(record(task.dateRule).kind || ""))
  )
    return label;
  const at = new Date(task.dueAt);
  if (!Number.isFinite(at.valueOf())) return label;
  try {
    return `${label} at ${new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(at)}`;
  } catch {
    return label;
  }
}

/** Concise appointment label; the stored instant and timezone remain unchanged. */
export function scheduledAppointment(
  value: string | Date | null | undefined,
  timeZone = "America/New_York",
) {
  if (!value) return "";
  const at = new Date(value);
  if (!Number.isFinite(at.valueOf())) return "";
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(at);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at);
  return `${date} at ${time}`;
}
