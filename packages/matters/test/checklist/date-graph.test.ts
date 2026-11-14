import { describe, expect, it } from "vitest";
import type {
  ChecklistDateEdit,
  ChecklistDateRule,
  DateValue,
} from "@weatherly/platform/handoff-contracts";
import {
  dateValueAtLocalTime,
  localWallTime,
  wallTimeInstants,
} from "../../src/date-graph/calendar";
import {
  applyChecklistDateEdit,
  previewChecklistDateEdit,
} from "../../src/date-graph/preview";
import { resolveChecklistDates } from "../../src/date-graph/resolve";
import type {
  ChecklistDateNode,
  ChecklistDateSnapshot,
  DateAnchor,
  DateOffset,
} from "../../src/date-graph/types";

const acceptance: DateAnchor = { kind: "acceptance" };
const step = (key: string): DateAnchor => ({ kind: "step", key });
const actual = (key: string): DateAnchor => ({ kind: "actual", key });
const date = (value: string, instant: string | null = null): DateValue => ({
  date: value,
  instant,
});
const offset = (
  anchor: DateAnchor,
  amount: number,
  options: Partial<DateOffset> = {},
): DateOffset => ({
  anchor,
  amount,
  unit: "days",
  counting: "calendar",
  rollover: "none",
  calendar: null,
  ...options,
});
const relative = (
  anchor: DateAnchor,
  amount: number,
  options?: Partial<DateOffset>,
): ChecklistDateRule => ({
  kind: "relative",
  offset: offset(anchor, amount, options),
});
const node = (
  key: string,
  rule: ChecklistDateRule | null,
  properties: Partial<ChecklistDateNode> = {},
): ChecklistDateNode => ({
  key,
  status: "open",
  dateCapable: true,
  due: null,
  actual: null,
  rule,
  ...properties,
});
const fixture = (
  nodes: ChecklistDateNode[],
  options: Partial<ChecklistDateSnapshot> = {},
) =>
  resolveChecklistDates({
    matterId: "deal-a",
    revision: 7,
    timeZone: "America/New_York",
    acceptance: date("2026-10-01"),
    nodes,
    ...options,
  });
const due = (graph: ChecklistDateSnapshot, key: string) =>
  graph.nodes.find((item) => item.key === key)?.due;
const setDate = (
  target: DateAnchor,
  value: DateValue | null,
  expectedRevision = 7,
): ChecklistDateEdit => ({
  expectedRevision,
  change: { kind: "set", target, value },
});
const extend = (
  key: string,
  amount: number,
  unit: "days" | "hours" = "days",
): ChecklistDateEdit => ({
  expectedRevision: 7,
  change: { kind: "extend", key, amount, unit },
});
const apply = (
  graph: ChecklistDateSnapshot,
  edit: ChecklistDateEdit,
  mode: "update_all" | "only_this_date" = "update_all",
) =>
  applyChecklistDateEdit(graph, {
    ...edit,
    mode,
    previewDigest: previewChecklistDateEdit(graph, edit).previewDigest,
  }).graph;

describe("checklist date graph", () => {
  it("resolves same-day and signed offsets through unordered chains", () => {
    const graph = fixture([
      node("negotiated", relative(step("remedies"), 3)),
      node("walkthrough", relative(step("closing"), -2)),
      node("closing", { kind: "fixed" }, { due: date("2026-10-31") }),
      node("remedies", relative(step("inspections"), 0)),
      node("title", relative(step("closing"), -15)),
      node("inspections", relative(acceptance, 10)),
    ]);
    expect(due(graph, "inspections")).toEqual(date("2026-10-11"));
    expect(due(graph, "remedies")).toEqual(date("2026-10-11"));
    expect(due(graph, "negotiated")).toEqual(date("2026-10-14"));
    expect(due(graph, "walkthrough")).toEqual(date("2026-10-29"));
    expect(due(graph, "title")).toEqual(date("2026-10-16"));
  });

  it("uses the specified working days, holiday exclusions, and rollover direction", () => {
    const calendar = {
      workingWeekdays: [1, 2, 3, 4, 5],
      excludedDates: ["2026-10-12"],
    };
    const graph = fixture(
      [
        node(
          "business_after",
          relative(acceptance, 1, { counting: "business", calendar }),
        ),
        node(
          "calendar_forward",
          relative(acceptance, 1, { rollover: "next_workday", calendar }),
        ),
        node(
          "calendar_back",
          relative(acceptance, 1, { rollover: "previous_workday", calendar }),
        ),
        node(
          "business_before",
          relative(step("business_after"), -1, {
            counting: "business",
            calendar,
          }),
        ),
      ],
      { acceptance: date("2026-10-09") },
    );
    expect(due(graph, "business_after")).toEqual(date("2026-10-13"));
    expect(due(graph, "calendar_forward")).toEqual(date("2026-10-13"));
    expect(due(graph, "calendar_back")).toEqual(date("2026-10-09"));
    expect(due(graph, "business_before")).toEqual(date("2026-10-09"));
  });

  it("uses the acceptance cap until the actual HOA delivery date is known", () => {
    const graph = fixture([
      node("provided", relative(acceptance, 4), {
        status: "completed",
        due: date("2026-10-05"),
      }),
      node("review", {
        kind: "earliest",
        offsets: [offset(actual("provided"), 3), offset(acceptance, 10)],
      }),
    ]);
    expect(due(graph, "review")).toEqual(date("2026-10-11"));
    const earlier = apply(
      graph,
      setDate(actual("provided"), date("2026-10-03")),
    );
    expect(due(earlier, "review")).toEqual(date("2026-10-06"));
    expect(due(earlier, "provided")).toEqual(date("2026-10-05"));
    expect(
      due(
        apply(earlier, setDate(actual("provided"), date("2026-10-10"))),
        "review",
      ),
    ).toEqual(date("2026-10-11"));
  });

  it("rejects cycles in an alternate earliest branch and unknown anchor keys", () => {
    expect(() =>
      fixture([
        node("inspection", {
          kind: "earliest",
          offsets: [offset(acceptance, 1), offset(step("repair"), 0)],
        }),
        node("repair", relative(step("inspection"), 0), {
          status: "completed",
        }),
      ]),
    ).toThrow(expect.objectContaining({ code: "DATE_CYCLE" }));
    expect(() =>
      fixture([node("repair", relative(step("missing"), 2))]),
    ).toThrow(expect.objectContaining({ code: "UNKNOWN_DATE_ANCHOR" }));
  });

  it("does not use a due date as the actual event, even on the same step", () => {
    const graph = fixture([
      node("inspection", relative(actual("inspection"), 1)),
    ]);
    expect(due(graph, "inspection")).toBeNull();
    expect(
      due(
        apply(graph, setDate(actual("inspection"), date("2026-10-06"))),
        "inspection",
      ),
    ).toEqual(date("2026-10-07"));
  });

  it("preserves completed and not-needed values when acceptance moves", () => {
    const graph = fixture([
      node("inspection", relative(acceptance, 5), {
        status: "completed",
        due: date("2026-10-06"),
      }),
      node("repair", relative(step("inspection"), 2)),
      node("attorney", relative(acceptance, 2), {
        status: "not_needed",
        due: date("2026-10-03"),
      }),
      node("earnest", relative(acceptance, 4)),
    ]);
    const updated = apply(graph, setDate(acceptance, date("2026-10-07")));
    expect(due(updated, "inspection")).toEqual(date("2026-10-06"));
    expect(due(updated, "repair")).toEqual(date("2026-10-08"));
    expect(due(updated, "attorney")).toEqual(date("2026-10-03"));
    expect(due(updated, "earnest")).toEqual(date("2026-10-11"));
  });

  it("pins only affected downstream values, even when the current value is blank", () => {
    const graph = fixture(
      [
        node("inspection", relative(acceptance, 5)),
        node("repair", relative(step("inspection"), 2)),
        node("closing", { kind: "fixed" }, { due: date("2026-10-20") }),
        node("walkthrough", relative(step("closing"), -2)),
      ],
      { acceptance: null },
    );
    const edit = setDate(acceptance, date("2026-10-01"));
    const preview = previewChecklistDateEdit(graph, edit);
    expect(preview.dependents.map(({ target }) => target)).toEqual([
      step("inspection"),
      step("repair"),
    ]);
    const pinned = apply(graph, edit, "only_this_date");
    expect(due(pinned, "inspection")).toBeNull();
    expect(due(pinned, "repair")).toBeNull();
    expect(pinned.nodes.find(({ key }) => key === "inspection")?.rule).toEqual({
      kind: "fixed",
    });
    const moved = apply(pinned, setDate(acceptance, date("2026-10-09")));
    expect(due(moved, "repair")).toBeNull();
    expect(
      due(
        apply(moved, setDate(step("closing"), date("2026-10-25"))),
        "walkthrough",
      ),
    ).toEqual(date("2026-10-23"));
  });

  it("makes a typed date fixed and keeps an extension attached to its base rule", () => {
    const graph = fixture([
      node("inspection", relative(acceptance, 10)),
      node("repair", relative(step("inspection"), 3)),
    ]);
    const extended = apply(graph, extend("inspection", 4));
    expect(due(extended, "inspection")).toEqual(date("2026-10-15"));
    expect(due(extended, "repair")).toEqual(date("2026-10-18"));
    const moved = apply(extended, setDate(acceptance, date("2026-10-03")));
    expect(due(moved, "inspection")).toEqual(date("2026-10-17"));
    expect(due(moved, "repair")).toEqual(date("2026-10-20"));
    const fixed = apply(moved, setDate(step("inspection"), date("2026-10-25")));
    const later = apply(fixed, setDate(acceptance, date("2026-10-08")));
    expect(due(later, "inspection")).toEqual(date("2026-10-25"));
    expect(due(later, "repair")).toEqual(date("2026-10-28"));
  });

  it("requires a fresh preview after a revision, target value, or matter change", () => {
    const graph = fixture([node("inspection", relative(acceptance, 5))]);
    const edit = setDate(acceptance, date("2026-10-03"));
    const { previewDigest } = previewChecklistDateEdit(graph, edit);
    const command = { ...edit, previewDigest, mode: "update_all" as const };
    expect(() =>
      applyChecklistDateEdit({ ...graph, revision: 8 }, command),
    ).toThrow(expect.objectContaining({ code: "REVISION_CONFLICT" }));
    expect(() =>
      applyChecklistDateEdit({ ...graph, matterId: "deal-b" }, command),
    ).toThrow(expect.objectContaining({ code: "PREVIEW_CONFLICT" }));
    expect(() =>
      applyChecklistDateEdit(graph, {
        ...command,
        change: { kind: "set", target: acceptance, value: date("2026-10-04") },
      }),
    ).toThrow(expect.objectContaining({ code: "PREVIEW_CONFLICT" }));
  });

  it("leaves rules blank when calendar behavior, business hours or an exact time is unknown", () => {
    const calendar = { workingWeekdays: [1, 2, 3, 4, 5], excludedDates: [] };
    const graph = fixture([
      node(
        "count_unknown",
        relative(acceptance, 2, { counting: "unspecified" }),
      ),
      node(
        "roll_unknown",
        relative(acceptance, 2, { rollover: "unspecified" }),
      ),
      node("missing_exact", relative(acceptance, 48, { unit: "hours" })),
      node(
        "business_hours",
        relative(acceptance, 8, {
          unit: "hours",
          counting: "business",
          calendar,
        }),
      ),
    ]);
    expect(graph.nodes.every((item) => item.due === null)).toBe(true);
    expect(() =>
      previewChecklistDateEdit(graph, extend("missing_exact", 1)),
    ).toThrow(expect.objectContaining({ code: "DATE_UNRESOLVED" }));
    const noZone = fixture(
      [node("missing_zone", relative(acceptance, 2, { unit: "hours" }))],
      {
        timeZone: null,
        acceptance: date("2026-10-01", "2026-10-01T15:00:00Z"),
      },
    );
    expect(due(noZone, "missing_zone")).toBeNull();
  });

  it("uses elapsed hours across DST and preserves local clock when extending by calendar days", () => {
    const graph = fixture(
      [
        node("exact", relative(acceptance, 2, { unit: "hours" })),
        node(
          "closing",
          { kind: "fixed" },
          { due: date("2027-03-13", "2027-03-13T14:00:00Z") },
        ),
      ],
      { acceptance: date("2027-03-14", "2027-03-14T06:30:00Z") },
    );
    expect(due(graph, "exact")).toEqual(
      date("2027-03-14", "2027-03-14T08:30:00.000Z"),
    );
    expect(due(apply(graph, extend("closing", 1)), "closing")).toEqual(
      date("2027-03-14", "2027-03-14T13:00:00.000Z"),
    );
  });

  it.each([
    ["2027-03-13", "2027-03-13T07:30:00Z"],
    ["2027-11-06", "2027-11-06T05:30:00Z"],
  ])(
    "requires a direct date when a calendar extension from %s lands in a DST gap or fold",
    (day, instant) => {
      const graph = fixture([
        node("closing", { kind: "fixed" }, { due: date(day, instant) }),
      ]);
      expect(() =>
        previewChecklistDateEdit(graph, extend("closing", 1)),
      ).toThrow(expect.objectContaining({ code: "DATE_UNRESOLVED" }));
    },
  );

  it("rejects an exact timestamp whose civil date differs in the selected zone", () => {
    const graph = fixture([]);
    expect(() =>
      previewChecklistDateEdit(
        graph,
        setDate(acceptance, date("2026-10-02", "2026-10-02T02:00:00Z")),
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_DATE" }));
  });
});

describe("appointment wall clocks", () => {
  const timeZone = "America/New_York";

  it("rejects a local DST gap without changing the entered time", () => {
    expect(wallTimeInstants("2027-03-14T02:30", timeZone)).toEqual([]);
    expect(wallTimeInstants("2027-03-14T03:30", timeZone)).toEqual([
      "2027-03-14T07:30:00.000Z",
    ]);
  });

  it("lists both occurrences of a repeated appointment time and preserves precision", () => {
    const wallTime = "2027-11-07T01:30:20.125";
    const first = "2027-11-07T05:30:20.125Z";
    const second = "2027-11-07T06:30:20.125Z";
    expect(wallTimeInstants(wallTime, timeZone)).toEqual([first, second]);
    expect(localWallTime(first, timeZone)).toBe(wallTime);
    expect(localWallTime(second, timeZone)).toBe(wallTime);
    expect(() => dateValueAtLocalTime("2027-11-07", "01:30", timeZone)).toThrow(
      "Choose a time that occurs once",
    );
  });
});
