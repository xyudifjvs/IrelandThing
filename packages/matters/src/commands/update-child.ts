import { type Principal, assertCoordinator, HttpError } from "@weatherly/platform";
import { z } from "zod";
import { taskVisibility, taskNote, taskAppointment, taskDetails } from "../validation/task-fields";
import { dateOnly, revision } from "../validation/common";
import { deadlineDetails } from "../validation/deadline-fields";
import { prisma, type Prisma } from "@weatherly/db";
import { requireMatter, audit } from "../access";
import { recalculateWorkflow } from "../rules";
import { matterChanged } from "../change-hook";
import { resolveDateFollowup } from "./date-followup";
import { projectDeadlineFields } from "../projections/deadline-fields";
import { projectTaskFields } from "../projections/task-fields";

export async function updateChild(
  actor: Principal,
  matterId: string,
  id: string,
  kind: "task" | "deadline" | "note",
  input: unknown,
  remove = false,
) {
  assertCoordinator(actor);
  const schema =
    kind === "task"
      ? z
          .object({
            title: z.string().trim().min(1).max(300).optional(),
            kind: z.string().max(80).optional(),
            status: z
              .enum([
                "pending",
                "received",
                "proposed",
                "completed",
                "signed",
                "not_applicable",
              ])
              .optional(),
            visibility: taskVisibility.optional(),
            dueDate: dateOnly.nullable().optional(),
            note: taskNote.optional(),
            appointmentAt: taskAppointment.optional(),
            position: z.number().int().min(0).max(1000000).optional(),
            details: taskDetails.optional(),
          })
          .strict()
      : kind === "deadline"
        ? z
            .object({
              label: z.string().trim().min(1).max(200).optional(),
              date: dateOnly.nullable().optional(),
              status: z
                .enum(["unknown", "proposed", "confirmed", "rejected"])
                .optional(),
              sourceDocumentId: z.string().nullable().optional(),
              visibility: taskVisibility.optional(),
              details: deadlineDetails.optional(),
            })
            .strict()
        : z
            .object({
              body: z.string().trim().min(1).max(30000).optional(),
              visibility: z.enum(["coordinator", "agent", "client"]).optional(),
            })
            .strict();
  const { expectedRevision, ...data } = schema
    .extend({ expectedRevision: revision })
    .parse(input);
  return prisma.$transaction(async (tx) => {
    await requireMatter(actor, matterId, true, tx);
    if (
      kind === "deadline" &&
      "sourceDocumentId" in data &&
      data.sourceDocumentId &&
      !(await tx.document.findFirst({
        where: { id: String(data.sourceDocumentId), matterId },
      }))
    )
      throw new HttpError(
        422,
        "INVALID_SOURCE",
        "Document must belong to this matter",
      );
    // Preserve full prior values in audit before a deadline correction or deletion.
    const delegate = tx[kind] as typeof tx.task;
    const old = await delegate.findFirst({ where: { id, matterId } });
    if (!old) throw new HttpError(404, "NOT_FOUND", "Record not found");
    if (remove) {
      const changed = await delegate.deleteMany({
        where: { id, matterId, revision: expectedRevision },
      });
      if (!changed.count)
        throw new HttpError(
          409,
          "REVISION_CONFLICT",
          "Record changed; refresh",
        );
      await audit(tx, actor, `${kind}.deleted`, kind, id, matterId, {
        before: JSON.parse(JSON.stringify(old)),
      });
      if (kind === "deadline" || kind === "task") {
        await tx.matter.update({
          where: { id: matterId },
          data: { revision: { increment: 1 } },
        });
        if (kind === "deadline") await recalculateWorkflow(tx, actor, matterId);
        await matterChanged(tx, actor, matterId);
      }
      return { deleted: true };
    }
    const patch: Record<string, unknown> = { ...data };
    if (kind === "task" && ("note" in data || "appointmentAt" in data)) {
      const previous =
        old.details &&
        typeof old.details === "object" &&
        !Array.isArray(old.details)
          ? old.details
          : {};
      patch.details = {
        ...previous,
        ...("details" in data ? data.details : {}),
        ...("note" in data ? { note: data.note } : {}),
        ...("appointmentAt" in data
          ? { appointmentAt: data.appointmentAt }
          : {}),
      };
      delete patch.note;
      delete patch.appointmentAt;
    }
    if (kind === "task" && "position" in data) {
      if (old.revision !== expectedRevision)
        throw new HttpError(
          409,
          "REVISION_CONFLICT",
          "Record changed; refresh",
        );
      const tasks = await tx.task.findMany({
        where: { matterId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      });
      const ordered = tasks.filter((task) => task.id !== id);
      ordered.splice(Math.min(Number(data.position), ordered.length), 0, old);
      for (const [position, task] of ordered.entries()) {
        if (task.id === id) patch.position = position;
        else if (task.position !== position)
          await tx.task.update({
            where: { id: task.id },
            data: { position, revision: { increment: 1 } },
          });
      }
    }
    if (
      kind === "deadline" &&
      ("date" in data || "visibility" in data || "details" in data)
    ) {
      patch.details = {
        ...(old.details &&
        typeof old.details === "object" &&
        !Array.isArray(old.details)
          ? old.details
          : {}),
        ...("details" in data ? data.details : {}),
        ...("visibility" in data ? { visibility: data.visibility } : {}),
        ...("date" in data ? { manualOverride: true } : {}),
      };
      delete patch.visibility;
    }
    if (kind === "task" && "dueDate" in data)
      patch.details = {
        ...(old.details as Record<string, Prisma.InputJsonValue>),
        ...((patch.details as Record<string, Prisma.InputJsonValue>) || {}),
        manualOverride: true,
      };
    const changed = await delegate.updateMany({
      where: { id, matterId, revision: expectedRevision },
      data: {
        ...patch,
        revision: { increment: 1 },
      } as Prisma.TaskUpdateManyMutationInput,
    });
    if (!changed.count)
      throw new HttpError(409, "REVISION_CONFLICT", "Record changed; refresh");
    await audit(tx, actor, `${kind}.updated`, kind, id, matterId, {
      before: JSON.parse(JSON.stringify(old)),
      changes: data as Prisma.InputJsonValue,
    });
    if (kind === "deadline" || kind === "task") {
      await tx.matter.update({
        where: { id: matterId },
        data: { revision: { increment: 1 } },
      });
      if (kind === "deadline") {
        await recalculateWorkflow(tx, actor, matterId);
        await resolveDateFollowup(tx, actor, matterId, id);
      }
      await matterChanged(tx, actor, matterId);
    }
    const updated = await delegate.findUniqueOrThrow({ where: { id } });
    if (kind === "deadline")
      return projectDeadlineFields(
        await tx.deadline.findUniqueOrThrow({ where: { id } }),
        await tx.task.findMany({ where: { matterId } }),
        (await tx.matter.findUniqueOrThrow({ where: { id: matterId } }))
          .details,
      );
    return kind === "task" ? projectTaskFields(updated) : updated;
  });
}
