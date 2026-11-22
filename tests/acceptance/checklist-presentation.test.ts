import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import * as calendar from "../../packages/matters/src/date-graph/calendar";
import * as display from "../../packages/matters/src/checklist/display";
import * as contracts from "../../packages/platform/src/handoff-contracts";
import * as data from "../../apps/web/app/(workspace)/workspace/_components/data";
import {
  appointmentClock,
  clockWallTime,
  dueDateParts,
  dueStatus,
  emptyClock,
} from "../../apps/web/app/(workspace)/workspace/_features/checklist/checklist-presentation";
import type {
  ChecklistTaskRecord,
  ChecklistMatter,
} from "../../apps/web/app/(workspace)/workspace/_features/checklist/canonical-checklist-model";

// Render the actual Next client views without changing Next's JSX-preserving config.
function loadView(path: string): Record<string, unknown> {
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", compiled.outputText)((name: string) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "@weatherly/platform/handoff-contracts") return contracts;
    if (name.endsWith("/date-graph/calendar")) return calendar;
    if (name.endsWith("/checklist/display")) return display;
    if (name.endsWith("/_components/data")) return { ...data, mutate: vi.fn() };
    if (name.endsWith(".module.css"))
      return {
        __esModule: true,
        default: new Proxy({}, { get: (_, key) => String(key) }),
      };
    if (name.startsWith(".")) {
      const source = resolve(dirname(path), name);
      const target = [source + ".tsx", source + ".ts"].find(existsSync);
      if (target) return loadView(target);
    }
    throw new Error(`Unexpected checklist dependency ${name}`);
  }, exports);
  return exports;
}
const base = resolve("apps/web/app/(workspace)/workspace/_features/checklist");
const Step = loadView(`${base}/CanonicalChecklistStep.tsx`)
  .CanonicalChecklistStep as React.ComponentType<any>;
const Panel = loadView(`${base}/CanonicalChecklistPanel.tsx`)
  .CanonicalChecklistPanel as React.ComponentType<any>;
const Editor = loadView(`${base}/ChecklistStepEditor.tsx`)
  .ChecklistStepEditor as React.ComponentType<any>;
const task = (
  overrides: Partial<ChecklistTaskRecord> = {},
): ChecklistTaskRecord =>
  ({
    id: "synthetic",
    title: "Earnest Money Due",
    kind: "checklist",
    status: "pending",
    revision: 1,
    stepKey: "earnest_money_due",
    dateCapable: true,
    dueDate: "2026-11-23",
    dueAt: null,
    actualDate: null,
    actualAt: null,
    dateRule: { kind: "fixed" },
    details: {
      amountCents: 500000,
      holder: "Synthetic Title",
      dateWording: "on or before 11/23/26",
    },
    ...overrides,
  }) as ChecklistTaskRecord;
function renderStep(value = task(), readOnly = false) {
  return renderToStaticMarkup(
    React.createElement(Step, {
      task: value,
      matterId: "synthetic-matter",
      labels: {},
      busy: false,
      readOnly,
      act: vi.fn(),
      editDate: vi.fn(),
      now: new Date("2026-11-22T15:00:00Z"),
    }),
  );
}

describe("checklist presentation preserves saved deadline semantics", () => {
  it("uses the saved civil date for the black date box, including year boundaries", () => {
    expect(dueDateParts("2026-09-21")).toEqual({
      month: "SEP",
      day: "21",
      weekday: "Mon",
    });
    expect(dueDateParts(null)).toBeNull();
    expect(dueDateParts("2027-01-01")?.weekday).toBe("Fri");
  });
  it("counts calendar days in the file's timezone across DST, not elapsed hours", () => {
    const now = new Date("2026-03-08T04:30:00Z"); // still March 7 in New York
    expect(dueStatus("2026-03-08", false, now, "America/New_York")).toBe(
      "In 1 day",
    );
    expect(dueStatus("2026-03-07", false, now, "America/New_York")).toBe(
      "Today",
    );
    expect(dueStatus("2026-03-06", false, now, "America/New_York")).toBe(
      "1 day ago",
    );
    expect(dueStatus("2026-03-10", false, now, "America/New_York")).toBe(
      "In 3 days",
    );
    expect(dueStatus("2026-03-06", true, now, "America/New_York")).toBe("Done");
    expect(dueStatus(null, true, now, null)).toBe("Done");
    expect(dueStatus(null, false, now, null)).toBe("");
    expect(
      dueStatus("2027-01-01", false, new Date("2026-12-31T17:00:00Z"), null),
    ).toBe("In 1 day");
  });
  it("keeps money/holder and custom wording visible while editing actions live in the menu", () => {
    const html = renderStep();
    expect(html).toContain("$5,000 · held by Synthetic Title");
    expect(html).toContain("on or before 11/23/26");
    expect(html).toContain("In 1 day");
    expect(html).toContain('class="dateBox"');
    expect(html).toContain('aria-label="Edit due date for Earnest Money Due"');
    const menu = html.slice(html.indexOf("<details"));
    for (const label of [
      "Edit step",
      "Edit date display text",
      "Add note",
      "Edit amount and holder",
      "Mark not needed",
      "Extend",
    ])
      expect(menu).toContain(label);
    expect(html.slice(0, html.indexOf("<details"))).not.toContain("Add note");
    const warranty = renderStep(
      task({
        stepKey: "home_warranty_ordered",
        title: "Home Warranty Ordered",
        details: { amountCents: 65000, company: "Synthetic Warranty" },
      }),
    );
    expect(warranty).toContain("$650 · Synthetic Warranty");
    expect(warranty).toContain("Edit warranty amount and company");
  });
  it("does not invent dates from wording or enable dates on non-date steps", () => {
    const undated = renderStep(
      task({
        dueDate: null,
        details: { dateWording: "within 3 days of closing" },
      }),
    );
    expect(undated).toContain("Add due date");
    expect(undated).not.toContain("In 1 day");
    const noDate = renderStep(
      task({
        stepKey: "clear_to_close",
        title: "Clear to Close",
        dateCapable: false,
        dueDate: null,
        dateRule: null,
        details: {},
      }),
    );
    expect(noDate).not.toContain("dateBox");
    expect(noDate).not.toContain("date display text");
    expect(noDate).toContain("Add note");
  });
  it("keeps exact due times visible and locks all controls on read-only files", () => {
    const html = renderStep(task({ dueAt: "2026-11-23T15:10:00Z" }), true);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<details");
    expect(html).toContain("disabled");
    expect(renderStep(task({ status: "completed" }))).toContain(">Done</span>");
    const timed = renderToStaticMarkup(
      React.createElement(Step, {
        task: task({ dueAt: "2026-11-23T15:10:00Z" }),
        matterId: "synthetic",
        timeZone: "America/New_York",
        labels: {},
        busy: false,
        readOnly: false,
        act: vi.fn(),
        editDate: vi.fn(),
        now: new Date("2026-11-22T15:00:00Z"),
      }),
    );
    expect(timed).toContain("Due at 10:10 AM EST");
  });
  it("folds skipped steps at the bottom without deleting their restore controls", () => {
    const matter = {
      id: "synthetic",
      stage: "under_contract",
      checklistVersion: 1,
      acceptanceDate: null,
      acceptanceAt: null,
      deadlineTimeZone: "America/New_York",
      tasks: [
        task(),
        task({
          id: "skipped",
          title: "Attorney Review",
          stepKey: "attorney_review",
          status: "not_applicable",
        }),
      ],
    } as ChecklistMatter;
    const html = renderToStaticMarkup(
      React.createElement(Panel, { matter, busy: false, act: vi.fn() }),
    );
    const folded = html.slice(html.indexOf('class="notNeeded"'));
    expect(folded).toContain("1 not needed");
    expect(folded).toContain("Attorney Review");
    expect(folded).toContain("Needed after all");
    expect(folded).not.toMatch(/<details[^>]*open/);
    expect(html.indexOf("+ Add step")).toBeLessThan(
      html.indexOf('class="notNeeded"'),
    );
  });
});

describe("minute precision scheduling", () => {
  it("starts blank and converts any chosen minute and midnight/noon correctly", () => {
    expect(clockWallTime(emptyClock)).toBeNull();
    expect(clockWallTime({ ...emptyClock, date: "2026-09-19" })).toBe("");
    for (const [hour, period, expected] of [
      ["9", "AM", "09"],
      ["12", "AM", "00"],
      ["12", "PM", "12"],
      ["9", "PM", "21"],
    ]) {
      expect(
        clockWallTime({ date: "2026-09-19", hour, minute: "10", period }),
      ).toBe(`2026-09-19T${expected}:10`);
    }
    expect(
      clockWallTime({
        date: "2026-09-19",
        hour: "9",
        minute: "60",
        period: "AM",
      }),
    ).toBe("");
  });
  it("retains fractional precision until a clock change and detects DST gaps/folds", () => {
    const instant = "2026-11-01T06:10:25.123Z";
    const wall = calendar.localWallTime(instant, "America/New_York")!;
    expect(calendar.wallTimeInstants(wall, "America/New_York")).toContain(
      instant,
    );
    expect(clockWallTime(appointmentClock(wall))).toBe("2026-11-01T01:10");
    expect(
      calendar.wallTimeInstants("2026-03-08T02:10", "America/New_York"),
    ).toEqual([]);
    expect(
      calendar.wallTimeInstants("2026-11-01T01:10", "America/New_York"),
    ).toEqual(["2026-11-01T05:10:00.000Z", "2026-11-01T06:10:00.000Z"]);
  });
  it("renders a blank minute-capable picker and preserves private note defaults", () => {
    const props = {
      task: task({ details: { scheduled: true } }),
      matterId: "synthetic",
      timeZone: "America/New_York",
      busy: false,
      act: vi.fn(),
      onClose: vi.fn(),
    };
    const html = renderToStaticMarkup(
      React.createElement(Editor, { ...props, kind: "appointment" }),
    );
    expect(html).toContain("America/New_York");
    expect(html).toContain('max="59"');
    expect(html).not.toContain('type="datetime-local"');
    expect(html).not.toContain('step="0.001"');
    expect(html).toContain('placeholder="00–59" value=""');
    const note = renderToStaticMarkup(
      React.createElement(Editor, { ...props, kind: "note" }),
    );
    expect(note).toContain("Show to agent");
    expect(note).not.toContain("checked");
  });
  it("uses the same concise appointment label in the checklist and merge fields", () => {
    expect(display.scheduledAppointment("2026-09-19T13:10:00Z")).toBe(
      "Sat, Sep 19 at 9:10 AM",
    );
    expect(
      display.scheduledAppointment("2026-09-19T13:10:00Z", "America/Chicago"),
    ).toBe("Sat, Sep 19 at 8:10 AM");
    expect(display.scheduledAppointment(null)).toBe("");
    expect(display.scheduledAppointment("invalid")).toBe("");
    const html = renderStep(
      task({
        details: {
          scheduled: true,
          appointmentAt: "2026-09-19T13:10:00Z",
          appointmentPlace: "Synthetic Office",
        },
      }),
    );
    expect(html).toContain("Sat, Sep 19 at 9:10 AM");
    expect(html).toContain("Synthetic Office");
  });
});
