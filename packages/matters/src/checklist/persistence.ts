import { Prisma } from "@weatherly/db";
import { HttpError } from "@weatherly/platform";
import {
  checklistDateRuleSchema,
  dateValueSchema,
  stepKeySchema,
  type DateValue,
} from "@weatherly/platform/handoff-contracts";
import { z } from "zod";
import { sameDateValue } from "../date-graph/calendar";
import type {
  ChecklistDateGraph,
  ChecklistDateNode,
  ChecklistDateSnapshot,
} from "../date-graph/types";
import { translateChecklistDateError } from "./errors";
import { buildChecklistSeed, type ChecklistSeed } from "./seed";
import { checklistVersion } from "./templates";

type Matter = Prisma.MatterGetPayload<object>;
type Task = Prisma.TaskGetPayload<object>;

const hiddenAnchorsField = "checklistDateAnchors";
const hiddenAnchorsSchema = z
  .array(
    z
      .object({
        key: stepKeySchema,
        dateCapable: z.literal(true),
        status: z.enum(["open", "completed", "not_needed"]),
        due: dateValueSchema.nullable(),
        actual: dateValueSchema.nullable(),
        rule: checklistDateRuleSchema.nullable(),
      })
      .strict(),
  )
  .max(20);

function detailsObject(details: Prisma.JsonValue): Prisma.JsonObject {
  return details && typeof details === "object" && !Array.isArray(details)
    ? details
    : {};
}

function storedDate(date: string | null, exact: Date | null): DateValue | null {
  return date ? { date, instant: exact?.toISOString() ?? null } : null;
}

function dateFields(value: DateValue | null) {
  return {
    dueDate: value?.date ?? null,
    dueAt: value?.instant ? new Date(value.instant) : null,
  };
}

function taskStatus(status: string): ChecklistDateNode["status"] {
  if (status === "not_applicable") return "not_needed";
  return status === "completed" || status === "signed" ? "completed" : "open";
}

function invalidChecklist() {
  return new HttpError(
    409,
    "CHECKLIST_DATA_INVALID",
    "This checklist contains an invalid saved date rule.",
  );
}

export function requireVersionedChecklist(matter: Matter) {
  if (matter.checklistVersion !== checklistVersion)
    throw new HttpError(
      409,
      "CHECKLIST_VERSION",
      "This file uses its original checklist date controls.",
    );
}

export function requireEditableChecklist(matter: Matter) {
  requireVersionedChecklist(matter);
  if (["closed", "terminated", "archived"].includes(matter.stage))
    throw new HttpError(
      409,
      "CHECKLIST_READ_ONLY",
      "Reopen this file before editing its checklist.",
    );
}

export async function seedMatterChecklist(
  tx: Prisma.TransactionClient,
  matterId: string,
  input: ChecklistSeed,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Matter" WHERE "id" = ${matterId} FOR UPDATE`;
  const matter = await tx.matter.findUniqueOrThrow({ where: { id: matterId } });
  if (
    matter.checklistVersion !== null ||
    (await tx.task.findFirst({
      where: { matterId, stepKey: { not: null } },
      select: { id: true },
    }))
  )
    throw new HttpError(
      409,
      "CHECKLIST_ALREADY_EXISTS",
      "This file already has checklist steps.",
    );

  const { steps, hiddenAnchors } = translateChecklistDateError(() =>
    buildChecklistSeed(input),
  );
  await tx.task.createMany({
    data: steps.map((step, position) => ({
      matterId,
      title: step.title,
      kind: "checklist",
      status: step.notNeeded ? "not_applicable" : "pending",
      visibility: "client",
      position,
      stepKey: step.key,
      dateCapable: step.dateCapable,
      ...dateFields(step.due),
      dateRule: step.rule ?? Prisma.DbNull,
      details: { scheduled: step.scheduled, showNoteToAgent: false },
    })),
  });
  await tx.matter.update({
    where: { id: matterId },
    data: {
      checklistVersion,
      acceptanceDate: input.acceptance?.date ?? null,
      acceptanceAt: input.acceptance?.instant
        ? new Date(input.acceptance.instant)
        : null,
      deadlineTimeZone: input.timeZone,
      details: {
        ...detailsObject(matter.details),
        [hiddenAnchorsField]: hiddenAnchors,
      },
    },
  });
}

export async function readChecklistSnapshot(
  tx: Prisma.TransactionClient,
  matter: Matter,
) {
  requireVersionedChecklist(matter);
  const tasks = await tx.task.findMany({
    where: { matterId: matter.id, stepKey: { not: null } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const tasksByKey = new Map<string, Task>();
  const nodes = tasks.map((task): ChecklistDateNode => {
    const rule = checklistDateRuleSchema.nullable().safeParse(task.dateRule);
    if (!rule.success || !task.stepKey || task.dateCapable === null)
      throw invalidChecklist();
    tasksByKey.set(task.stepKey, task);
    return {
      key: task.stepKey,
      status: taskStatus(task.status),
      dateCapable: task.dateCapable,
      due: storedDate(task.dueDate, task.dueAt),
      actual: storedDate(task.actualDate, task.actualAt),
      rule: rule.data,
    };
  });
  const hidden = hiddenAnchorsSchema.safeParse(
    detailsObject(matter.details)[hiddenAnchorsField] ?? [],
  );
  if (!hidden.success) throw invalidChecklist();
  const snapshot: ChecklistDateSnapshot = {
    matterId: matter.id,
    revision: matter.revision,
    timeZone: matter.deadlineTimeZone,
    acceptance: storedDate(matter.acceptanceDate, matter.acceptanceAt),
    nodes: [...nodes, ...hidden.data],
  };
  return { matter, snapshot, tasksByKey };
}

type StoredChecklist = Awaited<ReturnType<typeof readChecklistSnapshot>>;

export async function persistChecklistNodes(
  tx: Prisma.TransactionClient,
  stored: StoredChecklist,
  graph: ChecklistDateGraph,
) {
  const previous = new Map(
    stored.snapshot.nodes.map((node) => [node.key, node]),
  );
  let hiddenChanged = false;
  for (const node of graph.nodes) {
    const before = previous.get(node.key);
    if (!before) throw invalidChecklist();
    const changed =
      node.rule !== before.rule ||
      node.status !== before.status ||
      !sameDateValue(node.due, before.due) ||
      !sameDateValue(node.actual, before.actual);
    if (!changed) continue;
    const task = stored.tasksByKey.get(node.key);
    if (!task) {
      hiddenChanged = true;
      continue;
    }
    await tx.task.update({
      where: { id: task.id },
      data: {
        ...dateFields(node.due),
        actualDate: node.actual?.date ?? null,
        actualAt: node.actual?.instant ? new Date(node.actual.instant) : null,
        dateRule: node.rule ?? Prisma.DbNull,
        ...(node.status !== before.status && node.status === "completed"
          ? { status: "completed" }
          : {}),
        revision: { increment: 1 },
      },
    });
  }
  if (!hiddenChanged) return undefined;
  return {
    ...detailsObject(stored.matter.details),
    [hiddenAnchorsField]: graph.nodes.filter(
      (node) => !stored.tasksByKey.has(node.key),
    ),
  };
}
