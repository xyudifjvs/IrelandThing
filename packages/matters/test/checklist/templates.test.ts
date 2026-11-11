import { describe, expect, it } from "vitest";
import { buildChecklistSeed } from "../../src/checklist/seed";
import {
  checklistTemplate,
  checklistWorkflowDefault,
} from "../../src/checklist/templates";

const buyerTitles = [
  "Pre-Approval",
  "Loan Application",
  "Earnest Money Due",
  "Attorney Review",
  "Home Inspections",
  "Repairs Agreed On",
  "Condo / HOA Document Provision",
  "Condo / HOA Document Review",
  "Appraisal Ordered",
  "Appraisal Completed",
  "Home Warranty Ordered",
  "Financing Approved / Loan Commitment",
  "Clear to Close",
  "Final Walkthrough",
  "Closing",
  "Possession",
];

const sellerTitles = [
  "Attorney Review",
  "Earnest Money Deposit Received",
  "Buyer's Inspections",
  "Repairs Agreed On",
  "Home Warranty",
  "Condo / HOA Documents Provided",
  "Appraisal Completed",
  "Buyer's Financing Approved",
  "Title Commitment",
  "Clear to Close",
  "Buyer's Final Walkthrough",
  "Closing",
  "Possession",
];

describe("official checklist templates", () => {
  it("matches the two lists and keeps non-dated and scheduled items distinct", () => {
    const buyer = checklistTemplate("buyer", "financed");
    const seller = checklistTemplate("seller", "financed");
    expect(buyer.map(({ title }) => title)).toEqual(buyerTitles);
    expect(seller.map(({ title }) => title)).toEqual(sellerTitles);
    expect(
      buyer.filter((item) => !item.dateCapable).map(({ title }) => title),
    ).toEqual([
      "Appraisal Ordered",
      "Appraisal Completed",
      "Home Warranty Ordered",
      "Clear to Close",
    ]);
    expect(
      seller.filter((item) => !item.dateCapable).map(({ title }) => title),
    ).toEqual(["Clear to Close"]);
    expect(
      buyer.filter(({ scheduled }) => scheduled).map(({ key }) => key),
    ).toEqual(["inspections", "final_walkthrough", "closing"]);
    expect(
      seller.filter(({ scheduled }) => scheduled).map(({ key }) => key),
    ).toEqual(["final_walkthrough", "closing"]);
  });

  it("uses proof of funds for cash and skips only financing steps by default", () => {
    const cash = checklistTemplate("buyer", "cash");
    expect(cash[0].title).toBe("Proof of Funds");
    expect(
      cash.filter(({ notNeeded }) => notNeeded).map(({ key }) => key),
    ).toEqual(["loan_application", "loan_commitment"]);
    expect(checklistTemplate("buyer", null)[0].title).toBe(
      "Pre-Approval / Proof of Funds",
    );
  });

  it("keeps Remedies as a hidden anchor and uses selected signed terms over defaults", () => {
    const seed = buildChecklistSeed({
      side: "seller",
      purchaseType: "financed",
      timeZone: null,
      acceptance: null,
      dates: [
        {
          key: "closing",
          value: { date: "2026-12-10", instant: null },
          rule: { kind: "fixed" },
        },
        {
          key: "title_commitment",
          value: { date: "2026-11-27", instant: null },
          rule: { kind: "fixed" },
        },
        {
          key: "inspections",
          value: { date: "2026-11-16", instant: null },
          rule: { kind: "fixed" },
        },
        {
          key: "remedies",
          value: { date: "2026-11-19", instant: null },
          rule: { kind: "fixed" },
        },
        {
          key: "remedies_negotiated",
          value: null,
          rule: {
            kind: "relative",
            offset: {
              anchor: { kind: "step", key: "remedies" },
              amount: 3,
              unit: "days",
              counting: "calendar",
              rollover: "none",
              calendar: null,
            },
          },
        },
      ],
    });
    expect(seed.steps.map(({ title }) => title)).toEqual(sellerTitles);
    expect(
      seed.steps.find(({ key }) => key === "title_commitment")?.due?.date,
    ).toBe("2026-11-27");
    expect(
      seed.steps.find(({ key }) => key === "remedies_negotiated")?.due?.date,
    ).toBe("2026-11-22");
    expect(seed.hiddenAnchors.map(({ key, due }) => [key, due?.date])).toEqual([
      ["remedies", "2026-11-19"],
    ]);
  });

  it("offers workflow defaults for review without assigning them silently", () => {
    expect(
      checklistWorkflowDefault("seller", "title_commitment"),
    ).toMatchObject({
      label: "Workflow default",
      rule: {
        kind: "relative",
        offset: { anchor: { kind: "step", key: "closing" }, amount: -15 },
      },
    });
    expect(checklistWorkflowDefault("buyer", "title_commitment")).toBeNull();
    expect(checklistWorkflowDefault("buyer", "remedies")).toMatchObject({
      label: "Workflow default",
      rule: {
        kind: "relative",
        offset: { anchor: { kind: "step", key: "inspections" }, amount: 0 },
      },
    });
    const seed = buildChecklistSeed({
      side: "seller",
      purchaseType: null,
      timeZone: null,
      acceptance: null,
      dates: [
        {
          key: "closing",
          value: { date: "2026-12-10", instant: null },
          rule: { kind: "fixed" },
        },
        {
          key: "inspections",
          value: { date: "2026-11-16", instant: null },
          rule: { kind: "fixed" },
        },
      ],
    });
    expect(
      seed.steps.find(({ key }) => key === "title_commitment")?.due,
    ).toBeNull();
    expect(seed.hiddenAnchors[0].due).toBeNull();
  });

  it("rejects a due date on a non-dated step instead of creating a hidden deadline", () => {
    expect(() =>
      buildChecklistSeed({
        side: "buyer",
        purchaseType: "cash",
        timeZone: null,
        acceptance: null,
        dates: [
          {
            key: "appraisal",
            value: { date: "2026-11-27", instant: null },
            rule: { kind: "fixed" },
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "DATE_NOT_EDITABLE" }));
  });
});
