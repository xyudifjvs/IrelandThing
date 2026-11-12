import { extractionDateKeySchema } from "./proposal";

export const creationPromptVersion = "creation-signed-terms-v1";

// The verbatim handoff is kept in prompts/creation-handoff-original.txt.
export const creationRuntimePrompt = `Read the pinned U.S. residential purchase contract packet and return the requested structured proposals. Ireland reviews them before any transaction is created.

Use only the documents supplied. Determine which offer or counteroffer was finally accepted using the signature and acceptance evidence in the packet. Later signed terms supersede earlier conflicting terms. An unsigned or ambiguous revision is not a confirmed change. Leave an uncertain or missing field null or omit its date entry. For each fact or deadline cite its exact quotation, page number and source version ID from the packet.

Acceptance means the date the last party signed the final accepted offer or counteroffer. For a fixed deadline, quote its full civil date. For dollar amounts, quote the amount in the controlling term.

Use the express signed Remedies and Title Commitment terms when they differ from any workflow defaults. Never invent a same-day or 15-day contract term. Remedies means the request to remedy, while remedies_negotiated means the deadline to reach agreement. Use the actual delivery event, not its due date, as the event anchor for HOA document review. Represent an earlier-of rule with both offsets.

Keep exact hours and their timezone where documented. Do not convert hours to days. Use a fixed civil date when stated. For a relative term, provide its signed offset, anchor, unit, counting policy and any stated calendar and rollover. Mark missing counting or rollover information as unspecified. Do not calculate dates from relative rules. For exact instants include the stated offset only when the source establishes it.

Interpret the deadline keys as follows:
- preapproval_pof: buyer delivers the preapproval letter or proof of funds.
- loan_application: buyer applies for the loan or names the lender.
- earnest_money_due: earnest money deposit is due.
- attorney_review: attorney approval period ends. Leave it blank when the contract does.
- inspections: inspection period ends.
- remedies: request to remedy is due.
- remedies_negotiated: period to reach a written remedies agreement ends.
- condo_hoa_docs_provided: seller must supply condo or HOA documents, when applicable.
- condo_hoa_doc_review: buyer's document review period ends. Use the actual delivery event when the term runs from receipt.
- appraisal: use a stated fixed date or a rule from acceptance. Leave blank when it only runs from appraisal receipt.
- loan_commitment: buyer delivers the loan commitment.
- title_commitment: title commitment is due under the controlling signed terms.
- final_walkthrough: final verification of property condition. Use the signed closing-relative rule where stated.
- closing: closing date.
- possession: date the buyer takes possession.

Return purchase price, earnest money and warranty amounts as integer cents. Leave warranty fields blank if the final signed terms remove the warranty. Return buyer and seller names separately. Allowed deadline keys: ${extractionDateKeySchema.options.join(", ")}.`;
