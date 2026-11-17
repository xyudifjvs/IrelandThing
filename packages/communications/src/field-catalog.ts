import workbook from "./workbook-fields.json";

export type FieldSource =
  | { kind: "legacy"; key: string }
  | { kind: "details"; key: string }
  | {
      kind: "checklist";
      stepKey: string;
      property:
        | "date"
        | "wording"
        | "status"
        | "amount"
        | "holder"
        | "company"
        | "schedule";
    }
  | {
      kind: "person";
      role: string;
      property:
        "name" | "first_name" | "email" | "phone" | "company" | "contact_info";
    }
  | { kind: "intake"; key: string }
  | {
      kind: "agent";
      property:
        | "name"
        | "first_name"
        | "email"
        | "phone"
        | "brokerage"
        | "contact_info";
    }
  | { kind: "settings"; key: "name" | "signature" | "reviewLink" }
  | {
      kind: "transaction";
      property:
        | "propertyAddress"
        | "purchasePrice"
        | "acceptanceDate"
        | "packageName"
        | "deadlines"
        | "mlsInstructions";
    }
  | { kind: "company"; kindOfCompany: "title" | "brokerage" }
  | { kind: "unsupported"; reason: string };

export type FieldDefinition = {
  key: string;
  label: string;
  comesFrom: string;
  side: "buyer" | "seller" | "both";
  source: FieldSource;
};
export const detailFields = [
  ["utility_list", "Utility providers", "both"],
  ["closing_preferences", "Closing preferences", "buyer"],
  ["access_details", "Access details", "seller"],
  ["repair_agreement_summary", "Repair agreement summary", "seller"],
  ["signing_preference", "Signing preference", "seller"],
  ["seller_forwarding_address", "Seller forwarding address", "seller"],
  ["buyer_agent_commission", "Buyer-agent commission", "both"],
] as const;

const sources: Record<string, FieldSource> = {
  property_address: { kind: "transaction", property: "propertyAddress" },
  deadlines: { kind: "transaction", property: "deadlines" },
  tc_name: { kind: "settings", key: "name" },
  tc_signature: { kind: "settings", key: "signature" },
  review_link: { kind: "settings", key: "reviewLink" },
  title_closing_info: { kind: "company", kindOfCompany: "title" },
  commission_wiring_instructions: {
    kind: "company",
    kindOfCompany: "brokerage",
  },
  buyer_fee: { kind: "intake", key: "fee" },
  seller_fee: { kind: "intake", key: "fee" },
  listing_commission: { kind: "intake", key: "listcomm" },
  possession_terms: {
    kind: "checklist",
    stepKey: "possession",
    property: "wording",
  },
  mls_closing_instructions: {
    kind: "transaction",
    property: "mlsInstructions",
  },
};
for (const [key] of detailFields) sources[key] = { kind: "details", key };
for (const [key, stepKey, property] of [
  ["emd_amount", "earnest_money_due", "amount"],
  ["emd_holder", "earnest_money_due", "holder"],
  ["emd_due_date", "earnest_money_due", "date"],
  ["hoa_review_deadline", "condo_hoa_doc_review", "date"],
  ["closing_date", "closing", "date"],
  ["closing_terms", "closing", "wording"],
  ["walkthrough_deadline", "final_walkthrough", "date"],
  ["walkthrough_terms", "final_walkthrough", "wording"],
  ["inspection_scheduled", "inspections", "schedule"],
  ["walkthrough_scheduled", "final_walkthrough", "schedule"],
  ["closing_scheduled", "closing", "schedule"],
  ["appraisal_scheduled", "appraisal", "schedule"],
  ["loan_app_deadline", "loan_application", "date"],
  ["inspection_deadline", "inspections", "date"],
  ["remedy_deadline", "remedies_negotiated", "date"],
  ["remedy_request_deadline", "remedies", "date"],
  ["loan_commitment_deadline", "loan_commitment", "date"],
  ["preapproval_status", "preapproval_pof", "status"],
  ["attorney_review_deadline", "attorney_review", "date"],
  ["warranty_deadline", "home_warranty", "date"],
  ["warranty_company", "home_warranty", "company"],
  ["warranty_amount", "home_warranty", "amount"],
  ["appraisal_ordered_deadline", "appraisal_ordered", "date"],
  ["title_commitment_deadline", "title_commitment", "date"],
  ["hoa_provision_deadline", "condo_hoa_docs_provided", "date"],
] as const)
  sources[key] = { kind: "checklist", stepKey, property };
for (const [prefix, role] of [
  ["coop_agent", "coop"],
  ["title_rep", "title"],
  ["lender", "lender"],
] as const)
  for (const property of [
    "name",
    "first_name",
    "email",
    "phone",
    "company",
    "contact_info",
  ] as const)
    sources[`${prefix}_${property}`] = { kind: "person", role, property };
sources.title_rep = { kind: "person", role: "title", property: "name" };
sources.title_company = { kind: "person", role: "title", property: "company" };
sources.coop_agent_brokerage = {
  kind: "person",
  role: "coop",
  property: "company",
};
sources.lender_info = {
  kind: "person",
  role: "lender",
  property: "contact_info",
};
sources.client_names = { kind: "person", role: "client", property: "name" };
sources.client_first_names = {
  kind: "person",
  role: "client",
  property: "first_name",
};
sources.client_contact_info = {
  kind: "person",
  role: "client",
  property: "contact_info",
};
sources.buyer_names = { kind: "person", role: "buyer", property: "name" };
for (const property of [
  "name",
  "first_name",
  "email",
  "phone",
  "brokerage",
  "contact_info",
] as const)
  sources[`agent_${property}`] = { kind: "agent", property };

export const fieldCatalog: FieldDefinition[] = workbook
  .filter((row) => row.key !== "repair_completion_deadline")
  .map((row) => ({
    ...row,
    side:
      detailFields.find(([key]) => key === row.key)?.[2] ??
      (row.key === "buyer_fee"
        ? "buyer"
        : row.key === "seller_fee"
          ? "seller"
          : "both"),
    source: sources[row.key] ?? {
      kind: "unsupported",
      reason: "No unambiguous saved source is configured.",
    },
    ...(row.key === "buyer_agent_commission"
      ? {
          label: "Buyer-agent commission",
          comesFrom: "Transaction commission area (you type it)",
        }
      : row.key === "possession_terms"
        ? { comesFrom: "Possession checklist step" }
        : {}),
  }));

// Distinct existing fields remain available alongside the workbook's renamed fields.
export const historicalFields: FieldDefinition[] = [
  {
    key: "recipient_name",
    label: "Recipient greeting name (per email)",
    comesFrom: "Composer greeting",
    side: "both",
    source: { kind: "legacy", key: "recipient_name" },
  },
  {
    key: "possession_date",
    label: "Possession date",
    comesFrom: "Checklist",
    side: "both",
    source: { kind: "checklist", stepKey: "possession", property: "date" },
  },
  {
    key: "appraisal_deadline",
    label: "Appraisal completion date",
    comesFrom: "Checklist",
    side: "both",
    source: { kind: "checklist", stepKey: "appraisal", property: "date" },
  },
  {
    key: "closing_appointment_place",
    label: "Closing appointment place",
    comesFrom: "Checklist appointment",
    side: "both",
    source: { kind: "legacy", key: "closing_appointment_place" },
  },
  {
    key: "purchase_price",
    label: "Purchase price",
    comesFrom: "Transaction",
    side: "both",
    source: { kind: "transaction", property: "purchasePrice" },
  },
  {
    key: "acceptance_date",
    label: "Acceptance date",
    comesFrom: "Transaction",
    side: "both",
    source: { kind: "transaction", property: "acceptanceDate" },
  },
  {
    key: "package_name",
    label: "Service package",
    comesFrom: "Transaction",
    side: "both",
    source: { kind: "transaction", property: "packageName" },
  },
];

export const fieldAliases: Record<string, string> = {
  propertyAddress: "property_address",
  clientName: "client_names",
  clientNames: "client_names",
  client_name: "client_names",
  agentName: "agent_name",
  agentEmail: "agent_email",
  coordinatorName: "tc_name",
  recipientName: "recipient_name",
  closingDate: "closing_date",
  earnestMoneyDate: "emd_due_date",
  acceptanceDate: "acceptance_date",
  inspectionDate: "inspection_deadline",
  hoaDate: "hoa_provision_deadline",
  titleDate: "title_commitment_deadline",
  appraisalDate: "appraisal_deadline",
  loanCommitmentDate: "loan_commitment_deadline",
  possessionDate: "possession_date",
  purchasePrice: "purchase_price",
  packageName: "package_name",
  closingAppointmentAt: "closing_scheduled",
  closingAppointmentPlace: "closing_appointment_place",
  titleName: "title_rep",
  titleCompany: "title_company",
  titleEmail: "title_rep_email",
  titlePhone: "title_rep_phone",
  title_contact: "title_rep",
  title_email: "title_rep_email",
  title_phone: "title_rep_phone",
  lenderName: "lender_name",
  lenderCompany: "lender_company",
  lenderEmail: "lender_email",
  lenderPhone: "lender_phone",
  loan_officer: "lender_name",
  coOpAgentName: "coop_agent_name",
  coOpAgentCompany: "coop_agent_brokerage",
  coOpAgentEmail: "coop_agent_email",
  coOpAgentPhone: "coop_agent_phone",
  co_op_agent: "coop_agent_name",
  co_op_brokerage: "coop_agent_brokerage",
  co_op_email: "coop_agent_email",
  co_op_phone: "coop_agent_phone",
  custom_geo_info: "geo_info",
};
for (const field of fieldCatalog) {
  if (field.source.kind !== "checklist") continue;
  if (field.source.property === "date")
    for (const prefix of ["date", "task", "deadline"])
      fieldAliases[`${prefix}_${field.source.stepKey}`] = field.key;
}
const oldDateNames: Record<string, string> = {
  closing: "closing_date",
  closing_date: "closing_date",
  earnest_money: "emd_due_date",
  earnest_money_due: "emd_due_date",
  earnest_money_emd: "emd_due_date",
  emd: "emd_due_date",
  inspections: "inspection_deadline",
  home_inspections: "inspection_deadline",
  inspection: "inspection_deadline",
  inspection_deadline: "inspection_deadline",
  title_commitment: "title_commitment_deadline",
  appraisal: "appraisal_deadline",
  appraisal_completed: "appraisal_deadline",
  financing_approved_loan_commitment: "loan_commitment_deadline",
  loan_commitment: "loan_commitment_deadline",
  financing_commitment: "loan_commitment_deadline",
  condo_hoa_docs_provided: "hoa_provision_deadline",
  condo_hoa_document_provision: "hoa_provision_deadline",
  condo_hoa_doc_review: "hoa_review_deadline",
  condo_hoa_document_review: "hoa_review_deadline",
  final_walkthrough: "walkthrough_deadline",
  buyers_final_walkthrough: "walkthrough_deadline",
  remedies: "remedy_request_deadline",
  remedies_negotiated: "remedy_deadline",
  repairs_agreed_on: "remedy_deadline",
  possession: "possession_date",
  possession_date_and_time: "possession_date",
  attorney_review: "attorney_review_deadline",
  loan_application: "loan_app_deadline",
};
for (const [old, key] of Object.entries(oldDateNames))
  for (const prefix of ["date", "task", "deadline"])
    fieldAliases[`${prefix}_${old}`] = key;

export function canonicalFieldKey(key: string) {
  if (Object.hasOwn(fieldAliases, key)) return fieldAliases[key];
  const legacy = key.match(/^(?:date|task|deadline)_(.+)$/);
  return legacy ? `${legacy[1]}_date` : key;
}
export function normalizeFieldCodes(text: string) {
  return text.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, key: string) => `{{${canonicalFieldKey(key)}}}`,
  );
}
export const fieldKeyPattern = /^[a-z][a-z0-9_]{0,79}$/;
export const reservedFieldKeys = new Set([
  "constructor",
  "prototype",
  "__proto__",
]);
export function formatEmailDate(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match
    ? `${Number(match[2])}/${Number(match[3])}/${match[1].slice(-2)}`
    : value || "";
}
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || "";
