import { type Principal, HttpError } from "@weatherly/platform";
import { deadlineInput } from "../validation/children";
import { prisma, type Prisma } from "@weatherly/db";
import { requireMatter, audit } from "../access";
import { recalculateWorkflow } from "../rules";
import { matterChanged } from "../change-hook";
import { projectDeadlineFields } from "../projections/deadline-fields";
import { updateChild } from "./update-child";

export async function addDeadline(
  actor: Principal,
  matterId: string,
  input: unknown,
) {
  const { visibility, details, ...data } = deadlineInput.parse(input);
  return prisma.$transaction(async (tx) => {
    const matter = await requireMatter(actor, matterId, true, tx);
    if (matter.checklistVersion !== null)
      throw new HttpError(409, "DATE_PREVIEW_REQUIRED", "Change due dates on the checklist.");
    if (
      data.sourceDocumentId &&
      !(await tx.document.findFirst({
        where: { id: data.sourceDocumentId, matterId },
      }))
    )
      throw new HttpError(
        422,
        "INVALID_SOURCE",
        "Document must belong to this matter",
      );
    const row = await tx.deadline.create({
      data: {
        ...data,
        matterId,
        details: {
          ...details,
          visibility: visibility ?? details.visibility ?? "coordinator",
        } as Prisma.InputJsonValue,
      },
    });
    await audit(tx, actor, "deadline.created", "Deadline", row.id, matterId, {
      value: {
        ...data,
        visibility: visibility ?? details.visibility ?? "coordinator",
      } as Prisma.InputJsonValue,
    });
    await tx.matter.update({
      where: { id: matterId },
      data: { revision: { increment: 1 } },
    });
    await recalculateWorkflow(tx, actor, matterId);
    await matterChanged(tx, actor, matterId);
    return projectDeadlineFields(
      row,
      await tx.task.findMany({ where: { matterId } }),
      matter.details,
    );
  });
}

export const updateDeadline = (
  actor: Principal,
  matterId: string,
  id: string,
  input: unknown,
) => updateChild(actor, matterId, id, "deadline", input);

export const deleteDeadline = (
  actor: Principal,
  matterId: string,
  id: string,
  input: unknown,
) => updateChild(actor, matterId, id, "deadline", input, true);
