import { prisma, type Prisma } from "@weatherly/db";
import {
  civilDay,
  completedMilestoneStates,
  type MilestoneMatter,
} from "./milestones";
import { calendarStepKey } from "./calendar-labels";

/** Read the status-change audit, rather than a later edit's updatedAt timestamp. */
export async function calendarCompletionDays(
  matters: readonly MilestoneMatter[],
  db: Prisma.TransactionClient | typeof prisma,
) {
  const ids = matters.flatMap((matter) =>
    matter.tasks
      .filter(
        (task) =>
          calendarStepKey(task) === "appraisal_ordered" &&
          completedMilestoneStates.has(task.status),
      )
      .map((task) => task.id),
  );
  const result = new Map<string, string>();
  if (!ids.length) return result;
  const rows = await db.auditEvent.findMany({
    where: {
      matterId: { in: matters.map((matter) => matter.id) },
      entityId: { in: ids },
      action: "task.updated",
      OR: [
        { details: { path: ["changes", "status"], equals: "completed" } },
        { details: { path: ["changes", "status"], equals: "signed" } },
      ],
    },
    select: { entityId: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  for (const row of rows)
    if (!result.has(row.entityId))
      result.set(row.entityId, civilDay(row.createdAt));
  return result;
}
