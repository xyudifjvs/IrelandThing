import type { TransactionSide } from "@weatherly/platform/handoff-contracts";

export const checklistVersion = 1;

export type PurchaseType = "cash" | "financed" | null;

export type ChecklistStepTemplate = {
  key: string;
  title: string;
  dateCapable: boolean;
  scheduled: boolean;
  notNeeded: boolean;
};

function step(
  key: string,
  title: string,
  options: Partial<
    Pick<ChecklistStepTemplate, "dateCapable" | "scheduled" | "notNeeded">
  > = {},
): ChecklistStepTemplate {
  return {
    key,
    title,
    dateCapable: true,
    scheduled: false,
    notNeeded: false,
    ...options,
  };
}

/** Original definitions; current client presentation is in projections/client-timeline-layout. */
export function clientChecklistTemplate(
  side: TransactionSide,
  purchaseType: PurchaseType,
) {
  const cash = purchaseType === "cash";
  if (side === "seller") {
    return [
      step("attorney_review", "Attorney Review"),
      step("earnest_money_due", "Earnest Money Deposit Received"),
      step("inspections", "Buyer's Inspections", { scheduled: true }),
      step("remedies", "Remedies"),
      step("remedies_negotiated", "Remedies Negotiated"),
      step("home_warranty", "Home Warranty"),
      step("condo_hoa_docs_provided", "Condo / HOA Documents Provided"),
      step("appraisal", "Appraisal Completed", { scheduled: true }),
      step("loan_commitment", "Buyer's Financing Approved", {
        notNeeded: cash,
      }),
      step("title_commitment", "Title Commitment"),
      step("clear_to_close", "Clear to Close", { dateCapable: false }),
      step("final_walkthrough", "Buyer's Final Walkthrough", {
        scheduled: true,
      }),
      step("closing", "Closing", { scheduled: true }),
      step("possession", "Possession"),
    ];
  }

  return [
    step(
      "preapproval_pof",
      cash
        ? "Proof of Funds"
        : purchaseType === "financed"
          ? "Pre-Approval"
          : "Pre-Approval / Proof of Funds",
    ),
    step("loan_application", "Loan Application", { notNeeded: cash }),
    step("earnest_money_due", "Earnest Money Due"),
    step("attorney_review", "Attorney Review"),
    step("inspections", "Home Inspections", { scheduled: true }),
    step("remedies", "Remedies"),
    step("remedies_negotiated", "Remedies Negotiated"),
    step("condo_hoa_docs_provided", "Condo / HOA Document Provision"),
    step("condo_hoa_doc_review", "Condo / HOA Document Review"),
    step("appraisal_ordered", "Appraisal Ordered"),
    step("appraisal", "Appraisal Completed", { scheduled: true }),
    step("home_warranty_ordered", "Home Warranty Ordered"),
    step("loan_commitment", "Financing Approved / Loan Commitment", {
      notNeeded: cash,
    }),
    step("clear_to_close", "Clear to Close", { dateCapable: false }),
    step("final_walkthrough", "Final Walkthrough", { scheduled: true }),
    step("closing", "Closing", { scheduled: true }),
    step("possession", "Possession"),
  ];
}

export const remediesAnchorKey = "remedies";

/** One working checklist for both sides; only client presentation is side-specific. */
export function checklistTemplate(
  side: TransactionSide,
  purchaseType: PurchaseType,
) {
  const working = clientChecklistTemplate("buyer", purchaseType);
  working.splice(
    working.findIndex((item) => item.key === "clear_to_close"),
    0,
    step("title_commitment", "Title Commitment"),
  );
  return working.map((item) => ({
    ...item,
    // Retain the established seller warranty key so saved rules keep their anchor.
    key:
      side === "seller" && item.key === "home_warranty_ordered"
        ? "home_warranty"
        : item.key,
    scheduled:
      item.key === "appraisal_ordered"
        ? true
        : item.key === "appraisal"
          ? false
          : item.scheduled,
  }));
}
