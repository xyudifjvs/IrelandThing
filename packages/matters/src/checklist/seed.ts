import type {
  ChecklistDateInput,
  DateValue,
  TransactionSide,
} from "@weatherly/platform/handoff-contracts";
import { deadlineCalendar, validateDateValue } from "../date-graph/calendar";
import { resolveChecklistDates } from "../date-graph/resolve";
import {
  ChecklistDateError,
  type ChecklistDateNode,
} from "../date-graph/types";
import {
  checklistTemplate,
  remediesAnchorKey,
  type ChecklistStepTemplate,
  type PurchaseType,
} from "./templates";

export type ChecklistSeed = {
  side: TransactionSide;
  purchaseType: PurchaseType;
  acceptance: DateValue | null;
  timeZone: string | null;
  dates: readonly ChecklistDateInput[];
};

export function buildChecklistSeed(input: ChecklistSeed) {
  const templates = checklistTemplate(input.side, input.purchaseType);
  const templatesByKey = new Map(templates.map((item) => [item.key, item]));
  const dates = new Map<string, ChecklistDateInput>();
  const calendar = deadlineCalendar(input.timeZone);
  validateDateValue(input.acceptance, calendar, true);
  for (const date of input.dates) {
    if (dates.has(date.key))
      throw new ChecklistDateError(
        "INVALID_DATE_RULE",
        "Checklist date keys must be distinct.",
      );
    const template = templatesByKey.get(date.key);
    if (
      !template &&
      date.key !== remediesAnchorKey &&
      !(input.side === "seller" && date.key === "title_commitment")
    )
      throw new ChecklistDateError(
        "UNKNOWN_DATE_ANCHOR",
        `That date key does not belong to this checklist: ${date.key}.`,
      );
    if (template && !template.dateCapable && (date.value || date.rule))
      throw new ChecklistDateError(
        "DATE_NOT_EDITABLE",
        `${template.title} does not take a due date.`,
      );
    validateDateValue(date.value, calendar, true);
    dates.set(date.key, date);
  }

  function node(
    template: Pick<ChecklistStepTemplate, "key" | "dateCapable" | "notNeeded">,
  ): ChecklistDateNode {
    const date = dates.get(template.key);
    return {
      key: template.key,
      dateCapable: template.dateCapable,
      status: (date?.notNeeded ?? template.notNeeded) ? "not_needed" : "open",
      due: date?.value ?? null,
      actual: null,
      rule: date?.rule ?? null,
    };
  }

  const graph = resolveChecklistDates({
    acceptance: input.acceptance,
    timeZone: input.timeZone,
    nodes: [
      ...templates.map(node),
      ...(input.side === "seller"
        ? [
            node({
              key: "title_commitment",
              dateCapable: true,
              notNeeded: false,
            }),
          ]
        : []),
    ],
  });
  const resolved = new Map(graph.nodes.map((item) => [item.key, item]));
  return {
    steps: templates.map((template) => ({
      ...template,
      ...resolved.get(template.key)!,
      dateWording: dates.get(template.key)?.dateWording ?? "",
      notNeeded: resolved.get(template.key)!.status === "not_needed",
    })),
    hiddenAnchors: graph.nodes.filter((item) => !templatesByKey.has(item.key)),
  };
}
