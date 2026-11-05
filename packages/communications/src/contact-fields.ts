import { transactionContactSources, contactRoleFamily } from "../../contacts/src/transaction-sources";
import { asRecord } from "./policy";
import type { MergeField } from "./merge-fields";

/** Frozen transaction evidence only. No directory lookup can change a draft. */
export function contactMergeFields(details: unknown, matterId: string): MergeField[] {
  const d = asRecord(details), saved = Array.isArray(d.contacts) ? d.contacts.map(asRecord) : [];
  const result: MergeField[] = [];
  for (const [family, role, prefix] of [["title", "title_rep", "title"], ["lender", "loan_officer", "lender"], ["coop", "co_op_agent", "coOpAgent"]] as const) {
    const sources = transactionContactSources(d, role);
    const reviewed = saved.filter(c => contactRoleFamily(String(c.role)) === family && c.reviewedSourceConflict === true && typeof c.sourceConflictReason === "string" && c.sourceConflictReason.trim());
    const signature=(items:unknown[])=>JSON.stringify(items.map(item=>{const c=asRecord(item);return [c.source,...["name","company","email","phone"].map(key=>String(c[key]||'').trim())];}).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
    const prior=Array.isArray(reviewed[0]?.priorSourceSnapshot)?reviewed[0].priorSourceSnapshot:[];
    const boundReview=reviewed.length===1&&Array.isArray(reviewed[0].priorSourceSnapshot)&&signature(prior.filter(c=>asRecord(c).source!=="Entered contact"))===signature(sources.filter(c=>c.contactId!==reviewed[0].id));
    // An explicit coordinator correction replaces the intake evidence only when
    // one unambiguous corrected contact exists. Multiple representatives stay ambiguous.
    const effective = boundReview && sources.filter(s=>s.source === "Existing coordinator contact").length === 1
      ? [{ ...reviewed[0], source: "Reviewed transaction snapshot", contactId: String(reviewed[0].id) }]
      : sources;
    for (const prop of ["name", "company", "email", "phone"] as const) {
      const values = [...new Set(effective.map(c=>typeof asRecord(c)[prop] === "string" ? String(asRecord(c)[prop]).trim() : "").filter(Boolean))];
      const key = prefix + prop[0].toUpperCase() + prop.slice(1);
      result.push({key, label: `${family === "coop" ? "Co-op agent" : family} ${prop}`, value: values.length === 1 ? values[0] : null, status: values.length > 1 ? "ambiguous" : values.length === 1 ? "confirmed" : "unknown", sourceIds: [...new Set([matterId,...effective.map(c=>String(c.contactId||"")).filter(Boolean)])]});
    }
  }
  for (const [alias,key] of Object.entries({title_contact:"titleName",title_company:"titleCompany",title_email:"titleEmail",title_phone:"titlePhone",loan_officer:"lenderName",lender_company:"lenderCompany",lender_email:"lenderEmail",lender_phone:"lenderPhone",co_op_agent:"coOpAgentName",co_op_brokerage:"coOpAgentCompany",co_op_email:"coOpAgentEmail",co_op_phone:"coOpAgentPhone"})) {
    const field=result.find(f=>f.key===key)!;result.push({...field,key:alias});
  }
  return result;
}
