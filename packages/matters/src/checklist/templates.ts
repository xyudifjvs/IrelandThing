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

export function checklistTemplate(
  side: TransactionSide,
  purchaseType: PurchaseType,
) {
  const cash = purchaseType === "cash";
  if (side === "seller") {
    return [
      step("attorney_review", "Attorney Review"),
      step("earnest_money_due", "Earnest Money Deposit Received"),
      step("inspections", "Buyer's Inspections"),
      step("remedies_negotiated", "Repairs Agreed On"),
      step("home_warranty", "Home Warranty"),
      step("condo_hoa_docs_provided", "Condo / HOA Documents Provided"),
      step("appraisal", "Appraisal Completed"),
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
    step("remedies_negotiated", "Repairs Agreed On"),
    step("condo_hoa_docs_provided", "Condo / HOA Document Provision"),
    step("condo_hoa_doc_review", "Condo / HOA Document Review"),
    step("appraisal_ordered", "Appraisal Ordered", { dateCapable: false }),
    step("appraisal", "Appraisal Completed", { dateCapable: false }),
    step("home_warranty_ordered", "Home Warranty Ordered", {
      dateCapable: false,
    }),
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
