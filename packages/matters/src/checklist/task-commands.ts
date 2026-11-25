import { randomUUID } from "node:crypto";
import { Prisma } from "@weatherly/db";
import { HttpError, type Principal } from "@weatherly/platform";
import { z } from "zod";
import { audit } from "../access";
import { matterChanged } from "../change-hook";
import { projectTaskFields } from "../projections/task-fields";
import { dateOnly, revision } from "../validation/common";
import {
  taskAppointment,
  taskNote,
  taskVisibility,
} from "../validation/task-fields";
import { recalculateChecklistStatus } from "./date-commands";
import { readChecklistSnapshot, requireEditableChecklist } from "./persistence";

type Matter = Prisma.MatterGetPayload<object>;

const createInput = z
  .object({
    title: z.string().trim().min(1).max(300),
    visibility: taskVisibility.default("client"),
    dateCapable: z.boolean().default(true),
    dueDate: dateOnly.nullable().optional(),
  })
  .strict()
  .refine(
    (data) => data.dateCapable || !data.dueDate,
    "This step does not take a due date.",
  );

const updateInput = z
  .object({
    expectedRevision: revision,
    title: z.string().trim().min(1).max(300).optional(),
    visibility: taskVisibility.optional(),
    status: z.enum(["pending", "completed", "not_applicable"]).optional(),
    note: taskNote.optional(),
    showNoteToAgent: z.boolean().optional(),
    appointmentAt: taskAppointment.optional(),
    appointmentPlace: z.string().trim().max(300).optional(),
    dateWording: z.string().trim().max(300).optional(),
    amountCents: z.number().int().min(0).max(10000000000).nullable().optional(),
    holder: z.string().trim().max(300).optional(),
    company: z.string().trim().max(300).optional(),
  })
  .strict();

export async function addVersionedChecklistTask(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matter: Matter,
  input: unknown,
) {
  requireEditableChecklist(matter);
  const data = createInput.parse(input);
  const last = await tx.task.aggregate({
    where: { matterId: matter.id, stepKey: { not: null } },
    _max: { position: true },
  });
  const row = await tx.task.create({
    data: {
      ...data,
      matterId: matter.id,
      kind: "custom",
      position: (last._max.position ?? -1) + 1,
      stepKey: `custom_${randomUUID().replaceAll("-", "")}`,
      dateRule: data.dueDate ? { kind: "fixed" } : Prisma.DbNull,
      details: { scheduled: false, showNoteToAgent: false },
    },
  });
  await audit(tx, actor, "task.created", "Task", row.id, matter.id);
  await finishTaskChange(tx, actor, matter.id);
  return projectTaskFields(row);
}

function hasOwn(input: unknown, key: string) {
  return !!input && typeof input === "object" && Object.hasOwn(input, key);
}

async function finishTaskChange(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
) {
  await tx.matter.update({
    where: { id: matterId },
    data: { revision: { increment: 1 } },
  });
  await matterChanged(tx, actor, matterId);
}

export async function updateVersionedChecklistTask(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matter: Matter,
  id: string,
  input: unknown,
  remove: boolean,
) {
  requireEditableChecklist(matter);
  if (
    ["dueDate", "dueAt", "actualDate", "actualAt", "dateRule"].some((key) =>
      hasOwn(input, key),
    )
  )
    throw new HttpError(
      409,
      "DATE_PREVIEW_REQUIRED",
      "Preview changes to checklist dates before saving.",
    );
  const {
    expectedRevision,
    note,
    showNoteToAgent,
    appointmentAt,
    appointmentPlace,
    dateWording,
    amountCents,
    holder,
    company,
    ...patch
  } = updateInput.parse(input);
  const old = await tx.task.findFirst({
    where: { id, matterId: matter.id, stepKey: { not: null } },
  });
  if (!old || !old.stepKey)
    throw new HttpError(404, "NOT_FOUND", "Checklist step not found.");
  if (old.revision !== expectedRevision)
    throw new HttpError(
      409,
      "REVISION_CONFLICT",
      "The checklist step changed. Refresh and try again.",
    );

  const isEmd = old.stepKey === "earnest_money_due";
  const isWarranty = ["home_warranty", "home_warranty_ordered"].includes(
    old.stepKey,
  );
  if (
    (amountCents !== undefined && !isEmd && !isWarranty) ||
    (holder !== undefined && !isEmd) ||
    (company !== undefined && !isWarranty)
  )
    throw new HttpError(
      422,
      "STEP_DETAIL_NOT_AVAILABLE",
      "Amount and company details are available on the earnest money and home warranty steps.",
    );
  if (dateWording !== undefined && !old.dateCapable)
    throw new HttpError(
      422,
      "STEP_DATE_NOT_AVAILABLE",
      "This step does not have a due date.",
    );

  if (remove) {
    if (old.kind !== "custom")
      throw new HttpError(
        409,
        "CHECKLIST_STEP_REQUIRED",
        "Mark this checklist step not needed instead.",
      );
    const { snapshot } = await readChecklistSnapshot(tx, matter);
    const referenced = snapshot.nodes.some((node) => {
      if (!node.rule || node.rule.kind === "fixed") return false;
      const offsets =
        node.rule.kind === "relative" ? [node.rule.offset] : node.rule.offsets;
      return offsets.some(
        ({ anchor }) =>
          anchor.kind !== "acceptance" && anchor.key === old.stepKey,
      );
    });
    if (referenced)
      throw new HttpError(
        409,
        "CHECKLIST_STEP_IN_USE",
        "A date rule uses this step. Update the linked date first.",
      );
    await tx.task.delete({ where: { id } });
    await audit(tx, actor, "task.deleted", "Task", id, matter.id, {
      before: JSON.parse(JSON.stringify(old)),
    });
    await finishTaskChange(tx, actor, matter.id);
    return { deleted: true };
  }

  const details =
    old.details &&
    typeof old.details === "object" &&
    !Array.isArray(old.details)
      ? old.details
      : {};
  if (
    (appointmentAt !== undefined || appointmentPlace !== undefined) &&
    details.scheduled !== true
  )
    throw new HttpError(
      422,
      "APPOINTMENT_NOT_AVAILABLE",
      "This step has no scheduled appointment.",
    );

  await tx.task.update({
    where: { id },
    data: {
      ...patch,
      details: {
        ...details,
        ...(note !== undefined ? { note } : {}),
        ...(showNoteToAgent !== undefined ? { showNoteToAgent } : {}),
        ...(appointmentAt !== undefined ? { appointmentAt } : {}),
        ...(appointmentPlace !== undefined ? { appointmentPlace } : {}),
        ...(dateWording !== undefined ? { dateWording } : {}),
        ...(amountCents !== undefined ? { amountCents } : {}),
        ...(holder !== undefined ? { holder } : {}),
        ...(company !== undefined ? { company } : {}),
      },
      revision: { increment: 1 },
    },
  });
  if (patch.status && patch.status !== old.status)
    await recalculateChecklistStatus(tx, matter, old.stepKey);
  await audit(tx, actor, "task.updated", "Task", id, matter.id, {
    before: JSON.parse(JSON.stringify(old)),
    changes: {
      ...patch,
      ...(note !== undefined ? { note } : {}),
      ...(showNoteToAgent !== undefined ? { showNoteToAgent } : {}),
      ...(appointmentAt !== undefined ? { appointmentAt } : {}),
      ...(appointmentPlace !== undefined ? { appointmentPlace } : {}),
      ...(dateWording !== undefined ? { dateWording } : {}),
      ...(amountCents !== undefined ? { amountCents } : {}),
      ...(holder !== undefined ? { holder } : {}),
      ...(company !== undefined ? { company } : {}),
    },
  });
  await finishTaskChange(tx, actor, matter.id);
  return projectTaskFields(await tx.task.findUniqueOrThrow({ where: { id } }));
}
