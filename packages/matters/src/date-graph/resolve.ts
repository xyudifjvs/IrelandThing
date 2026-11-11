import {
  checklistDateRuleSchema,
  stepKeySchema,
  type ChecklistDateRule,
  type DateValue,
} from "@weatherly/platform/handoff-contracts";
import {
  adjustDate,
  deadlineCalendar,
  resolveOffset,
  validateDateValue,
} from "./calendar";
import {
  ChecklistDateError,
  type ChecklistDateGraph,
  type ChecklistDateNode,
  type DateAnchor,
  type DateOffset,
} from "./types";

function anchors(rule: ChecklistDateRule | null): readonly DateAnchor[] {
  if (rule?.kind === "relative") return [rule.offset.anchor];
  if (rule?.kind === "earliest")
    return rule.offsets.map((offset) => offset.anchor);
  return [];
}

function validateRule(rule: ChecklistDateRule | null) {
  if (rule && !checklistDateRuleSchema.safeParse(rule).success) {
    throw new ChecklistDateError(
      "INVALID_DATE_RULE",
      "The checklist contains an invalid date rule.",
    );
  }
}

function earliestAvailable(
  left: DateValue | null,
  right: DateValue | null,
): DateValue | null {
  if (!left || !right) return left ?? right;
  if (left.date !== right.date) return left.date < right.date ? left : right;
  if (!left.instant || !right.instant)
    return { date: left.date, instant: null };
  return Date.parse(left.instant) <= Date.parse(right.instant) ? left : right;
}

function resolveRule(
  rule: Exclude<ChecklistDateRule, { kind: "fixed" }>,
  valueOf: (anchor: DateAnchor) => DateValue | null,
  calendar: Intl.DateTimeFormat | null,
) {
  const calculate = (offset: DateOffset) =>
    resolveOffset(valueOf(offset.anchor), offset, calendar);
  let result =
    rule.kind === "relative"
      ? calculate(rule.offset)
      : earliestAvailable(
          calculate(rule.offsets[0]),
          calculate(rule.offsets[1]),
        );
  for (const adjustment of rule.adjustments ?? []) {
    if (!result) break;
    result = adjustDate(result, adjustment, calendar);
  }
  return result;
}

/**
 * Resolve a full checklist or a specified subset after an edit.
 * A fixed, skipped, or completed node keeps its stored due value.
 */
export function resolveChecklistDates<T extends ChecklistDateGraph>(
  graph: T,
  affected?: ReadonlySet<string>,
) {
  const calendar = deadlineCalendar(graph.timeZone);
  validateDateValue(graph.acceptance, calendar);
  const nodes = new Map<string, ChecklistDateNode>();
  for (const node of graph.nodes) {
    if (
      !stepKeySchema.safeParse(node.key).success ||
      node.key === "acceptance" ||
      nodes.has(node.key)
    ) {
      throw new ChecklistDateError(
        "INVALID_DATE_RULE",
        "Checklist date keys must be distinct and valid.",
      );
    }
    validateDateValue(node.due, calendar);
    validateDateValue(node.actual, calendar);
    validateRule(node.rule);
    if (!node.dateCapable && (node.due || node.rule))
      throw new ChecklistDateError(
        "INVALID_DATE_RULE",
        "A checklist step without a due date cannot have a date rule.",
      );
    nodes.set(node.key, node);
  }

  const evaluating = new Set<string>();
  const results = new Map<string, DateValue | null>();

  function valueOf(anchor: DateAnchor) {
    if (anchor.kind === "acceptance") return graph.acceptance;
    const node = nodes.get(anchor.key);
    if (!node)
      throw new ChecklistDateError(
        "UNKNOWN_DATE_ANCHOR",
        `Checklist date rule refers to an unknown key: ${anchor.key}.`,
      );
    if (anchor.kind === "actual")
      return node.status === "not_needed" ? null : node.actual;
    const due = visit(node);
    return node.status === "not_needed" ? null : due;
  }

  function visit(node: ChecklistDateNode): DateValue | null {
    if (results.has(node.key)) return results.get(node.key) ?? null;
    if (evaluating.has(node.key))
      throw new ChecklistDateError(
        "DATE_CYCLE",
        "Checklist date rules cannot depend on one another in a circle.",
      );
    evaluating.add(node.key);
    // Check both earliest branches, including rules temporarily held by a
    // completed or skipped item. An actual event is a fact, not a due-date edge.
    for (const anchor of anchors(node.rule)) valueOf(anchor);
    const due =
      node.status === "open" &&
      node.rule &&
      node.rule.kind !== "fixed" &&
      (!affected || affected.has(node.key))
        ? resolveRule(node.rule, valueOf, calendar)
        : node.due;
    results.set(node.key, due);
    evaluating.delete(node.key);
    return due;
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, due: visit(node) })),
  };
}

function anchorKey(anchor: DateAnchor) {
  return anchor.kind === "acceptance"
    ? "acceptance"
    : `${anchor.kind}:${anchor.key}`;
}

export function affectedChecklistKeys(
  graph: ChecklistDateGraph,
  target: DateAnchor,
) {
  const dependents = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (node.status !== "open") continue;
    for (const anchor of anchors(node.rule)) {
      const key = anchorKey(anchor);
      const list = dependents.get(key) ?? [];
      list.push(node.key);
      dependents.set(key, list);
    }
  }
  const affected = new Set<string>();
  const queue = [anchorKey(target)];
  for (let i = 0; i < queue.length; i += 1) {
    for (const key of dependents.get(queue[i]) ?? []) {
      if (affected.has(key)) continue;
      affected.add(key);
      queue.push(`step:${key}`);
    }
  }
  return affected;
}
