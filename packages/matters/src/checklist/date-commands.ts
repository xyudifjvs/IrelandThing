import { prisma, type Prisma } from "@weatherly/db";
import { assertCoordinator, type Principal } from "@weatherly/platform";
import {
  checklistDateApplySchema,
  checklistDateEditSchema,
  type ChecklistDateEdit,
} from "@weatherly/platform/handoff-contracts";
import { audit, requireMatter } from "../access";
import { matterChanged } from "../change-hook";
import {
  applyChecklistDateEdit,
  previewChecklistDateEdit,
  type ChecklistDatePreview,
} from "../date-graph/preview";
import {
  affectedChecklistKeys,
  resolveChecklistDates,
} from "../date-graph/resolve";
import type { ChecklistDateSnapshot } from "../date-graph/types";
import { translateChecklistDateError } from "./errors";
import {
  persistChecklistNodes,
  readChecklistSnapshot,
  requireEditableChecklist,
} from "./persistence";

export const hoaDeliveryStep = "condo_hoa_docs_provided";

function withRecordedDelivery(
  snapshot: ChecklistDateSnapshot,
  change: ChecklistDateEdit["change"],
) {
  if (
    change.kind !== "set" ||
    change.target.kind !== "actual" ||
    change.target.key !== hoaDeliveryStep ||
    !change.value
  )
    return snapshot;
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) =>
      node.key === hoaDeliveryStep && node.status === "open"
        ? { ...node, status: "completed" as const }
        : node,
    ),
  };
}

export async function previewMatterChecklistDates(
  actor: Principal,
  matterId: string,
  input: unknown,
  transaction?: Prisma.TransactionClient,
): Promise<ChecklistDatePreview> {
  assertCoordinator(actor);
  const edit = checklistDateEditSchema.parse(input);
  const preview = async (tx: Prisma.TransactionClient) => {
    const matter = await requireMatter(actor, matterId, true, tx);
    requireEditableChecklist(matter);
    const { snapshot } = await readChecklistSnapshot(tx, matter);
    return translateChecklistDateError(() =>
      previewChecklistDateEdit(
        withRecordedDelivery(snapshot, edit.change),
        edit,
      ),
    );
  };
  return transaction ? preview(transaction) : prisma.$transaction(preview);
}

export async function applyMatterChecklistDates(
  actor: Principal,
  matterId: string,
  input: unknown,
  transaction?: Prisma.TransactionClient,
): Promise<{ revision: number; changedKeys: string[] }> {
  assertCoordinator(actor);
  const command = checklistDateApplySchema.parse(input);
  const apply = async (tx: Prisma.TransactionClient) => {
    const matter = await requireMatter(actor, matterId, true, tx);
    requireEditableChecklist(matter);
    const stored = await readChecklistSnapshot(tx, matter);
    const result = translateChecklistDateError(() =>
      applyChecklistDateEdit(
        withRecordedDelivery(stored.snapshot, command.change),
        command,
      ),
    );
    const details = await persistChecklistNodes(tx, stored, result.graph);
    const acceptance = result.graph.acceptance;
    const updated = await tx.matter.update({
      where: { id: matterId },
      data: {
        acceptanceDate: acceptance?.date ?? null,
        acceptanceAt: acceptance?.instant ? new Date(acceptance.instant) : null,
        ...(details ? { details } : {}),
        revision: { increment: 1 },
      },
      select: { revision: true },
    });
    await audit(
      tx,
      actor,
      command.change.kind === "extend"
        ? "checklist.date_extended"
        : "checklist.date_updated",
      "Matter",
      matterId,
      matterId,
      {
        beforeRevision: matter.revision,
        mode: command.mode,
        command: command.change,
        primary: result.preview.primary,
        dependents: result.preview.dependents.map((move) => ({
          ...move,
          ...(command.mode === "only_this_date"
            ? { after: move.before, pinned: true }
            : {}),
        })),
      },
    );
    await matterChanged(tx, actor, matterId);
    return { revision: updated.revision, changedKeys: result.changedKeys };
  };
  return transaction ? apply(transaction) : prisma.$transaction(apply);
}

/** Use after changing a versioned step's status under the current matter lock. */
export async function recalculateChecklistStatus(
  tx: Prisma.TransactionClient,
  matter: Prisma.MatterGetPayload<object>,
  stepKey: string,
) {
  const stored = await readChecklistSnapshot(tx, matter);
  const keys = new Set([
    stepKey,
    ...affectedChecklistKeys(stored.snapshot, { kind: "step", key: stepKey }),
    ...affectedChecklistKeys(stored.snapshot, { kind: "actual", key: stepKey }),
  ]);
  const graph = translateChecklistDateError(() =>
    resolveChecklistDates(stored.snapshot, keys),
  );
  const details = await persistChecklistNodes(tx, stored, graph);
  if (details)
    await tx.matter.update({ where: { id: matter.id }, data: { details } });
}
