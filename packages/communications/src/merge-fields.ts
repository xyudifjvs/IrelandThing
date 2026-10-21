import { prisma, Prisma } from "@weatherly/db";
import { type Principal } from "@weatherly/platform";
import { requireMatter } from "@weatherly/matters";
import { asRecord } from "./policy";
export interface MergeField {
  key: string;
  label: string;
  value: string | null;
  status: "confirmed" | "unknown" | "ambiguous";
  sourceIds: string[];
}
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
const aliases: Record<string, string[]> = {
  closingDate: ["closing", "closing_date"],
  possessionDate: ["possession", "possession_date_and_time"],
  inspectionDate: ["inspection", "inspections", "inspection_deadline"],
  earnestMoneyDate: ["earnest_money", "earnest_money_emd", "emd"],
  hoaDate: ["hoa", "condo_hoa_docs_provided", "condo_hoa_docs_reviewed"],
  titleDate: ["title", "title_commitment"],
  appraisalDate: ["appraisal", "appraisal_completed"],
  loanCommitmentDate: ["loan_commitment", "financing_commitment"],
};
export async function mergeFields(
  actor: Principal,
  matterId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const matter = await requireMatter(actor, matterId, false, db);
  const deadlines = await db.deadline.findMany({ where: { matterId } });
  const tasks = await db.task.findMany({ where: { matterId } });
  const agent = matter.agentId
    ? await db.user.findUnique({ where: { id: matter.agentId } })
    : null;
  const details = asRecord(matter.details);
  const clients = Array.isArray(details.clients) ? details.clients : [];
  const fields: MergeField[] = [
    {
      key: "propertyAddress",
      label: "Property address",
      value: matter.propertyAddress,
      status: "confirmed",
      sourceIds: [matter.id],
    },
    {
      key: "agentName",
      label: "Agent name",
      value: agent?.name || null,
      status: agent ? "confirmed" : "unknown",
      sourceIds: agent ? [agent.id] : [],
    },
    {
      key: "agentEmail",
      label: "Agent email",
      value: agent?.email || null,
      status: agent ? "confirmed" : "unknown",
      sourceIds: agent ? [agent.id] : [],
    },
    {
      key: "clientNames",
      label: "Client names",
      value:
        clients
          .map((c) => asRecord(c).name)
          .filter((v) => typeof v === "string")
          .join(", ") || null,
      status: clients.length ? "confirmed" : "unknown",
      sourceIds: [matter.id],
    },
    {
      key: "packageName",
      label: "Service package",
      value: matter.packageCode,
      status: "confirmed",
      sourceIds: [matter.id],
    },
    {
      key: "coordinatorName",
      label: "Coordinator name",
      value: actor.name,
      status: "confirmed",
      sourceIds: [actor.id],
    },
    {
      key: "recipientName",
      label: "Recipient name (provide at render)",
      value: null,
      status: "unknown",
      sourceIds: [],
    },
  ];
  const add = (key: string, label: string, candidates: typeof deadlines) => {
    if (fields.some((f) => f.key === key)) return;
    const dates = [
      ...new Set(
        candidates
          .filter((d) => d.status === "confirmed" && d.date)
          .map((d) => d.date!),
      ),
    ];
    fields.push({
      key,
      label,
      value: dates.length === 1 ? dates[0] : null,
      status:
        dates.length > 1
          ? "ambiguous"
          : dates.length === 1
            ? "confirmed"
            : "unknown",
      sourceIds: candidates.map((d) => d.id),
    });
  };
  for (const [key, labels] of Object.entries(aliases))
    add(
      key,
      key,
      deadlines.filter((d) => labels.includes(normalize(d.label))),
    );
  for (const d of deadlines)
    add(
      `deadline_${normalize(d.label)}`,
      d.label,
      deadlines.filter((v) => normalize(v.label) === normalize(d.label)),
    );
  for (const task of tasks) {
    const key = `task_${normalize(task.title)}`;
    if (fields.some((f) => f.key === key)) continue;
    const matching = tasks.filter(
      (t) => normalize(t.title) === normalize(task.title),
    );
    const dates = [
      ...new Set(
        matching.map((t) => t.dueDate).filter((v): v is string => !!v),
      ),
    ];
    fields.push({
      key,
      label: task.title,
      value: dates.length === 1 ? dates[0] : null,
      status:
        dates.length > 1
          ? "ambiguous"
          : dates.length === 1
            ? "confirmed"
            : "unknown",
      sourceIds: matching.map((t) => t.id),
    });
  }
  const definition = asRecord(asRecord(details.workflow).definition);
  for (const raw of Array.isArray(definition.steps) ? definition.steps : []) {
    const step = asRecord(raw);
    if (typeof step.key !== "string" || typeof step.title !== "string")
      continue;
    const key = `date_${normalize(step.key)}`;
    const candidates = deadlines.filter(
      (d) =>
        asRecord(d.details).workflowKey === step.key || d.label === step.title,
    );
    add(key, step.title, candidates);
    if (!candidates.length) {
      const matching = tasks.filter(
        (t) => asRecord(t.details).workflowKey === step.key && t.dueDate,
      );
      const dates = [...new Set(matching.map((t) => t.dueDate!))];
      const f = fields.find((f) => f.key === key)!;
      if (dates.length === 1) {
        f.value = dates[0];
        f.status = "confirmed";
        f.sourceIds = matching.map((t) => t.id);
      } else if (dates.length > 1) f.status = "ambiguous";
    }
  }
  return fields;
}
