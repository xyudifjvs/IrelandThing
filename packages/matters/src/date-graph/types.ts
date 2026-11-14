import type {
  ChecklistDateEdit,
  ChecklistDateRule,
  DateValue,
} from "@weatherly/platform/handoff-contracts";

export type DateChange = ChecklistDateEdit["change"];
export type DateAnchor = Extract<DateChange, { kind: "set" }>["target"];
export type DateAdjustment = Pick<
  Extract<DateChange, { kind: "extend" }>,
  "amount" | "unit"
>;
export type DateOffset = Extract<
  ChecklistDateRule,
  { kind: "relative" }
>["offset"];

export type ChecklistDateNode = {
  key: string;
  status: "open" | "completed" | "not_needed";
  dateCapable: boolean;
  due: DateValue | null;
  actual: DateValue | null;
  rule: ChecklistDateRule | null;
};

export type ChecklistDateGraph = {
  timeZone: string | null;
  acceptance: DateValue | null;
  nodes: readonly ChecklistDateNode[];
};

export type ChecklistDateSnapshot = ChecklistDateGraph & {
  matterId: string;
  revision: number;
};

export class ChecklistDateError extends Error {
  constructor(
    readonly code:
      | "INVALID_DATE"
      | "INVALID_DATE_RULE"
      | "DATE_CYCLE"
      | "UNKNOWN_DATE_ANCHOR"
      | "DATE_NOT_EDITABLE"
      | "DATE_UNRESOLVED"
      | "REVISION_CONFLICT"
      | "PREVIEW_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "ChecklistDateError";
  }
}
