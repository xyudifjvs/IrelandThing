import type { TransactionBusiness } from "@weatherly/platform/handoff-contracts";
import type { Matter, Task } from "../../_components/data";
import type { FileDocument } from "../documents/FileDocumentsPanel";
import type { FilePerson } from "../people/PeopleOnFilePanel";
import {
  hasVersionedChecklist,
  isChecklistTask,
  isComplete,
  type ChecklistTaskRecord,
} from "../checklist/canonical-checklist-model";

export type TransactionFile = Matter & {
  business?: TransactionBusiness["business"] | null;
  agentRosterId?: string | null;
  contacts?: FilePerson[];
  documents?: FileDocument[];
};

export const fileTabs = [
  { id: "checklist", label: "Checklist" },
  { id: "emails", label: "Emails" },
  { id: "documents", label: "Documents" },
  { id: "intake", label: "Intake" },
  { id: "compliance", label: "Compliance" },
] as const;

export type FileTab = (typeof fileTabs)[number]["id"];

export function selectedFileTab(tab: string | null): FileTab {
  return fileTabs.find(({ id }) => id === tab)?.id ?? "checklist";
}

export function isActiveFile(file: Matter) {
  return ["under_contract", "closing", "listing"].includes(file.stage ?? "");
}

export function isPendingFile(file: Matter) {
  return (
    file.stage === "pending_review" ||
    object(file.details?.fileReview)?.status === "pending"
  );
}

export function businessLabel(business: TransactionFile["business"]) {
  if (business === "hto") return "Home Team Ohio";
  if (business === "weatherly") return "Weatherly TC";
  return "Business unassigned";
}

function object(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
}

function savedText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function legacyPeople(file: TransactionFile) {
  if (hasVersionedChecklist(file)) return [];
  const contacts = Array.isArray(file.details?.contacts)
    ? file.details.contacts
    : [];
  const clients = Array.isArray(file.details?.clients)
    ? file.details.clients
    : [];
  const contactKey = ({ email, role }: { email: string; role: string }) =>
    `${role.trim().toLowerCase()}:${email.trim().toLowerCase()}`;
  const known = new Set(
    file.contacts?.filter(({ email }) => email).map(contactKey),
  );
  const entries: (Record<string, unknown> | undefined)[] = [
    ...clients.map((value) => ({ ...object(value), role: "client" })),
    ...contacts.map(object),
  ];
  return entries.flatMap((entry) => {
    const person = {
      name: savedText(entry?.name),
      email: savedText(entry?.email),
      phone: savedText(entry?.phone),
      role: savedText(entry?.role),
    };
    const key = contactKey(person);
    if (known.has(key) || !(person.name || person.email || person.phone))
      return [];
    if (person.email) known.add(key);
    return [person];
  });
}

export function fileClientNames(file: TransactionFile) {
  return [
    ...new Set(
      [...(file.contacts ?? []), ...legacyPeople(file)]
        .filter(({ role }) =>
          ["client", "buyer", "seller"].includes(role.trim().toLowerCase()),
        )
        .map(({ name }) => name.trim())
        .filter(Boolean),
    ),
  ];
}

export function closingDate(file: Matter) {
  if (hasVersionedChecklist(file)) {
    const tasks: ChecklistTaskRecord[] = file.tasks ?? [];
    const closing = tasks.find(({ stepKey }) => stepKey === "closing");
    return (
      (file.stage === "closed" ? closing?.actualDate : null) ?? closing?.dueDate
    );
  }
  return (
    file.deadlines?.find(
      ({ label, status }) =>
        label.trim().toLowerCase() === "closing" && status === "confirmed",
    )?.date ??
    file.closingDate ??
    file.closeAt
  );
}

const retiredTaskKinds = new Set([
  "broker",
  "compliance",
  "manual_review",
  "unresolved_date",
]);

export function isLegacyFileTask({ kind }: Task) {
  return !retiredTaskKinds.has(kind ?? "");
}

export function nextChecklistDate(file: Matter) {
  if (!isActiveFile(file)) return;
  const dated: Task[] = hasVersionedChecklist(file)
    ? (file.tasks ?? []).filter(isChecklistTask)
    : (file.tasks ?? []).filter(isLegacyFileTask);
  return dated
    .filter(
      (task) =>
        task.dueDate && !isComplete(task) && task.status !== "not_applicable",
    )
    .sort(
      (a, b) =>
        a.dueDate!.localeCompare(b.dueDate!) ||
        (a.position ?? 0) - (b.position ?? 0),
    )[0];
}

export function lifecycleDate(file: Matter, key: "closeOut" | "termination") {
  const at = savedText(object(file.details?.[key])?.at);
  if (!at || !Number.isFinite(Date.parse(at))) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(at));
}
