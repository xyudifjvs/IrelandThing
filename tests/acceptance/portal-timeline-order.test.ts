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
  it.each([null, "2026-11-01", "2026-12-31"])(
    "keeps completed Pre-Approval/Proof of Funds first with saved date %s",
    (date) => {
      const tasks = [
        step("inspections", "2026-12-01"),
        {
          ...step("preapproval_pof", date, "completed"),
          dateLabel: "Received",
        },
        step("loan_application", "2026-11-25"),
        step("closing", "2026-10-01"),
      ];
      expect(keys(portalTimelineOrder(tasks))).toEqual([
        "preapproval_pof",
        "loan_application",
        "inspections",
        "closing",
      ]);
      const datedNext = nextDatedSteps(portalTimelineOrder(tasks));
      expect(keys(datedNext)).toEqual(["closing"]);
      expect(portalTimelineOrder(tasks)[0]).toEqual(tasks[1]);
    },
  );
  it("recognizes older Proof of Funds titles without a step key", () => {
    for (const title of [
      "Proof of Funds",
      "Pre-Approval",
      "Pre-Approval / Proof of Funds",
    ]) {
      const pof = {
        id: "pof",
        title,
        status: "pending",
        dateLabel: "Received",
      };
      expect(
        portalTimelineOrder([step("inspections", "2026-12-01"), pof])[0],
      ).toBe(pof);
    }
  });
  it("keeps HOA Provision then Review adjacent at the pair's earliest date without changing next deadlines", () => {
    const tasks = [
      step("loan_application", "2026-12-04"),
      step("condo_hoa_docs_provided", "2026-12-07", "completed"),
      step("inspections", "2026-12-01"),
      step("condo_hoa_doc_review", "2026-12-01"),
      step("title_commitment", "2026-12-01"),
      step("closing", "2026-12-20"),
      step("possession", "2026-12-21"),
    ];
    const before = JSON.stringify(tasks);
    const result = portalTimelineOrder(tasks);
    expect(keys(result)).toEqual([
      "condo_hoa_docs_provided",
      "condo_hoa_doc_review",
      "inspections",
      "title_commitment",
      "loan_application",
      "closing",
      "possession",
    ]);
    expect(keys(nextDatedSteps(result))).toEqual([
      "condo_hoa_doc_review",
      "inspections",
      "title_commitment",
    ]);
    expect(JSON.stringify(tasks)).toBe(before);
    expect(
      result.find((task) => task.stepKey === "condo_hoa_docs_provided")
        ?.dueDate,
    ).toBe("2026-12-07");
  });
  it.each([null, "2026-12-03"])(
    "keeps the HOA pair together when Provision is undated and Review is %s",
    (reviewDate) => {
      const tasks = [
        step("inspections", "2026-12-01"),
        step("condo_hoa_doc_review", reviewDate),
        step("condo_hoa_docs_provided"),
        step("loan_commitment", "2026-12-10"),
      ];
      expect(keys(portalTimelineOrder(tasks))).toEqual([
        "inspections",
        "condo_hoa_docs_provided",
        "condo_hoa_doc_review",
        "loan_commitment",
      ]);
    },
  );
  it.each(["buyer", "seller"])(
    "keeps the %s client HOA filter and only pins Pre-Approval when audience-visible",
    (side) => {
      const result = clientTimelineTasks(
        [
          step("preapproval_pof", "2026-12-31"),
          step("earnest_money_due", "2026-12-01"),
          step("condo_hoa_docs_provided", "2026-12-03"),
          step("condo_hoa_doc_review", "2026-12-04"),
          step("attorney_review", "2026-11-01", "not_applicable"),
        ],
        side,
      );
      expect(keys(result)).toEqual(
        side === "buyer"
          ? ["preapproval_pof", "earnest_money_due", "condo_hoa_doc_review"]
          : ["earnest_money_due", "condo_hoa_docs_provided"],
      );
      expect(keys(nextDatedSteps(result))).toEqual(["earnest_money_due"]);
    },
  );
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
