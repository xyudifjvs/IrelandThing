import { describe, expect, it } from "vitest";
import {
  clientTimelineTasks,
  nextDatedSteps,
  portalTimelineOrder,
  type PortalTask,
} from "../../apps/web/app/(portal)/portal/_views/portal-model";

const step = (
  stepKey: string,
  dueDate: string | null = null,
  status = "pending",
): PortalTask => ({ id: stepKey, stepKey, title: stepKey, status, dueDate });
const keys = (rows: readonly PortalTask[]) => rows.map((row) => row.stepKey);

describe("portal-only chronological ordering", () => {
  it("sorts real dates while retaining process slots for undated steps and pinning Closing/Possession", () => {
    const tasks = [
      step("loan_application", "2026-12-07", "completed"),
      step("earnest_money_due", "2026-12-01"),
      step("inspections", "2026-12-04"),
      step("appraisal_ordered"),
      step("appraisal"),
      step("loan_commitment", "2026-12-10"),
      step("clear_to_close"),
      { ...step("final_walkthrough"), dateLabel: "Within 3 days of closing" },
      step("closing", "2026-11-01"),
      step("possession", "2026-10-01"),
    ];
    const before = JSON.stringify(tasks);
    expect(keys(portalTimelineOrder(tasks))).toEqual([
      "earnest_money_due",
      "inspections",
      "loan_application",
      "appraisal_ordered",
      "appraisal",
      "loan_commitment",
      "clear_to_close",
      "final_walkthrough",
      "closing",
      "possession",
    ]);
    expect(JSON.stringify(tasks)).toBe(before);
  });
  it("retains stable process order on ties, all-undated files and conflicting process neighbors", () => {
    expect(
      keys(
        portalTimelineOrder([
          step("inspections", "2026-12-01"),
          step("remedies", "2026-12-01"),
          step("appraisal"),
          step("title_commitment", "2026-11-30"),
        ]),
      ),
    ).toEqual(["appraisal", "title_commitment", "inspections", "remedies"]);
    const undated = [
      step("appraisal_ordered"),
      step("appraisal"),
      step("clear_to_close"),
      step("closing"),
      step("possession"),
    ];
    expect(portalTimelineOrder(undated)).toEqual(undated);
  });
  it.each(["buyer", "seller"])(
    "sorts the %s audience-approved rows without reviving hidden steps",
    (side) => {
      const rows = clientTimelineTasks(
        [
          step("loan_application", "2026-12-10"),
          step("earnest_money_due", "2026-12-02", "completed"),
          step("inspections", "2026-12-01"),
          step("home_warranty_ordered", "2026-11-01"),
          step("remedies", "2026-11-02", "not_applicable"),
          step("appraisal"),
          step("closing", "2026-10-01"),
        ],
        side,
      );
      expect(keys(rows)).toEqual([
        "inspections",
        "earnest_money_due",
        ...(side === "buyer" ? ["loan_application"] : []),
        "appraisal",
        "closing",
      ]);
    },
  );
  it("uses every tie at the earliest saved open date, ignoring wording, appointment times and completed/skipped steps", () => {
    const rows = [
      step("loan_application", "2026-11-01", "completed"),
      step("attorney_review", "2026-11-02", "not_applicable"),
      { ...step("appraisal_ordered"), appointmentAt: "2026-10-01T12:00:00Z" },
      { ...step("final_walkthrough"), dateLabel: "By 10/1/26" },
      { ...step("inspections", "2026-12-01"), dateLabel: "Received" },
      step("remedies", "2026-12-01"),
      step("title_commitment", "2026-12-01"),
      step("closing", "2026-12-10"),
    ];
    expect(keys(nextDatedSteps(rows))).toEqual([
      "inspections",
      "remedies",
      "title_commitment",
    ]);
    expect(
      nextDatedSteps([step("appraisal"), step("bad-date", "2026-02-31")]),
    ).toEqual([]);
    expect(nextDatedSteps()).toEqual([]);
  });
});
