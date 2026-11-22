import { expect, it } from "vitest";
import { legacyClientPresentation } from "../src/projections/client-timeline-layout";
import { canonicalPortalTimeline } from "../src/projections/canonical-timeline";
import { buildChecklistSeed } from "../src/checklist/seed";
const expected = {
  buyer: [
    "Pre-Approval",
    "Loan Application",
    "Earnest Money Due",
    "Attorney Review",
    "Home Inspections",
    "Remedies",
    "Remedies Negotiated",
    "Condo / HOA Document Review",
    "Appraisal Ordered",
    "Appraisal Completed",
    "Financing Approved / Loan Commitment",
    "Title Commitment",
    "Clear to Close",
    "Final Walkthrough",
    "Closing",
    "Possession",
  ],
  seller: [
    "Buyer's Earnest Money Deposit",
    "Attorney Review",
    "Buyer's Inspections",
    "Remedies",
    "Remedies Negotiated",
    "Condo / HOA Documents Provided",
    "Appraisal Ordered",
    "Appraisal Completed",
    "Buyer's Financing Approved",
    "Clear to Close",
    "Buyer's Final Walkthrough",
    "Closing",
    "Possession",
  ],
};
function rows(side: "buyer" | "seller", cash = false) {
  return buildChecklistSeed({
    side,
    purchaseType: cash ? "cash" : "financed",
    acceptance: null,
    timeZone: "America/New_York",
    dates: [],
  }).steps.map((step) => ({
    id: step.key,
    stepKey: step.key,
    title: step.title,
    status: step.notNeeded ? "not_applicable" : "pending",
    visibility: "client",
    dueDate: "2026-08-25",
    dueAt: null,
    dateRule: { kind: "fixed" },
    details: {
      scheduled: step.scheduled,
      note: "PRIVATE",
      showNoteToAgent: true,
      dateWording: "",
      appointmentAt: "2026-09-19T15:12:00Z",
      appointmentPlace: "Sample Title Office",
    },
  }));
}
it.each(["buyer", "seller"] as const)(
  "projects the requested %s order without mutating the working checklist",
  (side) => {
    const source = rows(side),
      before = JSON.stringify(source);
    const client = canonicalPortalTimeline(source, "client", {
      side,
      timeZone: "America/New_York",
    });
    expect(client.map((t) => t.title)).toEqual(expected[side]);
    expect(client.find((t) => t.stepKey === "inspections")).toMatchObject({
      dateLabel: "By 8/25/26",
      appointmentAt: "2026-09-19T15:12:00Z",
      appointmentPlace: "Sample Title Office",
      appointmentTimeZone: "America/New_York",
    });
    expect(
      client.find((t) => t.stepKey === "appraisal_ordered")?.scheduled,
    ).toBe(side === "seller" ? true : undefined);
    expect(JSON.stringify(client)).not.toMatch(
      /PRIVATE|dateRule|clientPosition|dateWording/,
    );
    expect(JSON.stringify(source)).toBe(before);
    const agent = canonicalPortalTimeline(source, "agent", { side });
    expect(agent.map((t) => t.title)).toEqual(source.map((t) => t.title));
    expect(agent.find((t) => t.stepKey === "inspections")).toMatchObject({
      dateLabel: "8/25/26",
      note: "PRIVATE",
    });
  },
);
it.each([
  "Received",
  "On or before 9/21",
  "Within 3 days before closing",
  "  On or before 8/30  ",
])("retains exact entered wording %j", (wording) => {
  const source = rows("buyer").filter((t) => t.stepKey === "closing");
  source[0].details.dateWording = wording;
  expect(
    canonicalPortalTimeline(source, "client", { side: "buyer" })[0].dateLabel,
  ).toBe(wording);
});
it("keeps cash defaults and audience filtering and does not revive historical rows", () => {
  const source = rows("buyer", true);
  source[2].visibility = "coordinator";
  const history = {
    ...source[0],
    id: "history",
    stepKey: null,
    title: "Closing",
  };
  const client = canonicalPortalTimeline([...source, history], "client", {
    side: "buyer",
  });
  expect(client[0].title).toBe("Proof of Funds");
  expect(
    client.some((t) =>
      ["loan_application", "loan_commitment", "earnest_money_due"].includes(
        t.stepKey!,
      ),
    ),
  ).toBe(false);
  expect(client.some((t) => t.id === "history")).toBe(false);
});
it("does not manufacture a Title deadline or expose the seller Title row", () => {
  const title = {
    ...rows("buyer")[0],
    id: "title",
    stepKey: "title_commitment",
    title: "Title Commitment",
    dueDate: null,
  };
  expect(canonicalPortalTimeline([title], "client", { side: "buyer" })).toEqual(
    [expect.objectContaining({ title: "Title Commitment", dueDate: null })],
  );
  expect(
    canonicalPortalTimeline([title], "client", { side: "seller" }),
  ).toEqual([]);
});

it("keeps the original file format's separate appointment location and exact display wording without private details", () => {
  const task = {
    title: "Buyer's Inspections",
    dueDate: "2026-08-25",
    details: {
      dateWording: "Received",
      appointmentPlace: "Sample Office",
      note: "PRIVATE",
      showNoteToAgent: true,
    },
  };
  expect(
    legacyClientPresentation(task, {
      side: "seller",
      timeZone: "America/Chicago",
    }),
  ).toEqual({
    dateLabel: "Received",
    appointmentPlace: "Sample Office",
    appointmentTimeZone: "America/Chicago",
  });
  expect(
    legacyClientPresentation({ ...task, title: "Private custom note" }),
  ).toEqual({ dateLabel: "Received" });
});
