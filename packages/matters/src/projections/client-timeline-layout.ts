/** Client presentation only. The coordinator checklist and email sources stay intact. */
export function clientTimelineLayout(side?: string) {
  return side === "seller"
    ? [
        ["earnest_money_due", "Buyer's Earnest Money Deposit"],
        ["attorney_review", "Attorney Review"],
        ["inspections", "Buyer's Inspections"],
        ["remedies", "Remedies"],
        ["remedies_negotiated", "Remedies Negotiated"],
        ["condo_hoa_docs_provided", "Condo / HOA Documents Provided"],
        ["appraisal_ordered", "Appraisal Ordered"],
        ["appraisal", "Appraisal Completed"],
        ["loan_commitment", "Buyer's Financing Approved"],
        ["clear_to_close", "Clear to Close"],
        ["final_walkthrough", "Buyer's Final Walkthrough"],
        ["closing", "Closing"],
        ["possession", "Possession"],
      ]
    : [
        ["preapproval_pof", "Pre-Approval / Proof of Funds"],
        ["loan_application", "Loan Application"],
        ["earnest_money_due", "Earnest Money Due"],
        ["attorney_review", "Attorney Review"],
        ["inspections", "Home Inspections"],
        ["remedies", "Remedies"],
        ["remedies_negotiated", "Remedies Negotiated"],
        ["condo_hoa_doc_review", "Condo / HOA Document Review"],
        ["appraisal_ordered", "Appraisal Ordered"],
        ["appraisal", "Appraisal Completed"],
        ["loan_commitment", "Financing Approved / Loan Commitment"],
        ["title_commitment", "Title Commitment"],
        ["clear_to_close", "Clear to Close"],
        ["final_walkthrough", "Final Walkthrough"],
        ["closing", "Closing"],
        ["possession", "Possession"],
      ];
}

const aliases: Record<string, string> = {
  pre_approval: "preapproval_pof",
  pre_approval_proof_of_funds: "preapproval_pof",
  proof_of_funds: "preapproval_pof",
  earnest_money_deposit_received: "earnest_money_due",
  buyer_s_earnest_money_deposit: "earnest_money_due",
  inspections: "inspections",
  home_inspections: "inspections",
  buyer_s_inspections: "inspections",
  appraisal_completed: "appraisal",
  financing_approved_loan_commitment: "loan_commitment",
  buyer_s_financing_approved: "loan_commitment",
  buyer_s_final_walkthrough: "final_walkthrough",
  condo_hoa_documents_provided: "condo_hoa_docs_provided",
  condo_hoa_document_provision: "condo_hoa_docs_provided",
  condo_hoa_document_review: "condo_hoa_doc_review",
  home_warranty_ordered: "home_warranty_ordered",
  home_warranty: "home_warranty",
};
const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, "_")
    .replace(/^_|_$/g, "");
const standardKeys = new Set(
  [
    ...clientTimelineLayout("buyer"),
    ...clientTimelineLayout("seller"),
    ["home_warranty"],
    ["home_warranty_ordered"],
    ["condo_hoa_docs_provided"],
  ].map(([key]) => key),
);

export function clientStepKey(task: {
  stepKey?: string | null;
  title: string;
}) {
  const title = normalize(task.title);
  return (
    task.stepKey ||
    aliases[title] ||
    (standardKeys.has(title) ? title : undefined)
  );
}

/** Keep audience-approved custom steps after the standard client sequence. */
export function selectClientTimeline<
  T extends { stepKey?: string | null; title: string },
>(tasks: readonly T[], side?: string) {
  const layout = clientTimelineLayout(side);
  const titles = new Map(layout.map(([key, title]) => [key, title]));
  const positions = new Map(layout.map(([key], index) => [key, index]));
  return tasks
    .map((task) => ({ ...task, stepKey: clientStepKey(task) }))
    .filter(
      (task) =>
        !task.stepKey ||
        !standardKeys.has(task.stepKey) ||
        titles.has(task.stepKey),
    )
    .map((task) => ({
      ...task,
      title:
        task.stepKey === "preapproval_pof" &&
        ["Pre-Approval", "Proof of Funds"].includes(task.title)
          ? task.title
          : titles.get(task.stepKey || "") || task.title,
    }))
    .sort(
      (a, b) =>
        (positions.get(a.stepKey || "") ?? layout.length) -
        (positions.get(b.stepKey || "") ?? layout.length),
    );
}

export function clientDateLabel(task: {
  dueDate?: string | null;
  details?: unknown;
}) {
  const data =
    task.details &&
    typeof task.details === "object" &&
    !Array.isArray(task.details)
      ? (task.details as Record<string, unknown>)
      : {};
  if (typeof data.dateWording === "string" && data.dateWording.trim())
    return data.dateWording;
  const match = task.dueDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match
    ? `By ${Number(match[2])}/${Number(match[3])}/${match[1].slice(-2)}`
    : "";
}

/** Safe client presentation fields for the original, unversioned file format. */
export function legacyClientPresentation(
  task: {
    title: string;
    stepKey?: string | null;
    dueDate?: string | null;
    details?: unknown;
  },
  context: { side?: string; timeZone?: string | null } = {},
) {
  const label = clientDateLabel(task);
  const key = clientStepKey(task);
  const scheduled =
    ["inspections", "final_walkthrough", "closing"].includes(key || "") ||
    (context.side === "seller" && key === "appraisal_ordered");
  const data =
    task.details &&
    typeof task.details === "object" &&
    !Array.isArray(task.details)
      ? (task.details as Record<string, unknown>)
      : {};
  return {
    ...(label ? { dateLabel: label } : {}),
    ...(scheduled
      ? {
          appointmentTimeZone: context.timeZone || "America/New_York",
          ...(typeof data.appointmentPlace === "string"
            ? { appointmentPlace: data.appointmentPlace }
            : {}),
        }
      : {}),
  };
}
