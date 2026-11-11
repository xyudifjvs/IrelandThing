import { createHash } from "node:crypto";
import {
  checklistDateApplySchema,
  checklistDateEditSchema,
  type ChecklistDateApply,
  type ChecklistDateEdit,
  type DateValue,
} from "@weatherly/platform/handoff-contracts";
import {
  adjustDate,
  deadlineCalendar,
  sameDateValue,
  validateDateValue,
} from "./calendar";
import { affectedChecklistKeys, resolveChecklistDates } from "./resolve";
import {
  ChecklistDateError,
  type ChecklistDateNode,
  type ChecklistDateSnapshot,
  type DateAnchor,
} from "./types";

type DateMove = {
  target: DateAnchor;
  before: DateValue | null;
  after: DateValue | null;
};

export type ChecklistDatePreview = {
  revision: number;
  primary: DateMove;
  dependents: DateMove[];
  previewDigest: string;
};

function targetNode(snapshot: ChecklistDateSnapshot, key: string) {
  const node = snapshot.nodes.find((item) => item.key === key);
  if (!node)
    throw new ChecklistDateError(
      "UNKNOWN_DATE_ANCHOR",
      "That checklist date no longer exists.",
    );
  return node;
}

function editTarget(snapshot: ChecklistDateSnapshot, edit: ChecklistDateEdit) {
  const { change } = edit;
  const calendar = deadlineCalendar(snapshot.timeZone);
  const target: DateAnchor =
    change.kind === "set" ? change.target : { kind: "step", key: change.key };

  if (change.kind === "set") validateDateValue(change.value, calendar, true);

  if (target.kind === "acceptance" && change.kind === "set")
    return {
      target,
      before: snapshot.acceptance,
      graph: { ...snapshot, acceptance: change.value },
      recalculateTarget: false,
    };

  if (target.kind === "acceptance")
    throw new Error("An extension needs a checklist key.");
  const node = targetNode(snapshot, target.key);
  let updated: ChecklistDateNode;
  let recalculateTarget = false;

  if (target.kind === "actual" && change.kind === "set") {
    if (node.status === "not_needed")
      throw new ChecklistDateError(
        "DATE_NOT_EDITABLE",
        "Mark this step needed first.",
      );
    updated = { ...node, actual: change.value };
  } else {
    if (!node.dateCapable || node.status !== "open")
      throw new ChecklistDateError(
        "DATE_NOT_EDITABLE",
        "This checklist step has no editable due date.",
      );
    if (change.kind === "set") {
      updated = { ...node, due: change.value, rule: { kind: "fixed" } };
    } else {
      const adjustment = { amount: change.amount, unit: change.unit };
      const due = node.due ? adjustDate(node.due, adjustment, calendar) : null;
      if (!due)
        throw new ChecklistDateError(
          "DATE_UNRESOLVED",
          "Enter the new due date directly when the extension cannot be calculated.",
        );
      const rule = node.rule;
      if (rule && rule.kind !== "fixed") {
        updated = {
          ...node,
          due,
          rule: {
            ...rule,
            adjustments: [...(rule.adjustments ?? []), adjustment],
          },
        };
        recalculateTarget = true;
      } else {
        updated = { ...node, due, rule: { kind: "fixed" } };
      }
    }
  }

  return {
    target,
    before: target.kind === "actual" ? node.actual : node.due,
    graph: {
      ...snapshot,
      nodes: snapshot.nodes.map((item) =>
        item.key === node.key ? updated : item,
      ),
    },
    recalculateTarget,
  };
}

function computePreview(
  snapshot: ChecklistDateSnapshot,
  edit: ChecklistDateEdit,
) {
  if (snapshot.revision !== edit.expectedRevision)
    throw new ChecklistDateError(
      "REVISION_CONFLICT",
      "The file changed. Refresh and preview the date again.",
    );

  const original = resolveChecklistDates(snapshot, new Set());
  const { target, before, graph, recalculateTarget } = editTarget(
    original,
    edit,
  );
  const affected = affectedChecklistKeys(graph, target);
  if (recalculateTarget && target.kind === "step") affected.add(target.key);
  const updateAll = resolveChecklistDates(graph, affected);
  const result =
    target.kind === "acceptance" ? null : targetNode(updateAll, target.key);
  const after =
    target.kind === "acceptance"
      ? updateAll.acceptance
      : ((target.kind === "actual" ? result?.actual : result?.due) ?? null);
  if (edit.change.kind === "extend" && !after)
    throw new ChecklistDateError(
      "DATE_UNRESOLVED",
      "The linked rule cannot resolve an extension. Enter the new due date directly.",
    );

  const primary: DateMove = { target, before, after };
  const priorDue = new Map(original.nodes.map((node) => [node.key, node.due]));
  const dependentKeys = new Set<string>();
  const dependents: DateMove[] = [];
  for (const node of updateAll.nodes) {
    if (!affected.has(node.key)) continue;
    if (target.kind === "step" && target.key === node.key) continue;
    const previous = priorDue.get(node.key) ?? null;
    if (sameDateValue(previous, node.due)) continue;
    dependentKeys.add(node.key);
    dependents.push({
      target: { kind: "step", key: node.key },
      before: previous,
      after: node.due,
    });
  }

  const previewDigest = createHash("sha256")
    .update(
      JSON.stringify({
        matterId: snapshot.matterId,
        revision: snapshot.revision,
        change: edit.change,
        primary,
        dependents,
      }),
    )
    .digest("hex");
  const preview: ChecklistDatePreview = {
    revision: snapshot.revision,
    primary,
    dependents,
    previewDigest,
  };
  return { preview, updateAll, priorDue, dependentKeys };
}

export function previewChecklistDateEdit(
  snapshot: ChecklistDateSnapshot,
  edit: ChecklistDateEdit,
): ChecklistDatePreview {
  return computePreview(snapshot, checklistDateEditSchema.parse(edit)).preview;
}

/**
 * Services call this with the current snapshot while holding the Matter lock.
 * The caller persists the selected changes and increments the revision together.
 */
export function applyChecklistDateEdit(
  snapshot: ChecklistDateSnapshot,
  command: ChecklistDateApply,
) {
  const { previewDigest, mode, ...edit } =
    checklistDateApplySchema.parse(command);
  const { preview, updateAll, priorDue, dependentKeys } = computePreview(
    snapshot,
    edit,
  );
  if (preview.previewDigest !== previewDigest)
    throw new ChecklistDateError(
      "PREVIEW_CONFLICT",
      "The date change differs from the preview. Preview it again.",
    );

  const target = preview.primary.target;
  const nodes = updateAll.nodes.map((node): ChecklistDateNode => {
    if (mode !== "only_this_date" || !dependentKeys.has(node.key)) return node;
    return {
      ...node,
      due: priorDue.get(node.key) ?? null,
      rule: { kind: "fixed" },
    };
  });

  return {
    graph: { ...updateAll, nodes },
    changedKeys: [
      ...new Set([
        target.kind === "acceptance" ? "acceptance" : target.key,
        ...dependentKeys,
      ]),
    ],
    preview,
  };
}
