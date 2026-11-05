# Weatherly owner implementation plan

Turn Ireland’s approved designs and interview decisions into a working transaction-coordination system for her Howard Hanna agents. Ireland controls transaction facts, timeline publication, milestone completion and correspondence. Agents submit information and pay for the selected service; clients receive a simple shared timeline.

The vision interview is finished. Continue implementation using the decisions below. Keep deferred content and account setup as explicit dependencies rather than restarting the questionnaire or inventing business policies. These decisions supersede conflicting assumptions in the older scope and implementation plans for this work.

## Current implementation position

The redesign chat owns application changes in the shared checkout on `codex/weatherly-reference-redesign`. This planning chat owns this document. Do not start a second overlapping implementation in the same files.

| Area | Position at plan preparation | Next action |
| --- | --- | --- |
| Reference preservation, Process page, shared marketing styling and four intake variants | Initial local commit `a9a10c1`; reference comparisons and validation recorded in `docs/release/weatherly-redesign.md` | Preserve fidelity while applying the later owner decisions; repeat affected comparisons |
| $425/$515 catalog and Full Listing Coming soon | Included in the initial candidate | Recheck every new-order path and preservation of historical prices |
| Package-specific contract access, owner review, conflict handling and visibility | Further changes are in progress after the initial commit | Complete and validate the final integrated workflow |
| Private weekday reminders | Service, API and worker changes are in progress | Complete dashboard controls, scheduling and delivery verification |
| Saved-contact autofill | Requested and assigned to the redesign chat | Implement durable directory, explicit selection and transaction snapshots |
| Excel email library | File will be supplied later | Keep new template content blank; prepare four-group structure and review/import flow |
| Live integrations and launch | Earlier hosted release remains the deployment baseline until a new release is verified | Complete account-dependent checks and release preparation after local acceptance |

Working changes are not completed or independently accepted merely because files exist. The initial candidate’s recorded tests and comparisons do not certify later edits.

## Approved product decisions

| Topic | Required behavior |
| --- | --- |
| Customers | Ireland serves Howard Hanna agents; one brokerage workflow |
| Services | Contract to Close: $425; Contract to Close + Compliance: $515; each supports buyer or seller |
| Full Listing | Coming soon; unavailable for new transactions or new service charges; historical records remain available |
| Contract access | Contract to Close requires an executed-contract upload. Compliance accepts an upload or a Dotloop reference identified by property address or transaction name |
| Intake purpose | Ask for information Ireland cannot obtain from the contract. Save at any point. Final submission must answer applicable questions, accepting the supplied unknown/request-help choices |
| Approval | Extraction, calculations and draft preparation may run automatically. Ireland resolves conflicts and approves the file before its timeline is published |
| Missing dates | Ireland may create a file with an explicitly unresolved date and a visible follow-up item |
| Contract deadlines | Extract each contract’s actual dates, periods and anchors; no standard loan-application or other deadline interval is assumed |
| Checklist | Simple contract-deadline/milestone guide; Ireland checks completion and may add short scheduling notes |
| Emails | Email history records the steps taken toward deadlines. Ireland controls official sends. Gmail includes correspondence sent directly from the mailbox and incoming replies |
| Mailbox | `ireland@weatherlytc.com`, using Gmail/Google Workspace; account connection remains separate from this decision |
| Portals | Ireland’s editable workspace; authenticated agent portal; client timeline by link without login |
| Visibility | One canonical checklist/timeline with agent and client visibility switches; Ireland’s approved changes synchronize to permitted views |
| Client access | Agents may distribute client invites/links too. Client and agent timeline views are read-only; clients do not complete tasks or upload responses |
| Reminders | Email Ireland only at 8 a.m. America/New_York each weekday; overdue and next-seven-day items across transactions, ordered by urgency; monthly dashboard calendar |
| Service payment | Due at closing for the designated package; no service fee if the transaction terminates before closing |
| Replacement contract | New transaction linked to the terminated transaction; retain the old contract, timeline, correspondence and history |
| Email groups | Buyer and seller, each with Contract to Close and Compliance: four groups |
| Gifts | Deferred. Preserve supplied presentation and established information; do not invent products, amounts, suppliers or credit/refund mechanics |
| Marketing | Match the supplied Process design and shared styling; retain other page content except explicit owner-approved updates |

## Implementation sequence

### 1. Finish the reference redesign and intake rules

- Preserve all five original HTML files, provenance and existing visual evidence in `design-reference/2026-11-weatherly/`.
- Match the supplied Process page and all four intake variants, including conditional fields, responsive navigation, typography and upload sections. Additional autofill controls must fit the established design.
- Apply the two service names and prices consistently in public copy, intake, coordinator controls, saved service snapshots and checkout. Preserve existing historical orders and submissions.
- Keep partially completed drafts saveable. Validate only active conditional branches on final submission; an explicit unknown/help choice is an answer, not a fabricated contact value.
- Require a saved executed-contract upload for Contract to Close. Compliance may use an identified Dotloop transaction without a deep document URL. A location reference creates retrieval work; it does not claim successful access.
- Do not add closing-date or other contract-fact entry requirements to the agent form. Retain all submitted answers, upload groups and a durable receipt.

**Acceptance:** all four variants save/resume without loss, enforce their package-specific contract rule, preserve every material field in review, survive retries without duplicate submissions, and keep Full Listing unavailable for new orders. Compare desktop/mobile output and affected conditional states with the references.

### 2. Complete extraction, review and file creation

- Agent submission enters a durable pending-review state with a receipt reading “Received—awaiting Ireland’s review.” An internal record may exist, but its timeline is not yet published.
- Connect the submitted intake and stored contract to extraction. For Compliance, use verified Dotloop retrieval when available and a coordinator upload recovery path otherwise.
- Prepare facts, contact matches and actual contractual date calculations with document/version references, quoted evidence, anchors and calculation explanations.
- Present one coordinator review screen. Ireland can choose between conflicting sources, correct values and explicitly leave an applicable date unresolved.
- Use “Confirm and create file” as the initial publication action. Require a deliberate disposition for unresolved/conflicting information; unknown values remain visibly unknown.
- Preserve approval revisions. Amendments show affected changes for fresh approval and cannot silently replace confirmed dates or manual corrections.
- Keep unsupported/scanned extraction actionable: preserve the original, show the limitation and allow Ireland’s manual correction or an approved processing path.

**Acceptance:** no proposed date reaches an authoritative calendar, task due date, shared timeline, reminder or template as if confirmed. Confirmation publishes the reviewed snapshot atomically; stale review attempts fail safely. Missing dates produce follow-up items. Amended dates retain their prior values and approval history.

### 3. Unify the coordinator, agent and client views

- Keep milestone completion, dates, scheduling notes and audience settings on canonical transaction records. Avoid independent copies that drift between portals.
- Ireland alone changes ongoing transaction facts, timeline/checklist completion and visibility. Preserve agent intake, checkout and client-invite permissions without granting timeline editing.
- Provide per-item agent/client visibility controls. Internal notes, full intake answers, transaction email and business payments remain outside the client timeline.
- Display a clear client timeline with milestones, progress and optional read-only “What we need from you” instructions. Include no client completion/upload controls.
- Allow authorized agents and Ireland to create/share expiring, revocable read-only client links. Sharing does not expose unrelated matters or enlarge the selected timeline projection.
- Display short inspection, walkthrough and closing scheduling notes where Ireland shares them; keep contractual deadlines distinct from appointment times.
- Create a linked new file for a replacement contract. Property matching must not merge distinct contract lifecycles or their emails automatically.

**Acceptance:** one coordinator completion changes both permitted views; hidden/private data remains absent through UI, API and links. Agents/clients cannot mutate timelines. Revoked/expired links stop working. An unconfirmed file has no published client timeline.

### 4. Add saved contacts and email preparation

- Build a persistent coordinator contact directory for agents, title companies/representatives, lenders/loan officers and other business contacts. Support search, favorites and frequent/recent selections.
- Explicit contact selection fills supported name/company/email/phone fields. Keep people at the same company distinct and show conflicts before replacing entered or extracted values.
- Store transaction snapshots and directory references. Updating a directory entry must not rewrite historical transaction contacts, reviewed recipient snapshots or sent messages.
- Keep the directory private to Ireland initially. Any agent autocomplete must use only that agent’s authorized history or entries explicitly shared for that purpose.
- Prepare four email-template groups. Leave new message content blank until Ireland supplies her Excel file; preserve any existing saved user templates.
- Once the workbook arrives, inspect its actual layout, map messages and merge fields, preview the import and have Ireland approve the resulting library. Do not invent a workbook schema or seed old sample wording.
- Populate drafts from the current transaction’s confirmed facts and selected contacts. Unresolved fields prevent a ready-to-send representation. Review final recipients, text and attachments before an explicit send.
- Preserve Gmail threading and delivery history, including direct Gmail sends and incoming replies. Keep email send/delivery state separate from Ireland’s simple milestone completion.

**Acceptance:** contacts persist across sessions; same-company representatives remain distinct; directory edits do not alter historical records; unauthorized directory reads fail. Template groups select correctly, missing fields remain visible and no email is sent by autofill, extraction or milestone completion.

### 5. Finish the portfolio dashboard, calendar and private reminders

- Show pending reviews, unresolved information, upcoming/overdue contract deadlines, communication work and unpaid service requests across all authorized transactions.
- Provide a usable month calendar and complete paginated/date-range queries; avoid silently omitting transactions because of initial list limits.
- Schedule one private digest each weekday at 8 a.m. in America/New_York, accounting for daylight saving. Include overdue and next-seven-day approved, incomplete items, ordered by urgency.
- Deliver to Ireland only through the configured system-mail channel. Preserve the Gmail channel for transaction correspondence. Show whether reminder delivery is disabled, unconfigured, scheduled or failed.
- Deduplicate jobs and retries, stop stale reminders after completion/termination or changed approval, and keep confidential bodies out of operational logs.

**Acceptance:** verify timezone/DST, weekends, completion, termination, duplicate retries, changed dates, pagination and exact recipient restrictions. A disabled provider must not appear to be delivering. Verify actual email receipt during account-dependent acceptance.

### 6. Complete closing payments and termination behavior

- Use the saved designated package and price snapshot for an Ireland-approved checkout request. Service payment is due at closing; intake and date approval do not charge the agent.
- Track due, pending, paid and failed requests using verified provider records. Keep business payments distinct from milestones such as earnest-money delivery.
- A pre-closing termination leaves no service fee due and prevents an outstanding request from remaining payable. Preserve order/audit history while reconciling or expiring any provider checkout safely.
- Handle unexpected early payments or settlement races as explicit reconciliation cases; do not invent an automatic refund policy.
- Keep the replacement transaction’s billing separate from its predecessor.

**Acceptance:** correct $425/$515 package amounts, historical snapshot preservation, closing checkout, terminated-file denial, stale-link/provider races and idempotent payment reconciliation. Use Ireland’s sandbox account before any live-payment acceptance.

### 7. Integrate, review and prepare the release

- Freeze the completed candidate and run appropriate domain/authorization tests, TypeScript, production build, API acceptance and meaningful real-browser journeys.
- Independently review the changed approval, sharing, contact, email, reminder and billing paths at the same candidate revision. Repair defects and recheck affected behavior.
- Reconcile release documentation with the final interview decisions; remove superseded “still undecided” statements in the sections being updated.
- Verify the exact reference-comparison scope and disclose necessary operational differences such as real identity, durable save state and real submission results.
- Prepare additive migrations, deployment order and rollback. Verify private database/storage, account recovery, backups plus hosted restore and monitoring before real-client operation.
- Complete actual Gmail, Dotloop, Resend, Stripe and OpenRouter privacy/routing checks with approved accounts and synthetic fixtures. Account-dependent work does not block independent local implementation.
- Complete the existing repository push authorization process in the redesign chat after the candidate is reviewable. A rejected or pending push is not a published release. Record actual serving revisions when a deployment is authorized and verified.

**Acceptance:** a synthetic agent submits, Ireland reviews/corrects/confirms, both read-only views show only shared confirmed information, an amendment is reapproved, contacts populate safely, a due email is deliberately sent, Ireland alone receives a reminder, closing payment reconciles, and termination/replacement preserve history without a fee on the terminated file.

## Deferred inputs and implementation defaults

- **Excel templates:** content and precise import mapping wait for the actual workbook. Build the four-group structure and leave the new library blank.
- **Howard Hanna checklist:** use the supplied material as a reviewable starting point. The old platform mixes brokerage items with Home Team Ohio, named-person and vendor examples; do not publish those as an approved current checklist automatically.
- **Gifts:** keep deferred; no fabricated catalog, live payment or fulfillment workflow.
- **Provider accounts:** complete existing account/privacy gates before activating live email, payments, imports or AI on client records.
- **Unspecified outgoing payments:** retain existing supported tracking; do not add fund-transfer, escrow or commission-disbursement behavior from a general request to track payments.
- **Unspecified operating policies:** preserve current access controls and choose reversible implementation defaults. Retention, recovery and live-launch requirements remain release work, not another vision questionnaire.

## Completion report

The redesign chat should report each package as implemented, verified or blocked by a named external input; include the final commit, relevant test/browser evidence, outstanding deferred content and actual push/deployment status. The plan is complete when the approved workflow works as one system, rather than only as matching screens.
