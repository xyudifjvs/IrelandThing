import { prisma, type Prisma } from "@weatherly/db";
import { assertCoordinator, HttpError, type Principal } from "@weatherly/platform";
import {
  checklistDateApplySchema,
  checklistDateEditSchema,
  type ChecklistDateEdit,
} from "@weatherly/platform/handoff-contracts";
import { audit, requireMatter } from "../access";
import { matterChanged } from "../change-hook";
import { fileReviewPending } from "../file-review";
import {
  applyChecklistDateEdit,
  previewChecklistDateEdit,
  type ChecklistDateEditContext,
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

async function editableDateSnapshot(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
  change: ChecklistDateEdit["change"],
  source?: "hto_operations",
) {
  const matter = await requireMatter(actor, matterId, true, tx);
  let context: ChecklistDateEditContext | undefined;
  if (source === "hto_operations") {
    if (
      change.kind !== "set" ||
      change.target.kind !== "step" ||
      change.target.key !== "closing"
    )
      throw new HttpError(
        422,
        "HTO_CLOSING_DATE_TARGET",
        "HTO Operations can change only the closing date.",
      );

    const terminal = matter.stage === "closed" || matter.stage === "terminated";
    if (
      matter.business !== "hto" ||
      fileReviewPending(matter) ||
      (!terminal && matter.stage !== "under_contract" && matter.stage !== "closing") ||
      !(await tx.htoClosing.findUnique({ where: { matterId }, select: { id: true } }))
    )
      throw new HttpError(
        409,
        "HTO_CLOSING_DATE_UNAVAILABLE",
        "This file has no editable linked closing date in HTO Operations.",
      );
    context = terminal ? "hto_terminal_correction" : source;
  } else {
    requireEditableChecklist(matter);
  }
  return { stored: await readChecklistSnapshot(tx, matter), context };
}

async function previewDateCommand(
  actor: Principal,
  matterId: string,
  input: unknown,
  transaction?: Prisma.TransactionClient,
  source?: "hto_operations",
): Promise<ChecklistDatePreview> {
  assertCoordinator(actor);
  const edit = checklistDateEditSchema.parse(input);
  const preview = async (tx: Prisma.TransactionClient) => {
    const { stored, context } = await editableDateSnapshot(
      tx, actor, matterId, edit.change, source,
    );
    return translateChecklistDateError(() =>
      previewChecklistDateEdit(
        withRecordedDelivery(stored.snapshot, edit.change),
        edit,
        context,
      ),
    );
  };
  return transaction ? preview(transaction) : prisma.$transaction(preview);
}

async function applyDateCommand(
  actor: Principal,
  matterId: string,
  input: unknown,
  transaction?: Prisma.TransactionClient,
  source?: "hto_operations",
): Promise<{ revision: number; changedKeys: string[] }> {
  assertCoordinator(actor);
  const command = checklistDateApplySchema.parse(input);
  const apply = async (tx: Prisma.TransactionClient) => {
    const { stored, context } = await editableDateSnapshot(
      tx, actor, matterId, command.change, source,
    );
    const result = translateChecklistDateError(() =>
      applyChecklistDateEdit(
        withRecordedDelivery(stored.snapshot, command.change),
        command,
        context,
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
        beforeRevision: stored.matter.revision,
        ...(source ? { source } : {}),
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

export function previewMatterChecklistDates(
  actor: Principal,
  matterId: string,
  input: unknown,
  transaction?: Prisma.TransactionClient,
) {
  return previewDateCommand(actor, matterId, input, transaction);
}

export function applyMatterChecklistDates(
  actor: Principal,
  matterId: string,
  input: unknown,
  transaction?: Prisma.TransactionClient,
) {
  return applyDateCommand(actor, matterId, input, transaction);
}

/** The HTO route calls these after locking and revalidating its linked row. */
export function previewHtoChecklistClosingDate(
  actor: Principal,
  matterId: string,
  input: unknown,
  transaction?: Prisma.TransactionClient,
) {
  return previewDateCommand(actor, matterId, input, transaction, "hto_operations");
}

export function applyHtoChecklistClosingDate(
  actor: Principal,
  matterId: string,
  input: unknown,
  transaction?: Prisma.TransactionClient,
) {
  return applyDateCommand(actor, matterId, input, transaction, "hto_operations");
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
