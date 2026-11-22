import {
  dateValueSchema,
  type ChecklistDateEdit,
  type ChecklistDateRule,
  type DateValue,
} from "@weatherly/platform/handoff-contracts";
import { date, type Matter, type Task } from "../../_components/data";

export type DateChange = ChecklistDateEdit["change"];
export type DateTarget = Extract<DateChange, { kind: "set" }>["target"];
export type DateMove = {
  target: DateTarget;
  before: DateValue | null;
  after: DateValue | null;
};
export type DatePreview = {
  revision: number;
  primary: DateMove;
  dependents: DateMove[];
  previewDigest: string;
};

export type ChecklistTaskRecord = Task & {
  stepKey: string;
  dateCapable: boolean;
  actualDate: string | null;
  actualAt: string | null;
  dateRule: ChecklistDateRule | null;
  details?: {
    scheduled?: boolean;
    appointmentAt?: string | null;
    appointmentPlace?: string;
    note?: string;
    showNoteToAgent?: boolean;
    dateWording?: string;
    amountCents?: number | null;
    holder?: string;
    company?: string;
    earnestMoneyCents?: number | null;
    earnestMoneyHolder?: string;
    homeWarrantyCents?: number | null;
    homeWarrantyCompany?: string;
  };
};

export type ChecklistMatter = Matter & {
  checklistVersion: 1;
  acceptanceDate: string | null;
  acceptanceAt: string | null;
  deadlineTimeZone: string | null;
  tasks?: ChecklistTaskRecord[];
};

export function hasVersionedChecklist(
  matter: Matter,
): matter is ChecklistMatter {
  return "checklistVersion" in matter && matter.checklistVersion === 1;
}

export function isChecklistTask(task: ChecklistTaskRecord) {
  return (
    typeof task.stepKey === "string" && typeof task.dateCapable === "boolean"
  );
}

export function isComplete(task: Task) {
  return task.status === "completed" || task.status === "signed";
}

export function dueDateValue(task: ChecklistTaskRecord): DateValue | null {
  return task.dueDate
    ? { date: task.dueDate, instant: task.dueAt ?? null }
    : null;
}

export function actualDateValue(task: ChecklistTaskRecord): DateValue | null {
  return task.actualDate
    ? { date: task.actualDate, instant: task.actualAt }
    : null;
}

export function displayDate(value: DateValue | null, timeZone: string | null) {
  if (!value) return "No date";
  const instant = value.instant ? new Date(value.instant) : null;
  if (!timeZone || !instant || !Number.isFinite(instant.getTime()))
    return date(value.date);
  return `${date(value.date)} at ${new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant)}`;
}

export function targetLabel(
  target: DateTarget,
  labels: Record<string, string>,
) {
  if (target.kind === "acceptance") return "Acceptance date";
  const title =
    labels[target.key] || (target.key === "remedies" ? "Remedies" : target.key);
  return target.kind === "actual" ? `Actual date for ${title}` : title;
}

export function ruleText(
  rule: ChecklistDateRule | null,
  labels: Record<string, string>,
) {
  if (!rule || rule.kind === "fixed") return null;
  type Offset = Extract<ChecklistDateRule, { kind: "relative" }>["offset"];
  const describe = ({ amount, anchor, unit, counting }: Offset) => {
    const name =
      anchor.kind === "acceptance" ? "acceptance" : targetLabel(anchor, labels);
    if (amount === 0 && unit === "days") return `Same day as ${name}`;
    const duration = Math.abs(amount);
    const singular = unit === "days" ? "day" : "hour";
    return `${duration} ${counting === "business" ? "business " : ""}${duration === 1 ? singular : unit} ${amount < 0 ? "before" : "after"} ${name}`;
  };
  const base =
    rule.kind === "relative"
      ? describe(rule.offset)
      : `Earlier of ${describe(rule.offsets[0])} or ${describe(rule.offsets[1])}`;
  const adjustments = rule.adjustments?.map(
    ({ amount, unit }) =>
      `${amount} ${amount === 1 ? (unit === "days" ? "day" : "hour") : unit}`,
  );
  return adjustments?.length
    ? `${base} · Extended by ${adjustments.join(" and ")}`
    : base;
}
