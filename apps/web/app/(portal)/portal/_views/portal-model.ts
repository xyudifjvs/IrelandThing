import type { Matter } from "../../../(workspace)/workspace/_components/data";

export type PortalTask = {
  id: string;
  title: string;
  status: string;
  dueDate?: string | null;
  dueAt?: string | null;
  stepKey?: string | null;
  kind?: string;
  scheduled?: boolean;
  appointmentAt?: string | null;
  appointmentPlace?: string;
  note?: string;
  dateLabel?: string;
};

export type PortalPerson = {
  id: string;
  name: string;
  role: string;
  email?: string | null;
  phone?: string | null;
};

export type PortalDocument = {
  id: string;
  name?: string;
  filename?: string;
  mimeType?: string;
  createdAt?: string;
};

export type FileService = {
  name: string;
  amountCents: number;
  currency: string;
};

export type PortalFile = Omit<Matter, "tasks" | "documents"> & {
  business?: string;
  closedOn?: string | null;
  clientNames?: string[];
  documents?: PortalDocument[];
  people?: PortalPerson[];
  tasks?: PortalTask[];
  service?: FileService;
};

export type PortalRole = "agent" | "client";
export type FileGroup = "active" | "closed" | "terminated";

export const activeStage = (stage?: string) =>
  stage === "under_contract" || stage === "closing" || stage === "listing";

export function fileGroup(stage?: string): FileGroup {
  if (stage === "terminated") return "terminated";
  return stage === "closed" || stage === "archived" ? "closed" : "active";
}

export function completed(task: PortalTask) {
  return task.status === "completed" || task.status === "signed";
}

export function notNeeded(task: PortalTask) {
  return task.status === "not_applicable" || task.status === "not_needed";
}

export function fileAddress(file: PortalFile) {
  return (
    file.propertyAddress || file.title || file.address || "Address pending"
  );
}

export function fileStatus(stage?: string) {
  switch (stage) {
    case "pending_review":
      return "New contract · Intake received";
    case "under_contract":
    case "closing":
      return "Under contract · File created";
    case "listing":
      return "Listing · File created";
    case "closed":
      return "Closed";
    case "terminated":
      return "Terminated";
    case "archived":
      return "Archived";
    default:
      return "File created";
  }
}

function dateTime(value: string, options: Intl.DateTimeFormatOptions) {
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const instant = new Date(dayOnly ? value + "T12:00:00Z" : value);
  if (Number.isNaN(instant.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: dayOnly ? "UTC" : "America/New_York",
    ...options,
  }).format(instant);
}

export function shortDate(value?: string | null, year = false) {
  if (!value) return "";
  return dateTime(value, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(year ? { year: "numeric" } : {}),
  });
}

function appointmentTime(task: PortalTask) {
  if (!task.appointmentAt) return "";
  return dateTime(task.appointmentAt, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function appointment(task: PortalTask) {
  return [appointmentTime(task), task.appointmentPlace]
    .filter(Boolean)
    .join(" · ");
}

export function clientStepDate(task: PortalTask) {
  if (task.dateLabel)
    return [task.dateLabel, appointment(task)].filter(Boolean).join(" · ");
  const day = shortDate(task.dueDate);
  if (!scheduledStep(task)) return day;
  const time = appointmentTime(task);
  return (
    time
      ? [time, task.appointmentPlace]
      : [day, "Details to come", task.appointmentPlace]
  )
    .filter(Boolean)
    .join(" · ");
}

export function scheduledStep(task: PortalTask) {
  const key =
    task.stepKey ||
    task.title
      .trim()
      .toLowerCase()
      .replace(/[^a-z]+/g, "_");
  return key === "closing" || key === "final_walkthrough";
}

export function closingTask(tasks?: readonly PortalTask[]) {
  return (
    tasks?.find((task) => task.stepKey === "closing") ??
    tasks?.find((task) => task.title.trim().toLowerCase() === "closing")
  );
}

export function nextDatedStep(tasks?: readonly PortalTask[]) {
  return tasks
    ?.filter((task) => !!task.dueDate && !completed(task) && !notNeeded(task))
    .sort((left, right) => left.dueDate!.localeCompare(right.dueDate!))[0];
}

export function displayLabel(value?: string) {
  return (value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function emailLink(email?: string | null) {
  if (!email || !/^[^\s@?:&#]+@[^\s@?:&#]+$/.test(email)) return null;
  return "mailto:" + encodeURIComponent(email).replace(/%40/g, "@");
}

export function money(amountCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: amountCents % 100 ? 2 : 0,
    minimumFractionDigits: amountCents % 100 ? 2 : 0,
  }).format(amountCents / 100);
}

export type FeeSummary = {
  name: string;
  amountCents: number | null;
  currency: string | null;
  status: string;
  paidAt: string | null;
};

export type FileSummary = {
  matterId: string;
  propertyAddress: string;
  service: FeeSummary | null;
  gift: FeeSummary | null;
};

export function feeStatus(fee: FeeSummary) {
  if (fee.paidAt && ["paid", "ordered", "delivered"].includes(fee.status))
    return `Paid ${shortDate(fee.paidAt, true)}`;
  switch (fee.status) {
    case "due_at_closing":
      return "Due at closing";
    case "awaiting_quote":
      return "Price to come";
    case "awaiting_payment":
    case "pending":
      return "Awaiting payment";
    default:
      return displayLabel(fee.status);
  }
}
