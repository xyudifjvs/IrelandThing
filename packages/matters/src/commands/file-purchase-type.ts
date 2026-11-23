import type { Prisma } from "@weatherly/db";
import { HttpError, type Principal } from "@weatherly/platform";
import { audit } from "../access";
import { recalculateChecklistStatus } from "../checklist/date-commands";
import { checklistTemplate, type PurchaseType } from "../checklist/templates";
import { json } from "../validation/common";

/** A type change adjusts the existing checklist; it never reseeds the file. */
export async function adjustFilePurchaseType(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matter: Prisma.MatterGetPayload<object>,
  purchaseType: PurchaseType,
) {
  if (matter.checklistVersion !== 1)
    throw new HttpError(
      409,
      "CHECKLIST_VERSION",
      "This file uses its original checklist. Its purchase type cannot be changed here.",
    );
  const steps = await tx.task.findMany({
    where: {
      matterId: matter.id,
      stepKey: {
        in: ["preapproval_pof", "loan_application", "loan_commitment"],
      },
    },
  });
  const changedStatuses: string[] = [];
  const fundsTitle = checklistTemplate("buyer", purchaseType).find(
    (step) => step.key === "preapproval_pof",
  )!.title;
  for (const step of steps) {
    let status = step.status;
    let title = step.title;
    const details = json.safeParse(step.details).data ?? {};
    if (step.stepKey === "preapproval_pof") {
      if (
        [
          "Pre-Approval",
          "Proof of Funds",
          "Pre-Approval / Proof of Funds",
        ].includes(title)
      )
        title = fundsTitle;
    } else if (purchaseType === "cash") {
      details.purchaseTypeStatusBeforeCash = status;
      status = "not_applicable";
    } else {
      if (status === "not_applicable") {
        const previous = details.purchaseTypeStatusBeforeCash;
        status =
          typeof previous === "string" &&
          ["pending", "completed", "signed", "not_applicable"].includes(
            previous,
          )
            ? previous
            : "pending";
      }
      delete details.purchaseTypeStatusBeforeCash;
    }
    if (
      status === step.status &&
      title === step.title &&
      JSON.stringify(details) === JSON.stringify(step.details)
    )
      continue;
    await tx.task.update({
      where: { id: step.id },
      data: { status, title, details, revision: { increment: 1 } },
    });
    if (status !== step.status) changedStatuses.push(step.stepKey!);
    await audit(tx, actor, "task.updated", "Task", step.id, matter.id, {
      reason: "purchase_type_changed",
      before: JSON.parse(JSON.stringify(step)),
      changes: { status, title },
    });
  }
  for (const key of changedStatuses) {
    const current = await tx.matter.findUniqueOrThrow({
      where: { id: matter.id },
    });
    await recalculateChecklistStatus(tx, current, key);
  }
}
