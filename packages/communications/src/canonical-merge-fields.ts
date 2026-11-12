import type { Prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import { contactRoleFamily } from "../../contacts/src/transaction-sources";
import type { MergeField } from "./merge-fields";
import { asRecord } from "./policy";

const dateAliases = {
  closingDate: "closing",
  possessionDate: "possession",
  inspectionDate: "inspections",
  earnestMoneyDate: "earnest_money_due",
  hoaDate: "condo_hoa_docs_provided",
  titleDate: "title_commitment",
  appraisalDate: "appraisal",
  loanCommitmentDate: "loan_commitment",
};

function field(
  key: string,
  label: string,
  candidates: readonly { id: string; value: string | null | undefined }[],
): MergeField {
  const values = [
    ...new Set(candidates.map(({ value }) => value?.trim()).filter(Boolean)),
  ];
  return {
    key,
    label,
    value: values.length === 1 ? values[0]! : null,
    status:
      values.length > 1
        ? "ambiguous"
        : values.length === 1
          ? "confirmed"
          : "unknown",
    sourceIds: candidates
      .filter(({ value }) => value?.trim())
      .map(({ id }) => id),
  };
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
const dollars = new Intl.NumberFormat("en-US");
const packages: Record<string, string> = {
  essentials: "Contract to Close",
  complete: "Contract to Close + Compliance",
  hto_included: "Home Team Ohio",
};

function formatPrice(
  value: Prisma.MatterGetPayload<object>["purchasePriceCents"],
) {
  if (value === null) return null;
  const cents = BigInt(value.toFixed(0));
  return `$${dollars.format(cents / 100n)}.${String(cents % 100n).padStart(2, "0")}`;
}

export async function canonicalMergeFields(
  actor: Principal,
  matter: Prisma.MatterGetPayload<object>,
  db: Prisma.TransactionClient,
): Promise<MergeField[]> {
  const [tasks, people, agent] = await Promise.all([
    db.task.findMany({
      where: {
        matterId: matter.id,
        stepKey: { not: null },
        status: { not: "not_applicable" },
      },
      select: {
        id: true,
        stepKey: true,
        title: true,
        dueDate: true,
        details: true,
      },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    }),
    db.matterContact.findMany({
      where: { matterId: matter.id, retiredAt: null },
      select: {
        id: true,
        role: true,
        name: true,
        email: true,
        phone: true,
        company: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    matter.agentId
      ? db.user.findUnique({
          where: { id: matter.agentId },
          select: { id: true, name: true, email: true },
        })
      : null,
  ]);
  const row = (value: string | null | undefined) => [{ id: matter.id, value }];
  const clients = people.filter(({ role }) =>
    ["client", "buyer", "seller"].includes(role),
  );
  const assigned = people.filter(({ role }) =>
    ["agent", "my_agent"].includes(role),
  );
  const packageName = packages[matter.packageCode] ?? matter.packageCode;
  const fields = [
    field("propertyAddress", "Property address", row(matter.propertyAddress)),
    field(
      "purchasePrice",
      "Purchase price",
      row(formatPrice(matter.purchasePriceCents)),
    ),
    field("acceptanceDate", "Acceptance date", row(matter.acceptanceDate)),
    field(
      "clientNames",
      "Client names",
      row(clients.map(({ name }) => name).join(", ")),
    ),
    field(
      "agentName",
      "Agent name",
      assigned.length
        ? assigned.map(({ id, name }) => ({ id, value: name }))
        : agent
          ? [{ id: agent.id, value: agent.name }]
          : [],
    ),
    field(
      "agentEmail",
      "Agent email",
      assigned.length
        ? assigned.map(({ id, email }) => ({ id, value: email }))
        : agent
          ? [{ id: agent.id, value: agent.email }]
          : [],
    ),
    field("packageName", "Service package", row(packageName)),
    field("coordinatorName", "Coordinator name", [
      { id: actor.id, value: actor.name },
    ]),
    field("recipientName", "Recipient name", []),
  ];
  const dateField = (key: string, label: string, entries: typeof tasks) =>
    field(
      key,
      label,
      entries.map(({ id, dueDate }) => ({ id, value: dueDate })),
    );
  for (const [key, step] of Object.entries(dateAliases))
    fields.push(
      dateField(
        key,
        key,
        tasks.filter(({ stepKey }) => stepKey === step),
      ),
    );
  for (const task of tasks) {
    fields.push(dateField(`date_${task.stepKey}`, task.title, [task]));
    const key = normalize(task.title);
    if (fields.some((entry) => entry.key === `task_${key}`)) continue;
    const peers = tasks.filter(({ title }) => normalize(title) === key);
    fields.push(
      dateField(`task_${key}`, task.title, peers),
      dateField(`deadline_${key}`, task.title, peers),
    );
  }
  for (const [family, prefix] of [
    ["title", "title"],
    ["lender", "lender"],
    ["coop", "coOpAgent"],
  ] as const) {
    const matches = people.filter(
      ({ role }) => contactRoleFamily(role) === family,
    );
    for (const prop of ["name", "email", "phone", "company"] as const)
      fields.push(
        field(
          prefix + prop[0].toUpperCase() + prop.slice(1),
          `${prefix} ${prop}`,
          matches.map((person) => ({ id: person.id, value: person[prop] })),
        ),
      );
  }
  for (const [alias, key] of Object.entries({
    client_name: "clientNames",
    clientName: "clientNames",
    client_names: "clientNames",
    property_address: "propertyAddress",
    purchase_price: "purchasePrice",
    title_contact: "titleName",
    title_company: "titleCompany",
    title_email: "titleEmail",
    title_phone: "titlePhone",
    loan_officer: "lenderName",
    lender_company: "lenderCompany",
    lender_email: "lenderEmail",
    lender_phone: "lenderPhone",
    co_op_agent: "coOpAgentName",
    co_op_brokerage: "coOpAgentCompany",
    co_op_email: "coOpAgentEmail",
    co_op_phone: "coOpAgentPhone",
  })) {
    const original = fields.find((entry) => entry.key === key);
    if (original) fields.push({ ...original, key: alias });
  }
  const closing = tasks.find(({ stepKey }) => stepKey === "closing");
  const appointment = asRecord(closing?.details);
  if (closing && appointment.scheduled === true) {
    const value = (property: string) =>
      typeof appointment[property] === "string"
        ? String(appointment[property])
        : null;
    fields.push(
      field("closingAppointmentAt", "Closing appointment", [
        { id: closing.id, value: value("appointmentAt") },
      ]),
      field("closingAppointmentPlace", "Closing appointment place", [
        { id: closing.id, value: value("appointmentPlace") },
      ]),
    );
  }
  return fields;
}
