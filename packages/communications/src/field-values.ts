import type { Principal } from "@weatherly/platform";
import { prisma } from "@weatherly/db";
import { requireMatter, fileReviewPending } from "@weatherly/matters";
import { contactRoleFamily } from "../../contacts/src/transaction-sources";
import {
  canonicalFieldKey,
  firstName,
  formatEmailDate,
  type FieldDefinition,
  type FieldSource,
} from "./field-catalog";
import {
  listFieldDefinitions,
  normalizeCompanyName,
  type FieldDb,
} from "./field-sources";
import { legacyMergeFields, type MergeField } from "./merge-fields";
import { asRecord } from "./policy";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const normalized = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 180);
const names = (values: string[]) =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(
    values.filter(Boolean),
  );
const unique = (values: string[]) => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean)),
];
export {
  checklistMoney as emailMoney,
  checklistWording,
} from "../../matters/src/checklist/display";
import {
  checklistMoney as emailMoney,
  checklistWording,
  scheduledAppointment,
} from "../../matters/src/checklist/display";

export async function resolveMergeFields(
  actor: Principal,
  matterId: string,
  db: FieldDb = prisma,
): Promise<MergeField[]> {
  const matter = await requireMatter(actor, matterId, false, db);
  const [
    old,
    definitions,
    tasks,
    contacts,
    settings,
    companies,
    agent,
    roster,
  ] = await Promise.all([
    legacyMergeFields(actor, matterId, db),
    listFieldDefinitions(actor, db),
    db.task.findMany({
      where: { matterId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    }),
    db.matterContact.findMany({
      where: { matterId, retiredAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    db.mergeFieldSettings.findUnique({ where: { ownerId: actor.id } }),
    db.companyMergeProfile.findMany(),
    matter.agentId
      ? db.user.findUnique({
          where: { id: matter.agentId },
          select: { id: true, name: true, email: true, brokerage: true },
        })
      : null,
    matter.agentRosterId
      ? db.rosterAgent.findUnique({ where: { id: matter.agentRosterId } })
      : matter.agentId
        ? db.rosterAgent.findUnique({ where: { userId: matter.agentId } })
        : null,
  ]);
  const details = asRecord(matter.details),
    detailValues = asRecord(details.mergeFieldValues);
  const oldByKey = new Map<string, MergeField>();
  for (const field of old) {
    const key = canonicalFieldKey(field.key),
      previous = oldByKey.get(key);
    if (!previous) oldByKey.set(key, { ...field, key });
    else if (!previous.value && previous.status !== "ambiguous" && field.value)
      oldByKey.set(key, { ...field, key });
    else if (previous.value && field.value && previous.value !== field.value)
      oldByKey.set(key, {
        ...previous,
        value: null,
        status: "ambiguous",
        sourceIds: [...new Set([...previous.sourceIds, ...field.sourceIds])],
      });
  }
  const profile = {
    id: agent?.id ?? roster?.id,
    name: agent?.name ?? roster?.name ?? "",
    email: agent?.email ?? roster?.email ?? "",
    phone: roster?.phone ?? "",
    brokerage: agent?.brokerage ?? roster?.brokerage ?? "",
  };
  const legacyPeople =
    matter.checklistVersion === null
      ? [
          ...(Array.isArray(details.clients)
            ? details.clients.map((person) => ({
                ...asRecord(person),
                role: "client",
              }))
            : []),
          ...(Array.isArray(details.contacts)
            ? details.contacts.map(asRecord)
            : []),
        ]
      : [];
  const people = [...contacts, ...legacyPeople] as {
    id?: string;
    name?: string;
    role?: string;
    email?: string;
    phone?: string;
    company?: string;
  }[];
  const field = (
    definition: FieldDefinition,
    value: string | null,
    sourceIds: string[] = [matter.id],
    ambiguous = false,
  ): MergeField => ({
    key: definition.key,
    label: definition.label,
    value: value?.trim() ? value : null,
    status: ambiguous ? "ambiguous" : value?.trim() ? "confirmed" : "unknown",
    sourceIds,
  });
  const stepAliases: Record<string, string[]> = {
    home_warranty: ["home_warranty", "home_warranty_ordered"],
  };
  const getTasks = (stepKey: string) =>
    tasks.filter((task) =>
      stepKey.startsWith("title:")
        ? normalized(task.title) === stepKey.slice(6)
        : (stepAliases[stepKey] ?? [stepKey]).includes(
            task.stepKey || text(asRecord(task.details).workflowKey),
          ),
    );
  function taskValue(
    definition: FieldDefinition,
    source: Extract<FieldSource, { kind: "checklist" }>,
  ) {
    if (matter.checklistVersion === null && source.property === "date") {
      const legacy = oldByKey.get(definition.key);
      return legacy
        ? {
            ...legacy,
            label: definition.label,
            value: formatEmailDate(legacy.value) || null,
          }
        : field(definition, null);
    }
    const candidates = getTasks(source.stepKey).filter(
      (task) => task.status !== "not_applicable",
    );
    if (!candidates.length && source.property === "date") {
      const anchor = (
        Array.isArray(details.checklistDateAnchors)
          ? details.checklistDateAnchors
          : []
      )
        .map(asRecord)
        .find(
          (row) => row.key === source.stepKey && row.status !== "not_needed",
        );
      if (anchor)
        return field(
          definition,
          formatEmailDate(text(asRecord(anchor.due).date)),
        );
    }
    const values = candidates.map((task) => {
      const data = asRecord(task.details);
      if (source.property === "date")
        return definition.key === "closing_date"
          ? formatEmailDate(task.dueDate)
          : text(data.dateWording).trim()
            ? text(data.dateWording)
            : formatEmailDate(task.dueDate);
      if (source.property === "wording")
        return checklistWording(task, source.stepKey);
      if (source.property === "status")
        return (
          text(data.dateWording) ||
          (["completed", "signed"].includes(task.status)
            ? "Received"
            : "Pending")
        );
      if (source.property === "amount")
        return emailMoney(
          Object.hasOwn(data, "amountCents")
            ? data.amountCents
            : source.stepKey === "earnest_money_due"
              ? data.earnestMoneyCents
              : data.homeWarrantyCents,
        );
      if (source.property === "holder")
        return text(data.holder ?? data.earnestMoneyHolder);
      if (source.property === "company")
        return text(data.company ?? data.homeWarrantyCompany);
      if (source.property === "schedule") {
        const value = text(data.appointmentAt);
        if (!value) return "";
        const at = new Date(value);
        if (!Number.isFinite(at.valueOf())) return "";
        return [
          scheduledAppointment(
            at,
            matter.deadlineTimeZone || "America/New_York",
          ),
          text(data.appointmentPlace),
        ]
          .filter(Boolean)
          .join(" · ");
      }
      return "";
    });
    const distinct = unique(values);
    if (!candidates.length)
      return oldByKey.get(definition.key)
        ? {
            ...oldByKey.get(definition.key)!,
            label: definition.label,
            value: formatEmailDate(oldByKey.get(definition.key)!.value) || null,
          }
        : field(definition, null);
    return field(
      definition,
      distinct.length === 1 ? values.find((v) => v.trim())! : null,
      candidates.map((task) => task.id),
      distinct.length > 1,
    );
  }
  const resolved = definitions.map((definition): MergeField => {
    if (!["both", matter.side].includes(definition.side))
      return field(definition, null);
    const source = definition.source;
    if (source.kind === "legacy")
      return oldByKey.get(source.key) ?? field(definition, null);
    if (source.kind === "details")
      return field(definition, text(detailValues[source.key]));
    if (source.kind === "checklist") return taskValue(definition, source);
    if (source.kind === "unsupported") return field(definition, null);
    if (source.kind === "transaction") {
      if (source.property === "propertyAddress")
        return field(definition, matter.propertyAddress);
      if (source.property === "acceptanceDate")
        return field(
          definition,
          formatEmailDate(
            matter.acceptanceDate || oldByKey.get(definition.key)?.value,
          ),
        );
      if (source.property === "mlsInstructions") {
        const answers = asRecord(asRecord(details.referenceIntake).fields);
        return field(
          definition,
          answers.mls === "no"
            ? "None"
            : answers.mls === "yes"
              ? [
                  text(answers.mls_sell)
                    ? `Selling agent: ${text(answers.mls_sell)}`
                    : "",
                  text(answers.mls_cosell)
                    ? `Co-selling agent: ${text(answers.mls_cosell)}`
                    : "",
                ]
                  .filter(Boolean)
                  .join("\n")
              : "",
        );
      }
      if (source.property === "deadlines" && matter.checklistVersion === null)
        return field(
          definition,
          [...oldByKey.values()]
            .filter(
              (row) =>
                /_(?:date|deadline)$/.test(row.key) &&
                row.status === "confirmed" &&
                row.value,
            )
            .map((row) => `${row.label}: ${formatEmailDate(row.value)}`)
            .join("\n"),
        );
      if (source.property === "deadlines")
        return field(
          definition,
          tasks
            .filter((task) => task.status !== "not_applicable" && task.dueDate)
            .map(
              (task) =>
                `${task.title}: ${text(asRecord(task.details).dateWording) || formatEmailDate(task.dueDate)}`,
            )
            .join("\n"),
        );
      return oldByKey.get(definition.key) ?? field(definition, null);
    }
    if (source.kind === "settings")
      return field(
        definition,
        source.key === "name"
          ? settings?.name || actor.name
          : text(settings?.[source.key]),
        [actor.id],
      );
    if (source.kind === "intake") {
      const answers = asRecord(asRecord(details.referenceIntake).fields);
      const value = answers[source.key];
      return field(
        definition,
        typeof value === "boolean"
          ? value
            ? "Yes"
            : "No"
          : formatEmailDate(text(value)),
      );
    }
    if (source.kind === "agent") {
      const value =
        source.property === "first_name"
          ? firstName(profile.name)
          : source.property === "contact_info"
            ? [profile.email, profile.phone].filter(Boolean).join(" · ")
            : profile[source.property];
      return field(definition, value, profile.id ? [profile.id] : []);
    }
    if (source.kind === "company") {
      const matches =
        source.kindOfCompany === "brokerage"
          ? [profile.brokerage]
          : unique(
              people
                .filter(
                  (person) => contactRoleFamily(person.role || "") === "title",
                )
                .map((person) => person.company || ""),
            );
      const matchesByName = unique(matches);
      if (matchesByName.length !== 1)
        return field(definition, null, [], matchesByName.length > 1);
      const saved = companies.find(
        (company) =>
          company.kind === source.kindOfCompany &&
          company.normalizedName === normalizeCompanyName(matchesByName[0]),
      );
      return field(
        definition,
        saved?.text ?? null,
        saved
          ? [`${saved.kind}:${saved.normalizedName}:${saved.revision}`]
          : [],
      );
    }
    const role = source.role.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const matches = people.filter((person) => {
      const current = (person.role || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_");
      if (role === "client")
        return current === "client" || current === matter.side;
      if (
        ["buyer", "seller"].includes(role) &&
        role === matter.side &&
        current === "client"
      )
        return true;
      return contactRoleFamily(current) === role || current === role;
    });
    const values = matches.map((person) =>
      source.property === "first_name"
        ? firstName(person.name || "")
        : source.property === "contact_info"
          ? [person.name, person.company, person.email, person.phone]
              .filter(Boolean)
              .join(" · ")
          : person[source.property] || "",
    );
    const distinct = unique(values),
      manyAllowed = ["client", "buyer", "seller"].includes(role);
    const value = manyAllowed
      ? source.property === "contact_info"
        ? distinct.join("\n")
        : names(distinct)
      : distinct.length === 1
        ? distinct[0]
        : null;
    return field(
      definition,
      value,
      matches.map((person) => person.id || matter.id),
      !manyAllowed && distinct.length > 1,
    );
  });
  // Keep genuinely distinct historical fields available under a single normalized
  // code; never expose the three old date aliases as separate choices.
  const keys = new Set(resolved.map((field) => field.key));
  const boundDates = resolved.filter((_field, index) => {
    const source = definitions[index].source;
    return source.kind === "checklist" && source.property === "date";
  });
  for (const [key, value] of oldByKey)
    if (!keys.has(key)) {
      const normalizedKey = key.replace(
        /[A-Z]/g,
        (letter) => `_${letter.toLowerCase()}`,
      );
      if (keys.has(normalizedKey)) continue;
      if (
        /_(?:date|deadline)$/.test(normalizedKey) &&
        value.sourceIds.length &&
        boundDates.some(
          (bound) =>
            bound.sourceIds.length === value.sourceIds.length &&
            bound.sourceIds.every((id) => value.sourceIds.includes(id)),
        )
      )
        continue;
      resolved.push({
        ...value,
        key: normalizedKey,
        value: /(?:date|deadline)$/.test(normalizedKey)
          ? formatEmailDate(value.value) || null
          : value.value,
      });
      keys.add(normalizedKey);
    }
  if (
    fileReviewPending(matter) ||
    (Array.isArray(details.sourceConflicts) && details.sourceConflicts.length)
  )
    return resolved.map((field) => ({
      ...field,
      value: null,
      status: "ambiguous",
    }));
  return resolved;
}
