# Weatherly merge fields — November 17, 2026

Source: `Weatherly_Merge_Fields.xlsx`, Fill-In Fields sheet, rows 2–73. The canceled prior email workbook and ten-item prompt were not implemented.

Greetings use the first word of the saved full name. Commission wiring instructions are shared by normalized exact brokerage name. Company instructions are saved in Settings; they do not change transaction contact snapshots.

## Field codes

Use these codes in subjects, templates, or scratch emails. Dates render as M/D/YY; manually entered date wording is retained except `closing_date`, which stays a date. Custom text keeps line breaks.

| Code | Fills in | Source |
| --- | --- | --- |
| `{{client_names}}` | Full names of your clients (buyers on the buyer side, sellers on the seller side) | People on this deal |
| `{{client_first_names}}` | Your clients' first names for greetings | People on this deal |
| `{{property_address}}` | Property address | Contract |
| `{{agent_name}}` | Your agent (buyer's agent on the buyer side, listing agent on the seller side) | Agent profile |
| `{{coop_agent_name}}` | Agent on the other side (listing agent on the buyer side, buyer's agent on the seller side) | People on this deal |
| `{{title_company}}` | Title company name | People on this deal |
| `{{title_rep}}` | Title rep name | People on this deal |
| `{{title_rep_email}}` | Title rep email | People on this deal |
| `{{title_rep_phone}}` | Title rep phone | People on this deal |
| `{{lender_name}}` | Loan officer name | People on this deal |
| `{{deadlines}}` | List of contract deadlines from the checklist | Checklist |
| `{{emd_amount}}` | Earnest money amount | Checklist (Earnest Money step) |
| `{{emd_holder}}` | Who holds the earnest money | Checklist (Earnest Money step) |
| `{{emd_due_date}}` | EMD deadline | Checklist |
| `{{hoa_review_deadline}}` | HOA document review deadline | Checklist |
| `{{utility_list}}` | Utility providers for the property | Details (you type it) |
| `{{closing_date}}` | Closing date only (e.g. for "transfer into your name on 9/21/26") | Checklist |
| `{{walkthrough_deadline}}` | Latest date for the walkthrough per contract | Checklist |
| `{{inspection_scheduled}}` | Scheduled inspection details | Checklist (Schedule) |
| `{{walkthrough_scheduled}}` | Scheduled walkthrough details | Checklist (Schedule) |
| `{{closing_scheduled}}` | Scheduled closing details | Checklist (Schedule) |
| `{{review_link}}` | Link where clients leave a review | Settings |
| `{{tc_name}}` | Your name | Settings |
| `{{tc_signature}}` | Your full sign-off and signature block | Settings |
| `{{loan_app_deadline}}` | Loan application deadline | Checklist |
| `{{inspection_deadline}}` | End of inspection period | Checklist |
| `{{remedy_deadline}}` | Deadline to agree on remedies | Checklist |
| `{{loan_commitment_deadline}}` | Loan commitment deadline | Checklist |
| `{{walkthrough_terms}}` | Walkthrough timing, using the wording on the checklist | Checklist (Final Walkthrough step wording) |
| `{{possession_terms}}` | Possession timing per contract | Possession checklist step |
| `{{title_closing_info}}` | Title company's closing hours and locations, saved once per title company | Title company contact (saved once) |
| `{{agent_first_name}}` | Your agent's first name | Agent profile |
| `{{coop_agent_first_name}}` | Other side's agent's first name | People on this deal |
| `{{lender_company}}` | Lender's company | People on this deal |
| `{{lender_email}}` | Loan officer's email | People on this deal |
| `{{warranty_company}}` | Home warranty company | Checklist (Home Warranty step) |
| `{{mls_closing_instructions}}` | Buyer's agent's instructions for closing out the listing in the MLS, from the intake form | Intake |
| `{{title_rep_first_name}}` | Title rep's first name | People on this deal |
| `{{lender_first_name}}` | Loan officer's first name | People on this deal |
| `{{client_contact_info}}` | Your clients' names, emails and phone numbers, one line each | People on this deal |
| `{{agent_contact_info}}` | Buyer's agent's email and phone | Agent profile |
| `{{coop_agent_contact_info}}` | Other side's agent's email and phone | People on this deal |
| `{{closing_preferences}}` | Buyers' preferred closing location and times, from their reply to Closing Prep | Details (you type it) |
| `{{preapproval_status}}` | Pre-approval letter status | Checklist |
| `{{attorney_review_deadline}}` | Attorney review deadline | Checklist |
| `{{remedy_request_deadline}}` | Deadline to submit remedies (repair requests) | Checklist |
| `{{warranty_deadline}}` | Home warranty order deadline | Checklist |
| `{{appraisal_ordered_deadline}}` | Deadline for the appraisal to be ordered | Checklist |
| `{{title_commitment_deadline}}` | Title commitment deadline | Checklist |
| `{{buyer_fee}}` | Brokerage fee charged to the buyer (buyer side), from the intake | Intake |
| `{{agent_brokerage}}` | Your agent's brokerage, from their profile | Agent profile |
| `{{agent_phone}}` | Your agent's phone, from their profile | Agent profile |
| `{{agent_email}}` | Your agent's email, from their profile | Agent profile |
| `{{lender_info}}` | Buyer's lender name, company, email and phone (N/A on cash deals) | People on this deal |
| `{{commission_wiring_instructions}}` | How title gets commission wiring instructions, saved once per agent or brokerage | Agent profile (saved once per agent or brokerage) |
| `{{buyer_names}}` | Buyers' full names (seller side) | People on this deal |
| `{{hoa_provision_deadline}}` | Deadline for the seller to provide HOA documents (seller side) | Checklist |
| `{{access_details}}` | How the buyer's inspector, appraiser or agent gets in (seller side) | Details (you type it) |
| `{{repair_agreement_summary}}` | What was agreed in the inspection addendum (seller side) | Details (you type it) |
| `{{appraisal_scheduled}}` | Scheduled appraisal details (seller side) | Checklist (Schedule) |
| `{{signing_preference}}` | How the sellers will sign: in person, mail-away or remote (seller side) | Details (you type it) |
| `{{seller_forwarding_address}}` | Sellers' forwarding address (seller side) | Details (you type it) |
| `{{seller_fee}}` | Seller flat fee charged by the listing brokerage (seller side), from the intake | Intake |
| `{{buyer_agent_commission}}` | Buyer-agent commission | Transaction commission area (you type it) |
| `{{warranty_amount}}` | Home warranty cost | Checklist (Home Warranty step) |
| `{{listing_commission}}` | Listing commission (seller side), from the intake | Intake |
| `{{coop_agent_brokerage}}` | Other side's agent's brokerage | People on this deal |
| `{{coop_agent_phone}}` | Other side's agent's phone | People on this deal |
| `{{coop_agent_email}}` | Other side's agent's email | People on this deal |
| `{{lender_phone}}` | Loan officer's phone | People on this deal |
| `{{closing_terms}}` | Closing date with the wording on the checklist | Checklist (Closing step wording) |

## Ireland’s final field decisions

`possession_terms` uses the Possession checklist step’s email wording, or its reviewed rule/date. `buyer_agent_commission` is an editable, autosaving box in the transaction’s Commission card. It is never assigned a universal 3% default. The retired `repair_completion_deadline` code is omitted from the app. Title-introduction templates with a single literal 3% are migrated to the commission field, with original text backed up and saved/sent drafts retained.

Other codes need actual saved data: coordinator signature/review link, shared company information, appointments, intake answers, names/contact details, and checklist dates. Title commitment is currently a seller-checklist source; buyer files without such a saved step have no value.

## Details card visibility

Commission (both sides): `buyer_agent_commission`. Buyer Details: `utility_list`, `closing_preferences`. Seller: `utility_list`, `access_details`, `repair_agreement_summary`, `signing_preference`, `seller_forwarding_address`. New fields bound to Details follow their selected side.

## Preserved existing fields

The distinct existing codes `{{recipient_name}}`, `{{possession_date}}`, `{{appraisal_deadline}}`, `{{closing_appointment_place}}`, `{{purchase_price}}`, `{{acceptance_date}}`, `{{package_name}}` remain supported. Existing custom milestone fields appear under a single `<milestone>_date` code. `{{geo_info}}` replaces `{{custom_geo_info}}`; all other custom keys remain exactly as saved.

## Implementation and migration

- Shared accent is #1E1C1A; hover #3A3733. Warning colors, sidebar, off-white background and cream logo tiles are retained.
- Settings offers new source bindings, custom fixed text, coordinator name/signature/review link, title company information and brokerage wiring instructions.
- Details autosaves with per-field conflict checks; checklist EMD/warranty amounts and holder/company are editable. Reviewed extraction values are proposed in creation review and saved only on confirmation.
- Appraisal/warranty dates and appraisal appointments can now be entered. No dates or contract offsets are invented. Walkthrough recalculation uses the reviewed date rule.
- Composer shows a filled preview, To/Cc deal-person chips, typed addresses, reminder picker and Save for later. Actual delivery remains an explicit Send action with existing permission and freshness checks. Manual checks are independent of delivery history.
- Email reminders appear in Overview on their reminder day, remaining there when overdue.
- Migration backs up original template text/revisions, renames old template tokens in place and preserves template IDs, drafts and sent content. If both `custom_geo_info` and `geo_info` exist, it rolls back instead of discarding either value.
- Four schema migrations must run before the new API/worker. Deployment progress is recorded below after release verification.

## Validation

- 467 automated tests passed across 71 files using a fresh local UTC PostgreSQL database.
- Six backup/recovery rehearsal tests were excluded because pg_dump/pg_restore are not installed.
- Production build, TypeScript and browser checks passed for the cleanup. The final possession/commission corrections passed the release tests.
- Next.js emitted an existing-version security upgrade notice during local verification; the build completed on retry. Dependency versions are unchanged.

## Release progress

Ireland authorized deployment on November 17, 2026. Target: the existing Weatherly project, staging environment, serving https://www.weatherlytc.com. API migrations run before the new web/worker release. Provider settings and approved email workflows remain as configured. The release is now live; verified receipts are below.


The four migrations completed successfully in the API pre-deploy logs (25 total migrations now present). The optional read-only probe was not observed in those logs. Automatic approval review rejected replacing the migration command with a check-only command for an additional diagnostic redeploy; the standard `npm run db:deploy` safeguard remains configured. Normal deployment health and unauthenticated access checks continue without that optional diagnostic.


### Verified live deployment

All three application services serve GitHub release `32a89577836a3284bc27d717c24338537e73ff69`. Main was fast-forwarded to that tested release; services are pinned to it on `codex/merge-fields-release-32a8957`.

| Service | Successful deployment |
| --- | --- |
| API | `5693500c-bbb6-4c00-a3ba-6a97b588f210` |
| Worker | `751f02f4-6659-4d26-8126-9731e7e7de43` |
| Web | `0829e919-993a-4c2b-a570-727e23746a73` |

API readiness followed successful application of all four release migrations. Railway reports all services online, one running replica each, no crashes/issues and no pending work. The public `/health` endpoint returns 200; unauthenticated session and merge-field configuration reads return 401. Browser reload confirms the served shared accent is `#1e1c1a`.

Hosted verification used public health, authentication boundaries, source/deployment receipts and the served theme. Coordinator field edits and actual email delivery were not tested against live client records. Functional checks used synthetic local data. No new email or payment was sent as a deployment test, and existing provider gates were retained.

The first API deployment request used main's previous head despite the saved commit pin. Switching the source to the release branch corrected the actual build source; the successful deployment IDs above are the verified release, rather than that older-source attempt.
