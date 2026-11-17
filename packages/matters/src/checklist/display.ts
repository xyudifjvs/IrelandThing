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
