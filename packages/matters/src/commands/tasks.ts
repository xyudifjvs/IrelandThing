import { type Principal, assertCoordinator, HttpError } from "@weatherly/platform";
import { taskInput } from "../validation/children";
import { prisma, type Prisma } from "@weatherly/db";
import { requireMatter, audit } from "../access";
import { matterChanged } from "../change-hook";
import { projectTaskFields } from "../projections/task-fields";
import { z } from "zod";
import { revision } from "../validation/common";
import { updateChild } from "./update-child";
import { addVersionedChecklistTask } from "../checklist/task-commands";
import { requireEditableChecklist } from "../checklist/persistence";

export async function addTask(
  actor: Principal,
  matterId: string,
  input: unknown,
) {
  assertCoordinator(actor);
  return prisma.$transaction(async (tx) => {
    const matter = await requireMatter(actor, matterId, true, tx);
    if (matter.checklistVersion !== null)
      return addVersionedChecklistTask(tx, actor, matter, input);
    const { note, appointmentAt, ...data } = taskInput.parse(input);
    const last = await tx.task.aggregate({
      where: { matterId },
      _max: { position: true },
    });
    const row = await tx.task.create({
      data: {
        ...data,
        matterId,
        position: (last._max.position ?? -1) + 1,
        details: {
          ...data.details,
          ...(note !== undefined ? { note } : {}),
          ...(appointmentAt !== undefined ? { appointmentAt } : {}),
        } as Prisma.InputJsonValue,
      },
    });
    await audit(tx, actor, "task.created", "Task", row.id, matterId);
    await tx.matter.update({
      where: { id: matterId },
      data: { revision: { increment: 1 } },
    });
    await matterChanged(tx, actor, matterId);
    return projectTaskFields(row);
  });
}

/** Reorder the complete canonical task set without overwriting a concurrent edit. */
export async function reorderTasks(
  actor: Principal,
  matterId: string,
  input: unknown,
) {
  assertCoordinator(actor);
  const data = z
    .object({
      expectedRevision: revision,
      taskIds: z.array(z.string().min(1)).max(10000),
    })
    .strict()
    .parse(input);
  return prisma.$transaction(async (tx) => {
    const matter = await requireMatter(actor, matterId, true, tx);
    if (matter.checklistVersion !== null) requireEditableChecklist(matter);
    const tasks = await tx.task.findMany({
      where: { matterId, ...(matter.checklistVersion !== null ? { stepKey: { not: null } } : {}) },
    });
    const ids = new Set(data.taskIds);
    if (
      ids.size !== data.taskIds.length ||
      ids.size !== tasks.length ||
      tasks.some((task) => !ids.has(task.id))
    )
      throw new HttpError(
        422,
        "INVALID_TASK_ORDER",
        "Include every task from this matter exactly once.",
      );
    const claimed = await tx.matter.updateMany({
      where: { id: matterId, revision: data.expectedRevision },
      data: { revision: { increment: 1 } },
    });
    if (!claimed.count)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "This matter changed; refresh before reordering.",
      );
    const byId = new Map(tasks.map((task) => [task.id, task]));
    for (const [position, id] of data.taskIds.entries()) {
      if (byId.get(id)!.position !== position)
        await tx.task.update({
          where: { id },
          data: { position, revision: { increment: 1 } },
        });
    }
    await audit(tx, actor, "task.reordered", "Matter", matterId, matterId, {
      taskIds: data.taskIds,
      beforeRevision: data.expectedRevision,
    });
    await matterChanged(tx, actor, matterId);
    return tx.matter.findUniqueOrThrow({
      where: { id: matterId },
      select: { id: true, revision: true },
    });
  });
}

export const updateTask = (
  actor: Principal,
  matterId: string,
  id: string,
  input: unknown,
) => updateChild(actor, matterId, id, "task", input);

export const deleteTask = (
  actor: Principal,
  matterId: string,
  id: string,
  input: unknown,
) => updateChild(actor, matterId, id, "task", input, true);
