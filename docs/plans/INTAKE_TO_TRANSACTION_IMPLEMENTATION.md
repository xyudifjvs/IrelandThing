# Weatherly intake-to-transaction implementation plan

Prepared November 11, 2026. The independent planning review is complete and implementation is underway. See the [planning review](../reviews/intake-to-transaction/implementation-plan-review.md).

## Purpose and source of truth

Implement the November handoff in the existing Weatherly application, preserving accounts, records, working integrations, historical prices, and existing functionality except where the handoff expressly changes it. This document supersedes conflicting implementation instructions in older plans for this scope; it does not claim the application or provider accounts have already been changed.

Sources:

- `Handoffs/Weatherly — Intake-to-Transaction Build Spec.md` and its PDF copy.
- All uploaded screen references. `Handoffs/agent portal.pdf` also contains the roster, client portal, HTO Operations, notes, overview, transaction list, file, and creation-screen references.
- Local source at HEAD `2177674` at initial review. Record the actual clean base commit before dispatch; newer user changes must be incorporated rather than overwritten.
- Current schema, source authorization boundaries, and repository release/runbook evidence. Statements in the handoff that Gmail, Stripe, or other providers are connected are requirements/context, not verified account status.

**Account rule:** every account-specific connection, credential installation, OAuth consent, provider configuration, privacy verification, webhook registration, and actual provider acceptance check happens from **Ireland's laptop**, using her accounts. Development here uses synthetic fixtures, disposable local databases/storage, and injected provider doubles. No account from Carson's other projects is substituted. Account work is a separate release dependency and does not block local implementation.

## Product rules carried into every chunk

1. The agent submits an intake; Ireland reviews and edits one screen; one **Confirm & create transaction** action creates/publishes the file. A failed, abandoned, skipped-AI, or retried review must not lose or duplicate the intake.
2. The checklist owns operational dates. Other screens, email merge fields, reminders, and portals consume those same records. Acceptance and other hidden calculation anchors may exist without becoming extra checklist rows.
3. Blank dates are allowed. Do not create unresolved banners, required per-date explanations, automatic missing-date to-dos, or a separate date-review workflow. Blank, not needed, and completed are distinct states.
4. The buyer and seller lists in the handoff are the new-file templates. Existing files retain historical/customized checklist data and order unless an explicit, reviewed mapping says otherwise.
5. AI proposes values only. Ireland's confirmation and later manual edits are authoritative. Extraction failure or Skip never prevents manual creation. Late AI results cannot overwrite edits or a confirmed file.
6. Business affiliation on an agent and business on a file are separate. HTO membership informs new intake defaults; historical file business and prices do not change when roster membership changes. HTO files never incur a service fee; gifts remain a distinct existing workflow.
7. Only Ireland changes ongoing file facts, checklist state, sharing, close-out, termination, reopening, and deletion. Agents may submit intakes, upload new documents to an active authorized file, and copy an existing client link. Closed/terminated file views are read-only. Contacts do not receive portal access.
8. Emails and private notes never reach either portal. Checklist notes are private by default, optionally agent-visible, and never client-visible. Document/person agent and client visibility are independent.
9. Closing a checklist item does not close a file. Close out, terminate, reopen, and permanent delete are explicit file actions. No new archive action is added; historical archived/pre-listing records are preserved.
10. Preserve preview accounts and their existing passwords; retain an authorized synthetic sample file for agent and client previews. Never reset production or preview accounts as a migration shortcut.
11. Compliance is an empty, optional, coordinator-only tab. Preserve legacy broker data internally. Do not invent compliance content, gift products/prices, final email wording, or new external integrations.
12. Keep login, security, account recovery, optional two-step login, Calendly, Inbox, Contacts, Calendar, Settings, billing history, and public-site behavior working. Apply the shared visual system to retained app screens without replacing their behavior.

## Decisions and inputs to settle before the affected behavior ships

The rest of the work can proceed using frozen interfaces and synthetic fixtures. These are specific decision gates, not a reason to restart a general discovery interview. Builders must not silently turn the recommendations into approved business policy.

| ID | Issue | Proposed resolution / required input | Affected chunks |
| --- | --- | --- | --- |
| D1 | The example says Remedies is three days after inspections; the normative list/prompt uses same-day remedies and a separate negotiated-remedies period. | Use stable, separate keys for `remedies` and `remedies_negotiated`; recommend the explicit later definition, with Repairs Agreed On mapped to the latter. Confirm the contradictory example is illustrative. | C03, C04, C05 |
| D2 | The prompt imposes same-day remedies and title at closing minus 15 days, even when extraction otherwise follows document terms. | Carson chose to use the signed contract date when it differs. Preserve the original prompt verbatim as a source asset and version the runtime extraction to honor that precedence. Ireland confirms this decision during the laptop handoff. | C03, C04, C15 |
| D3 | Hour-based deadlines, unspecified day type, holiday calendars, and weekend rollover are not fully represented by the prompt's rule shape. | Preserve exact time/unit when known; use an explicit calendar/rollover policy per rule. Unknown policy must never become guessed arithmetic. A blank/manual date remains usable while a rule cannot be calculated. Confirm accepted hourly/date-only handling. | C01, C03, C04 |
| D4 | Only this date leaves downstream dates unchanged, but their future dependency behavior is unspecified; completed anchors also need defined traversal. | Carson chose to pin affected downstream dates until Ireland edits them. Preview affected records first and preserve their saved values. Ireland confirms this decision during the laptop handoff. | C03, C15 |
| D5 | HTO exact-address auto-linking can collide with repeat sales, units, replacement contracts, or multiple manual rows. | Auto-link only one unambiguous compatible manual row in the same deal lifecycle; ask on ambiguous/near matches. Confirm business-switch handling for linked rows and existing paid/pending service orders; never invent refunds. | C05, C09, C11 |
| D6 | The handoff requests a copyable existing client link, but current storage keeps only its hash. | Choose protected recoverable token storage or an equivalent authenticated handoff mechanism. Retain hash lookup, revocation/expiry and no token logging; agent copy must never rotate a link. Define expired/revoked-link presentation. | C01, C06, C13 |
| D7 | Permanent deletion touches documents, email history, intake disposition, jobs, payments, and audit records. | Specify local deletion/retention boundaries, cancel obsolete jobs and outstanding payable checkouts, preserve the consumed/deleted intake disposition, and remove stored file blobs safely. Do not infer remote Gmail deletion or automatic refunds. Migration itself performs no file deletion. | C01, C05, C06, C07, C09 |
| D8 | Daily updates currently run weekday mornings; 'intakes came in that day' does not define the digest window. | Recommend an America/New_York watermark window since the last successful digest, including weekend submissions and already-processed intakes, with retry-safe delivery. An intake-only digest must send even with no deadline items. Confirm wording/cutoff. | C12 |
| D9 | Written requirements and examples differ: manual-start link location, Compliance tab, client notes/title step, and final client wording. | Written behavior governs; screenshots guide layout. Keep manual start on Overview, show empty Compliance, expose no client notes, and do not add seller-only title to new buyer templates. Final client wording/design remains an Ireland content input. | C02, C12, C13, C14 |
| D10 | Missing supplied content/assets. | Obtain `og-1-cream.png`; final buyer/seller email content and compliance list remain deferred. Provide unmistakable editable email placeholders with no accidental live send. Keep any existing saved user templates. Gift catalog/policy remains unchanged. | C02, C07, C14 |

## Agent model and exclusive ownership

Each chunk has a **builder Bxx** and a distinct **reviewer Rxx**. Logical assignments below are future dispatch slots, not agents currently implementing the application.

- A reviewer must not have authored or co-implemented the chunk being reviewed. Reviewers read the source, requirements, and exact diff, exercise their own failure cases, and record findings. A builder repairs findings; the reviewer rechecks the resulting commit.
- Reserve R15 for an agent that authored none of C00–C14's integrated product changes; reusing a feature builder as final reviewer would not provide independent release acceptance.
- Review the precise commit and dependency revisions. A builder's test report alone is not independent acceptance. Use accepted / changes requested / blocked by named input, not vague 'looks good'.
- One agent writes each owned file. Reviewers write only their review report and independently authored probes under their assigned review directory. They do not patch product files or weaken acceptance tests to obtain a pass.
- C00 owns shared entry points and wiring. C01 alone owns schema and migrations. Feature builders implement their assigned leaf modules; requests outside their allowlist go to the owner.
- C00 initially creates/extracts leaf files during the refactoring gate. Ownership transfers to the listed feature owner only after the refactor commit is reviewed. Record the transfer in the ownership manifest. This is a sequential handoff, never two writers on the same file.
- Add each builder's allowlist, base commit, dependency commits, deliverables and reviewer to `docs/handovers/intake-to-transaction/Cxx/handoff.md`. Record changes to ownership before editing. Unlisted existing files are read-only until C00 assigns them.
- Use isolated branches/worktrees (`codex/handoff-cxx-...`) with separate generated clients, build outputs, local database names, and test storage. Do not share or reset another pair's database or regenerate into its running dependency tree.
- With the current four-agent limit including the coordinator, run one builder/reviewer pair plus the coordinator; the fourth slot may prepare the next ready chunk. Do not start two simultaneous full pairs while the coordinator is active. Pairing describes accountability, not a requirement to keep idle reviewers running.
- Every pair owns a unique `docs/reviews/intake-to-transaction/Cxx/` directory. Reviewers may create isolated test probes there; production/domain tests remain with their product owner. C15 alone changes shared acceptance suites.

### Shared integration files: C00 only

`apps/api/src/main.ts`, `apps/worker/src/main.ts`, root `package.json` / lockfile / TypeScript / Vitest configuration, existing workspace package manifests, `packages/matters/src/index.ts`, existing `packages/matters/src/task-fields.ts` and `deadline-fields.ts` as compatibility-only exports after extraction, the extracted matter-router aggregation file, shared contract exports, `apps/web/app/(workspace)/workspace/_components/data.ts`, central Settings composition, existing mixed `Operations.tsx` compatibility exports, environment examples, CI and deployment wiring.

Existing feature-specific package barrels belong to their feature owner unless explicitly listed above. C00 integrates published exports rather than allowing every feature agent to edit the same bootstrap file. C15 owns release evidence and acceptance suites; C00 changes CI wiring only on C15's request.

## Refactoring is an explicit prerequisite

The current matters entry file is about 1,779 lines, communications service 1,342, email UI 1,089, transaction page 802, documents service 779, and mixed Operations UI 623. Split by responsibility before piling new workflows into these files. Line counts are observations, not mandatory size limits.

| Existing surface | Intended split and resulting owner | Refactoring timing |
| --- | --- | --- |
| `packages/matters/src/index.ts` | Thin public exports/router aggregation (C00); authorization/access (C00); read projections/queries (C06); task/deadline commands (C03); lifecycle/file confirmation/extraction-approval adapters (C05); route modules with the same feature ownership. | C00 extracts existing behavior before leaf ownership transfers. |
| `packages/matters/src/task-fields.ts` and `deadline-fields.ts` | Validation schemas move to `validation/task-fields.ts` and `validation/deadline-fields.ts` (C03); audience/read functions such as `sharedTaskFields`, `agentMatterDetails` and `deadlineProjection` move to `projections/**` (C06). Original paths become thin compatibility exports (C00). Leaf modules import leaf schemas directly, avoiding export/import cycles. | C00 move-only split before C03/C06 dispatch. |
| `packages/intake/src/index.ts` | Validation, draft/submission persistence, intake queries, create-review preparation, confirmation orchestration, and HTTP handlers. | C05 splits its exclusively owned package before changing behavior. |
| `packages/ai/src/service.ts` | Source-bundle assembly, extraction execution, validation/normalization, proposal persistence and legacy approval compatibility. Keep the gateway boundary separate. | C04; legacy matter-approval mutations remain C05 adapters. |
| `packages/communications/src/service.ts` and router | Drafts, templates/rendering, email workflow state/reminders, sending, Gmail sync/thread association, attachments, routes. Keep `reminders.ts` reserved for C12's private daily digest. | C07; move-only stage reviewed before new email behavior. |
| `packages/documents/src/index.ts` | Storage/upload/version handling, audience authorization, list/view/download, ZIP generation, and HTTP handlers. | C06; preserve replay and upload-integrity protections. |
| `Operations.tsx` | Separate retained Settings, Payments, Inbox, and legacy Review modules. Settings shell/compatibility exports C00; Payments C09; Inbox C07; retired Review compatibility C00. | C00 move-only extraction before C07/C09 dispatch. |
| `CommunicationTools.tsx` | Template list, To send list, composer, recipients, merge-field controls, attachments and thread history under `workspace/_features/emails/`. | C07; compatibility wrapper only where still needed. |
| Transaction `transactions/[id]/page.tsx` | Thin route + file frame/tab composition (C14); checklist (C03), people/documents/sharing (C06), emails (C07), private notes (C10), immutable intake detail (C05). | C00 move-only extraction, then C14 owns composition. |
| Portal and public checklist pages | Thin route files, separate home/file/timeline/documents/team views, and role-specific data adapters. | C13; intake files remain C05's allowlist. |
| Onboarding and identity services | Roster queries/commands, agreements, signup state, membership policy and profile changes; retain existing auth/session boundaries. | C08; no unrelated authentication rewrite. |

Use domain modules and dependency injection rather than new packages unless a package boundary has a clear purpose. Keep routing, pure calculation, persistence, projection and UI composition separate. Avoid circular package imports, giant replacement files, and one shared CSS file absorbing every feature. Keep tests appropriate to behavior; a move-only refactor needs existing regression checks, not tests that merely mirror moved functions. Read `apps/web/AGENTS.md` and relevant installed Next.js guidance before web implementation.

## Contracts frozen by C00 and C01 before feature dispatch

C00 owns new shared types/schemas in `packages/platform/src/handoff-contracts/`; feature owners may propose changes through C00. C01 implements persistence from the agreed contracts. Specify request/response fields, auth, errors, expected revisions, idempotency, null semantics and projections before parallel work.

| Contract | Required boundary |
| --- | --- |
| Business / agent membership | Stable `hto` / `weatherly` file business; agent membership independent of file snapshots; one fee-eligibility policy consumed by intake, roster, billing and portals. Membership changes preserve old files. |
| Intake and creation review | Durable intake/review IDs, immutable submission snapshot, contract bundle/version IDs, review revision and extraction generation. New submissions need not create a Matter; existing pending Matter containers remain compatible and private. Intake status changes to consumed only in successful confirmation. |
| Confirmation | One revision-checked/idempotent operation creates or activates exactly one file, seeds side-specific checklist and confirmed dates/contacts, associates documents and immutable intake, and writes transactional outbox events. Same retry returns the same result; stale edits fail safely. No network provider call inside the transaction. |
| Checklist/date graph | Stable keys separate from labels; date-capable versus no-date steps; fixed or relative rules; signed offsets, calendar/rollover, earliest-of rules, actual event anchors, completion/not-needed state, manual pins and extension history. Preview includes base revisions; apply validates them atomically. |
| Extraction | Versioned exact prompt asset, source bundle covering all supplied contract/counteroffer/addendum pages, strict validated output, proposed values/rules, and generation/cancellation identity. No publication or late-result overwrite. |
| People | Transaction contact IDs/snapshots separate from login membership and directory IDs; intake value precedence; independent agent/client flags; role replacement does not rewrite sent recipient snapshots. |
| Documents | Existing storage/version integrity retained; independent audience flags; actor-based upload defaults; safe view/download metadata; bearer access limited to the selected active share; ZIP contains only allowed current documents. |
| Client links | Coordinator create/replace/revoke; authorized agent retrieves/copies existing link only. Expiry and revocation rechecked on every timeline/document request, including ZIP/stream startup. Secret recovery follows D6; no raw tokens in logs/audits. |
| Email work | Template ID/version + file ID + linked checklist key, recipient defaults, explicit actual-send state versus manual completion, Later/Skip/reminder state, and one To send query consumed by file, portfolio and Overview. Checking a task may prompt, never send. |
| Private notes | One coordinator-owned checkable item, optional file ID, completion/revision; separate autosaved scratchpad. All views use the same item IDs. |
| Lifecycle and HTO | Explicit close/terminate/reopen/delete commands and canonical file-fact updates. HTO sync hooks receive the same DB transaction; HTO edits call canonical commands. Register hooks at C00, avoiding lifecycle↔HTO import cycles. |
| Portfolio and digest | Complete/paginated server queries, business/status/search filters, canonical next dates/email work, signup summary and notes summary. Digest uses date windows/watermark and excludes inactive file work without losing received-intake summaries. |

**Canonical dates:** C00/C01 freeze one authoritative checklist date representation before the schema is merged, consulting B03/R03 during contract design; C03 implements it. Legacy `Deadline`/`Task.dueDate` compatibility must be a controlled projection, not two editable stores. Merge fields, public links, calendar, reminders, assistant/MCP reads and legacy mutation routes must all use the same approved value and audience policy. No stale alternate endpoint may bypass the new rules. Likewise, resolve D6's technical storage design with B06/R06 before C01 merges that schema; feature acceptance is not a prerequisite for contract design.

**Hook ordering:** file confirmation and lifecycle changes commit domain records/outbox atomically; external effects happen afterward. HTO linking/sync, email work, billing cancellation and digest invalidation are registered hooks with explicit failure semantics. No feature imports the API/worker bootstrap, and no hook failure is silently ignored.

## Chunk assignments

The file patterns below are exclusive allowlists after C00's extraction gate. New feature UI lives under `apps/web/app/(workspace)/workspace/_features/<name>/` with its own CSS. All paths are repository-relative. Tests under an owned package follow that owner; the C12 `reminders` exception and C15 acceptance ownership take precedence over broad patterns.

For the shared matters package, existing test ownership is explicit: `test/rules.test.ts` and `date-approval.test.ts` → C03; `file-review.test.ts` and `locking.test.ts` → C05; `deadline-audiences.test.ts` and `checklist-sharing.test.ts` → C06. New domain tests use exclusive folders: `packages/matters/test/checklist/` (C03), `lifecycle/` (C05), `projections/` (C06), `private-notes/` (C10), `hto-operations/` (C11), and `portfolio/` (C12). C00 lists any additional preexisting test file individually before dispatch. Cross-feature acceptance remains under C15's `tests/` ownership; another chunk proposes a case instead of editing that suite.

| Chunk | Builder / independent reviewer | Work package | Acceptance dependencies |
| --- | --- | --- | --- |
| C00 | B00 / R00 | Contracts, shared refactor, composition and integration | Initial gate first; final integration after C01–C14 |
| C01 | B01 / R01 | Persistence, additive migration and legacy-data mapping | C00 contract/refactor gate |
| C02 | B02 / R02 | Shared theme, shell and brand assets | C00 UI composition contracts |
| C03 | B03 / R03 | Checklist templates, date graph and checklist UI | C01, C02 |
| C04 | B04 / R04 | Intake contract extraction | C01; date output contract from C03 |
| C05 | B05 / R05 | Intake, review, confirmation and file lifecycle | C01, C03, C04, C08 membership, C09 fee policy |
| C06 | B06 / R06 | People, contacts, documents, sharing and safe projections | C01, C03, C08 membership; D6 |
| C07 | B07 / R07 | Email workspace, templates, work queue and Inbox | C01, C03, C06 |
| C08 | B08 / R08 | Agent roster, onboarding, membership and profile services | C01, C02 |
| C09 | B09 / R09 | HTO fee exemption and retained payment workflows | C01, C08 membership contract |
| C10 | B10 / R10 | Private notes, to-dos and scratchpad | C01, C02 |
| C11 | B11 / R11 | HTO Operations and FUB CSV | C01, C05-domain milestone, C08 |
| C12 | B12 / R12 | Overview, transaction list, Calendar and private digest | C03, C05, C07, C08, C10 |
| C13 | B13 / R13 | Agent/client portals and account UI | C02, C05, C06, C08, C09 |
| C14 | B14 / R14 | Coordinator transaction file composition | C02, C03, C05, C06, C07, C10 |
| C15 | B15 / R15 | Integrated acceptance and Ireland-laptop release handoff | All local chunks and C00 final wiring |

### C00 — Shared refactor, contracts and integration

**Owns:** shared integration files listed above; `packages/platform/src/handoff-contracts/**`; extracted matter authorization and router aggregation; Settings shell/composition; ownership manifest and contract documentation under `docs/handovers/intake-to-transaction/C00/`.

**Deliver:** first inventory current routes, exports, hooks and consumers; publish the contract/ownership manifest and decision register. Perform move-only extraction of the shared matters and mixed UI files, retaining public interfaces and current behavior. Transfer leaf ownership only after review. Later mount feature routers/jobs/components, connect transactional hooks, update legacy adapters and remove superseded entry points after their replacements work. Keep provider activation flags unchanged. Central Settings mounts C07's template-management component; feature owners do not edit the same Settings shell.

**Acceptance:** existing appropriate domain/API checks and typecheck pass at the extraction commit; no change in authorization, publication, stored data or provider behavior. Final wiring leaves no route using stale date/audience/lifecycle mutations. Old intake/setup/review/onboarding URLs either route safely to the replacement or present an authorized compatibility view without exposing a second workflow.

**R00 checks:** compare before/after public interfaces and imports, detect missing hooks/routes and package cycles, audit leaf transfers for duplicate writers, and inspect final API/worker wiring independently. C00 remains the same owner across its early and late phases.

### C01 — Schema, migrations and preservation

**Owns:** `packages/db/**`, including schema, generated-client configuration, seed/bootstrap and all new migrations; migration fixtures/probes under its review/handoff directories. Other agents submit schema requests; they never create migrations.

**Deliver:** additive support for independent intake/review persistence, file business/lifecycle history, stable checklist keys/rules/actual anchors, independent sharing flags, contact snapshots, email work/completion, roster/signup membership, private notes/scratchpad, HTO manual/link rows and price history, digest delivery windows, and D6's selected secret mechanism. Use existing JSON structures where sound; introduce tables/columns where atomicity, relations, indexes or constraints warrant them. Document constraints and compatibility.

**Migration rules:** inventory legacy business classification rather than label every old file Weatherly; preserve pending/processed submissions, active/closed/terminated/archived/pre-listing files, custom checklist order, appointments, notes, broker data, contacts, document versions, emails and original service-price snapshots. Review every historical visibility mapping; do not auto-enable client access. Existing pending Matter IDs remain resolvable without prematurely publishing them. Seeds stay synthetic/idempotent and never reset existing users or passwords.

**Acceptance:** fresh database and representative populated pre-upgrade fixture both migrate; record counts/IDs/history survive; new constraints enforce idempotency and uniqueness; preview accounts survive unchanged. Re-run migration safely and document application rollback compatibility; destructive down-migrations are not a rollback strategy.

**R01 checks:** independently compare populated before/after records, audience defaults and legacy-state mapping; reproduce duplicate/concurrent writes; verify no password resets, silent reclassification or deletion.

### C02 — Theme, shells and supplied assets

**Owns:** `apps/web/app/globals.css`, root layout/font setup, `workspace/_components/Shell.tsx`, `workspace/layout.tsx`, shared `workspace.module.css`, `packages/ui/**`, new app-theme/primitives modules, new handoff brand assets, Open Graph route/helpers. Does not own feature route content, portal layouts, marketing reference content, or per-feature CSS.

**Deliver:** one token source for colors/fonts/sizes/radii; local licensed Cormorant Garamond/Montserrat; dark TC sidebar with correct cream logo tiles, roster/notes/HTO navigation and no separate Intakes/AI review/Onboarding links. Provide accessible controls/layout primitives. Feature agents use tokens in their own CSS. Restyle retained pages through primitives and coordinate remaining feature CSS. Replace social preview only with supplied approved asset; preserve favicon and marketing appearance/content.

**Acceptance:** desktop/mobile shell, keyboard/focus/contrast and overflow checks; existing fonts/assets/licenses retained; no duplicated hard-coded theme definitions. Missing OG asset is a named content dependency, not a reason to generate a replacement without direction.

**R02 checks:** compare references and retained screens, check scoped CSS for public-site regressions, and inspect computed theme use rather than checking token declarations alone.

### C03 — Checklist and linked-date engine

**Owns:** existing `packages/matters/src/rules.ts`, new `packages/matters/src/validation/**`, extracted task/deadline commands and route leaves; new `packages/matters/src/checklist/**` and `date-graph/**`; `workspace/_features/checklist/**`; shared `apps/web/app/_components/ChecklistTask.tsx` or its compatibility wrapper. Original `task-fields.ts`/`deadline-fields.ts` compatibility exports remain C00's; C06 owns all audience projections, C05 lifecycle/confirmation, C14 file composition.

**Deliver:** exact buyer/seller new-file templates/order, stable key mapping, financed/cash labeling, no-date rows, optional steps, add/edit/reorder and hide-completed behavior. Dates have deterministic fixed/relative/earliest-of rules, code-side arithmetic, actual HOA-delivery anchors distinct from due dates, extension history and preview/apply commands. Implement D1–D4 after decision resolution. Capture contract appointment date/time/place independently from deadline. Step-note schema/UI defaults private and supports explicit agent visibility only; C06 owns projection enforcement.

**Acceptance:** negative/zero offsets, chains out of display order, earliest-of with missing anchors, contract-specific calendars, clearing anchors, manual pins, cycle rejection, not-needed dependencies, completed values, concurrent preview/apply, and extension history. No-date rows never show date boxes. Progress excludes not-needed steps; changes reach the one canonical date projection. A manually edited date remains fixed and can anchor later rules.

**R03 checks:** use independently calculated examples, change anchors after manual/completed/not-needed states, test stale previews and repeat application, and verify the new 16-step buyer / 13-step seller templates do not overwrite existing custom files.

### C04 — Extraction inside creation

**Owns:** `packages/ai/**` (including its feature barrel) and extraction-specific UI adapters under `workspace/_features/extraction/**`. C00 mounts jobs/routes; C05 owns confirmation/approval mutations in matters.

**Deliver:** preserve the exact supplied prompt as a source asset and version the runtime extraction for D2's signed-contract precedence. Add a strict response schema, complete source assembly including counteroffers/addenda and every page, intake contact precedence, generation/revision identity, one invalid-response retry, bounded overall extraction time and Skip cancellation. Recompute proposed dates through the C03 interface. Preserve the server-only ZDR gateway, approved-provider/no-fallback/account-privacy controls, secret/log redaction, and document instruction isolation. Test with a mocked provider here. Include D2 in Ireland's laptop confirmation.

**Acceptance:** synthetic base contract plus signed counteroffer updates the appropriate proposed terms; missing/scanned/oversized/unsupported material, no route, timeout and invalid JSON all leave manual creation usable. Never silently truncate source pages or label failed extraction as 'not in contract'. Retry stays inside the overall time budget. Late/retried/skipped jobs cannot alter user edits or publish a file. Amendment uploads do not automatically re-extract confirmed files.

**R04 checks:** inspect outbound request shape with a fake gateway, verify every source/version is represented, inject malicious document instructions and out-of-order completion, and test failed/partial bundle handling. Actual OpenRouter route/privacy acceptance is C15's Ireland-laptop handoff.

### C05 — Intake, review, confirmation and lifecycle

**Owns:** `packages/intake/**`; extracted matter lifecycle/file-review/extraction-approval command and route modules; `workspace/new/page.tsx`, `workspace/intakes/**`, transaction `setup/page.tsx`, existing `InitialFileReview.tsx` / `IntakeInbox.tsx`, shared `SavedIntakeDetails.tsx`; portal intake route and intake-only components/styles (`Intake`, `LegacyIntake`, reference model/DOM/review/templates, `ContactAutofill`, intake CSS); `workspace/_features/creation/**` and lifecycle-action components.

**Deliver:** HTO skips service selection while retaining gift question; server resolves membership/business defaults without trusting browser fields. Preserve existing form save/resume and upload rules except explicit changes. One creation screen shows collapsible immutable intake details, editable facts/people/dates, all source-document View links, upload/replace and business choice. Manual start uses the same flow. Confirm atomically associates all records, consumes intake once and seeds current side's checklist. Do not mark an intake processed when the review merely opens. Expose original intake read-only on the file; forward-compatible detail rendering includes new submitted fields.

**Lifecycle:** explicit close-out with nonblocking unchecked-item warning, reopen, termination with optional reason, and DELETE-confirmed permanent deletion per D7. Closing a task never changes file lifecycle. Preserve old lifecycle history. Cancel/invalidate stale extraction, draft sends, reminders and checkouts through registered hooks; retain the intake's consumed/deleted disposition. No network calls in confirmation/delete DB transactions.

**Acceptance:** intake/manual paths, extraction Skip/failure, abandon/reopen/reload, duplicate submits/confirms, stale revisions, late extraction, contact precedence, upload replacement, and full intake preservation. Reopening works from Closed and Terminated; no automatic new fee or resurrected send. Agent/client attempts to mutate lifecycle or view another intake fail. After deletion no orphan job can act on the file.

**Dispatch milestone C05-domain:** R05 accepts canonical confirmation/lifecycle commands and their hook contract using deterministic injected test hooks, before C11 starts dependent acceptance. This does not certify live HTO sync. C15 separately accepts C05+C11's real atomic row creation, linking, rollback and bidirectional edits after C00 wires them; C05-domain never depends on completed C11 acceptance.

**R05 checks:** race two confirmations and two lifecycle actions, inspect database/publication state before and after, exercise old endpoints, and verify intake deletion versus file deletion are separate and correctly authorized.

### C06 — People, documents, client links and projections

**Owns:** `packages/documents/**`, `packages/contacts/**`, existing matter `checklist-sharing.ts`, extracted matter queries and all role-specific projection modules, new `packages/matters/src/people/**`; `workspace/_features/people/**`, `documents/**`, `sharing/**`; existing coordinator Contacts/BusinessContact components and contact route; document UI/upload queue/hooks/utilities and `ChecklistShare.tsx`. Shared `data.ts` stays C00. Portal renderers stay C13.

**Deliver:** contact snapshots, saved-directory suggestions, optional Add to this deal, replacement/add-alongside and independent people switches. Contact records never become participants/logins. Apply buyer/seller visibility defaults; later additions default hidden. Sending to a new address saves directory history through C07's integration, without adding it to the file automatically.

Implement actor-based document defaults, independent flags, View/Download and authorized agent uploads of a new document; preserve versions internally while hiding version UI. Email attachments reuse stored documents without changing portal visibility. Build role-limited ZIP download for closed files. Expand authenticated and bearer projections to the approved timeline/team/documents; clients receive no notes, not-needed rows, emails, private to-dos, agreements, full intake or hidden data. Agents see only explicitly shared step notes and documents/people; client-only documents must not become agent-visible by implication.

Implement D6: agent copy/retrieve existing client link; coordinator alone creates/replaces/revokes. All file, document, version and ZIP endpoints recheck current access/audience; a shared-link token does not grant normal authenticated API access. Preserve revocation/expiry/no-store/noindex/no-referrer protections.

**Acceptance:** role × audience matrix on metadata and content, cross-file IDs, public/authenticated-client parity, client-only and agent-only documents, agreement privacy, revoked/expired links, agent copy without rotation, hidden step-note absence and safe ZIP contents. Directory edits never rewrite historical transaction/sent-recipient snapshots.

**R06 checks:** attack direct URLs and alternate read APIs, inspect response JSON as well as UI, test role/membership withdrawal and share revocation during document access, and independently enumerate ZIP entries.

### C07 — Emails, templates, composer and retained Inbox

**Owns:** `packages/communications/**` except existing `src/reminders.ts` and `test/reminders.test.ts` (C12); existing `CommunicationTools.tsx`, `EmailSuggestions.tsx`, extracted Inbox component and Inbox route; `workspace/_features/emails/**`, new template Settings component/subroute. Does not own root Settings composition, Contacts, private daily digest, schema or worker bootstrap.

**Deliver:** buyer/seller template sets grouped by recipient, management add/edit/reorder/delete and optional checklist links, editable placeholders until final content arrives, preserved old service-group assignments/user templates. Composer supports normal recipients, chips, typed addresses, explicit Add to deal and role replacement through C06, attachments and scratch emails. Merge fields read canonical facts and render missing values as editable blanks. A pre-send review must make missing/placeholder content actionable without restoring the old transaction-date review blockers.

Create durable actual-send versus manual-checkoff state, send dates, uncheck/recheck behavior, checklist Send now/Later/Skip prompts, explicit email reminder dates and one To send query. Later without a date belongs on To send but not Due this week; a dated reminder belongs on its due date. Sending clears queued work and marks completion; failed/uncertain delivery does not falsely show Sent. No checkoff/reminder/AI action automatically sends. Attachments are saved once and never shared merely by emailing them. Retain Gmail threading, direct-mailbox sends, replies and Inbox behavior with mocked transport locally.

**Acceptance:** stale drafts after date/person/template edits, preserved sent history, recipient replacement, typed outsiders, missing fields, duplicate send/retry/uncertain result, manual completion, reminders cleared/rescheduled/sent, template deletion/reorder and two templates linked to one task. No portal/API email leakage. Closing/reopening/deleting cannot resurrect an obsolete send.

**R07 checks:** independently intercept send jobs/recipients, verify no accidental autosend or placeholder send, inspect current versus sent snapshots, and test all reminder surfaces against the same work IDs. Real Gmail send/reply verification waits for Ireland's laptop.

### C08 — Roster, onboarding and agent identity policy

**Owns:** `packages/onboarding/**`, `packages/identity/**` and their tests; new roster route/components, old onboarding route; existing signed-agreement, booking and UserPicker UI components. Central Settings mounts integration controls through C00. Account page rendering belongs to C13.

**Deliver:** Inquiry → Agreement sent → Agreement signed → Invited → Active, generated status text/dates, manual sent-date recording, signed upload/version history and private agreements. Roster groups HTO then Weatherly, searchable A–Z active agents, signup panel, file counts/list and editable contact/profile phone. Website inquiries/Calendly/signer adapters dedupe by email and preserve events; use doubles for optional connections. No automatic follow-up/resend policy.

HTO membership is managed here and feeds server intake/business/fee rules. HTO agents bypass Weatherly service-agreement requirements while retaining normal authorized account access and optional MFA. Weatherly agents retain approved agreement gates. Adding/removing affiliation does not rewrite old files, orders or agreement history, and roster contacts are not automatically active login accounts.

**Acceptance:** duplicate inquiry/booking events, signed agreement then invite, resend without duplicate accounts, accepted invitation status, manual HTO onboarding without agreement/service fee, membership changes and historical preservation. Signup archive applies only to inquiries; no transaction/intake archiving is introduced.

**R08 checks:** inspect server session/access rules with both businesses, agreement privacy and signup transitions, duplicate-email races, phone persistence and unchanged preview logins/passwords.

### C09 — Billing and payments

**Owns:** `packages/billing/**`, payments route, existing BillingOperations/PaymentLink and extracted Payments component, new `workspace/_features/payments/**`. C13 renders account/portal history using C09 contracts.

**Deliver:** enforce HTO no-service-fee at order creation, checkout creation/resume, webhook reconciliation and every legacy endpoint; hide corresponding UI while preserving independently authorized gifts. Weatherly $425/$515 snapshots remain due at closing with existing provider safeguards. Replace eligibility that depends on the removed Stage dropdown with an explicit closing-payment request flow; neither checking Closing nor closing out the file automatically sends a payment link or charges. Apply requested Compliance description wording only. Reconcile file-business changes and termination/reopen through D5; no invented refund/credit policy, new gift ordering workflow or automatic charge.

**Acceptance:** forged HTO service requests/old links denied, membership/file business distinctions, historical prices/payments retained, optional gifts still separate, termination cancels outstanding service requests, reopen does not reactivate a canceled checkout silently, and webhook replay/settlement races retain correct records.

**R09 checks:** invoke backend routes directly and simulate webhook/provider races using doubles. Real Stripe credentials, webhooks and test-mode checkout acceptance occur on Ireland's laptop.

### C10 — Private notes and to-dos

**Owns:** new `packages/matters/src/private-notes/**`, Notes route, `workspace/_features/private-notes/**`. Schema C01; Overview composition C12; file composition C14.

**Deliver:** coordinator-only checkable note/to-do items with optional transaction association and shared IDs across file/Notes/Overview, multiline text, completion kept visible, individual delete and Clear completed. Separate general autosaved scratchpad with revision-safe saves. Notes page links to active files; a file side panel appears on every tab. Overview shows five items and View all, without add box. Checklist step notes remain C03's distinct record type.

**Acceptance:** cross-view completion, general/file items, stale autosaves/two tabs, checked-item retention, scoped Clear completed and private reads/writes. File deletion/termination behavior follows lifecycle contract; no orphan visible list items.

**R10 checks:** direct cross-role requests, autosave ordering and deletion scope; confirm scratchpad text never enters any list, portal, digest or file.

### C11 — HTO Operations and CSV export

**Owns:** new `packages/matters/src/hto-operations/**`, HTO route, `workspace/_features/hto-operations/**`. Does not own roster, schema or lifecycle commands.

**Deliver:** manual listing/uncoordinated rows, automatic linked rows through injected confirmation/lifecycle hooks, D5-compatible matching, file-driven status and Fell through behavior. All editable fields on linked rows call C05's canonical commands; closing-date changes use C03 preview/apply and cannot bypass dependent-date review. Manual status edits never create/mutate transactions. Track prior/new price, current-filter totals and By agent. Roster supplies the named team list; do not invent contact details from screen examples.

Implement filters/date ranges including always-visible undated/listing rows and one-person-per-row FUB CSV, exact supplied columns, selection-over-filter precedence, correct filename/tip, structured address/name handling, proper quoting/Unicode and spreadsheet-formula safety. No direct FUB connection. Matching never merges distinct contract lifecycles or email history.

**Acceptance:** same-property replacement and unit collisions, ambiguous manual matches, no duplicate links on retry, bidirectional field edits, closed/reopen/terminate, manual status isolation, price history/totals and multi-client CSV with no agent phone/email fields.

**R11 checks:** independently calculate filtered totals/export rows, attempt lifecycle/date bypass through HTO endpoints, and test business changes and concurrent link creation.

### C12 — Overview, transaction list, Calendar and daily update

**Owns:** workspace Overview and Transactions list routes; existing Dashboard/PortfolioOverview and Calendar route/CSS; new `packages/matters/src/portfolio/**` and `workspace/_features/portfolio/**`; `packages/communications/src/reminders.ts` and its existing test. Consumes C07 email work, C08 signup and C10 notes APIs; does not mutate their records directly except through their commands.

**Deliver:** Overview New intakes with Create/delete, manual-start link, Due this week, five notes and signup summary; only meaningful existing send-failure notices. Simplified transaction list with status/business/search filters, matching count, correct serving agent/client search, next deadline/closing and canonical To send column. No count-card/stage/progress clutter. Retain usable month Calendar and complete paginated/range queries.

Extend the existing private digest with D8's intake window, without separate per-intake notifications. Include agent/property/side/time even if that intake was processed before delivery. Weekday timezone/DST and no-new-intake message behavior remain correct; intake-only days still send. C00 redirects old intake-notification job registration to the new no-per-intake-send behavior so already queued work cannot deliver duplicates.

**Acceptance:** more records than initial page limits, combined filters/counts/search, undated/completed/not-needed/inactive work, email reminders across list/file/Overview, hidden signup summary when empty, digest retry/dedupe/window/weekend/DST, and exact private recipient. Disabled mail remains accurately disabled.

**R12 checks:** independent fixture totals and timezone dates, old queued notification replay, already-processed intake summaries, intake-only delivery and completion/termination invalidation.

### C13 — Agent/client portals and account UI

**Owns:** portal home/file routes, portal layout and `portal.module.css`, `SharedMessages.tsx` retirement and new portal-only views; `apps/web/app/checklist/**`; all `apps/web/app/(account)/**` UI/layouts/styles/navigation, including retained login, invite, forgot/reset-password, account, security and assistant-authorization screens. Portal intake route and intake-only components/CSS stay C05. Root app theme/layout remains C02; no edits to identity/billing/projection services.

**Deliver:** reference-aligned agent home/files with Active/Closed/Terminated and intake-received state, read-only matching timeline, approved notes/people/documents, new-document upload for active authorized files, service/gift box rules and copy-only client link. Closed files retain allowed documents/ZIP; terminated views are read-only. Remove shared conversations, versions and live/checked-at wording. Account retains phone/profile, optional two-step login/password recovery and correctly scoped service/gift payment history.

Client bearer and authenticated-preview views consume the same safe projection: side-specific timeline, no not-needed items/notes, scheduled appointment fallback, shared documents only when present, allowed team/email actions, Closed state and supplied branding. No messaging or What we need from you. Final client wording remains D9 content work, never inferred from sample notes.

**Acceptance:** buyer/seller, cash/financed, both businesses, intake-only/active/closed/terminated, no gift/with gift, no shared docs, link expired/revoked, desktop/mobile and preview-account access. No client mutation/upload controls. Verify the underlying API independently through C06's authorization tests.

**R13 checks:** real local sessions for all three roles plus bearer links, negative direct URLs, current versus stale visibility, responsive/keyboard behavior, and no private data in DOM/network payloads.

### C14 — Coordinator transaction file

**Owns:** transaction `transactions/[id]/page.tsx` and extracted file frame, `workspace/_features/transaction-workspace/**`. Setup route belongs to C05; child feature modules belong to their feature chunks.

**Deliver:** header business/side/client/closing facts; Checklist, Emails, Documents, Intake and empty Compliance tabs; persistent People/Share/private-note side panel on every tab. Compose child modules without duplicating data or mutation logic. Mount explicit lifecycle actions at the checklist bottom; no stage dropdown, legacy Dates & deadlines, unresolved banner, standalone document review or private-notes tab. Preserve legacy broker data invisibly, not by deleting it.

**Acceptance:** every tab shares the same file/contact/note state, correct locks and business changes, no accidental lifecycle changes, unchecked-item warning, empty Compliance never blocks any action, intake read-only and complete, mobile stacking/overflow and retained file URLs.

**R14 checks:** compare reference layout and normative differences, inspect concurrent updates across tabs and legacy route navigation, and verify parent composition does not bypass feature APIs or duplicate state.

### C15 — Integrated acceptance and Ireland-laptop handoff

**Owns:** shared `tests/**` and new cross-feature browser/API acceptance fixtures; `docs/release/intake-to-transaction.md` and `docs/runbooks/intake-to-transaction-ireland-laptop.md`; final release/test evidence. Does not silently repair product modules; findings go to the owning pair.

**Deliver:** fresh and populated migration rehearsals, full appropriate domain test run, typecheck, production build, real synthetic-session HTTP acceptance, and real-browser desktop/mobile journeys. Verify legacy uploads, backup/restore, invitation/recovery, direct URLs, assistant/MCP projections and all retained app surfaces. Freeze exact candidate revision, review logs and distinguish local pass from account-dependent pass.

**R15 checks:** independently run key journeys and privacy/migration/lifecycle races at the final integrated commit, review all pair reports and outstanding inputs, and reject acceptance based only on screenshots or unit tests. Any material fix invalidates affected evidence and is rechecked by its reviewer plus R15 as needed.

Prepare the laptop runbook with provider-specific settings/placeholders, callback URLs, webhook paths, model/provider privacy requirements, test-recipient procedure, retry/recovery checks and expected evidence. Do not include credentials or imply account access here. Deployment and production migrations remain separate explicitly authorized release actions; this plan does not perform them.

## Execution order and integration gates

Build coding may start against frozen contracts/doubles before every downstream service is available; **chunk acceptance waits for the listed dependencies**, with mocked-only evidence labeled accurately. Avoid fake working screens or no-op production hooks.

1. **Gate A — C00 refactor/contracts:** review existing behavior, split shared files and freeze ownership/interfaces. C01 may design persistence concurrently, but does not merge incompatible schemas. Resolve or isolate D1–D10 as above.
2. **Wave 1 — foundations:** C01 and C02. C00 integrates only their reviewed commits. No feature builder edits the schema or root theme.
3. **Wave 2 — independent domains:** C03, C04, C08 and C10; C09 starts once membership policy is frozen. Schedule pairs within the actual slot limit.
4. **Wave 3 — creation and sharing:** C05 and C06, followed by C07 and C11. R05 accepts the named C05-domain milestone with deterministic hooks before C11's dependent acceptance. C15 owns the subsequent combined automatic-row acceptance after C11 and C00 wiring. C11 consumes lifecycle commands through injection, so neither package imports the other cyclically.
5. **Wave 4 — composed experiences:** C12, C13 and C14, using accepted domain modules. Theme comparisons cover retained Inbox/Contacts/Calendar/Settings/account as well as replacement screens.
6. **Gate B — C00 final wiring:** all route/job/change-hook and compatibility paths use the new services; no old endpoint bypasses fee, date, publication or audience rules. Run affected regressions after every merge.
7. **Gate C — C15 + R15 local release candidate:** exact-commit integrated acceptance, migrations/preservation, privacy and UI evidence. Local-ready does not mean provider-connected or deployed.
8. **Gate D — Ireland's laptop:** account owner completes connections/configuration and controlled provider acceptance with the prepared runbook. Record each provider as unconfigured / configured / verified with date and evidence. Approve release separately after account-dependent requirements and remaining product inputs are satisfied.

### Integration protocol

- Builder submits commit, dependency revisions, allowlist diff, migration requests, tests, browser evidence where relevant, and named external inputs. Reviewer records findings independently; acceptance includes the final fixed commit hash.
- Coordinator checks the diff stays within ownership before integrating. Shared-file changes are applied by their owner from concrete interface requests, not broad permission to edit another chunk.
- New schema needs return to C01; new cross-feature type changes return to C00 and all consumers are notified. Do not merge a private type fork or add duplicate state to avoid a contract discussion.
- Each integrated checkpoint records the candidate hash. Do not count earlier tests or reviewer approval as evidence for a later changed hash without checking affected differences.
- A migration/reset/seed command may target only the explicitly disposable test database. No agent may infer permission to migrate hosted data, send email, create a real booking, process client contracts or take payments.

## Requirement coverage map

| Handoff section | Primary implementation | Cross-chunk integration / review |
| --- | --- | --- |
| Look and feel; logos; Open Graph | C02 | C12/C13/C14 compose; R02/R15 compare retained and replacement screens |
| Overview and Intakes | C05 + C12 | C08 HTO membership; C04 extraction; C00 removes old notification/route behavior |
| Create transaction and merge fields | C05 | C03 dates, C04 AI, C06 contacts/docs, C07 merge fields, C11 HTO atomic sync |
| Linked dates, extensions and amendments | C03 | C04 normalization, C05 confirmation, C07 extension merge context, C11 edits |
| Buyer/seller checklist and Not needed | C03 | C06 projections, C13 portals, C14 workspace |
| Transactions list | C12 | C07 canonical email work; C05 lifecycle; C08 serving agent |
| Close out, reopen, terminate, delete | C05 | C06 blobs/share, C07 send jobs, C09 checkout, C10 notes, C11 operations, C12 digest |
| Documents and emailed attachments | C06 | C07 composer/storage integration; C13 allowed list/ZIP |
| Compliance | C14 | C01 preserves old data; content deferred |
| People, Contacts and emails | C06 + C07 | C05 intake precedence; C08 profile; C13 safe rendering |
| Agent portal and Account | C13 | C05 intake, C06 projections/link/doc upload, C08 identity, C09 payments |
| Client portal and Who sees what | C06 + C13 | C03 checklist states, C02 branding, C15 bearer/session parity |
| Notes and to-dos | C10 | C12 overview; C14 persistent side panel |
| Agent roster and agreements | C08 | C01 data, C12 signup summary, C05/C09 membership policy |
| Payments and HTO exceptions | C09 | C08 membership, C05 business/lifecycle, C13 account presentation |
| HTO Operations and FUB CSV | C11 | C05 canonical facts/lifecycle, C03 date preview, C08 roster |
| AI setup, prompt and unavailable fallback | C04 | D1–D3, C05 generation/confirm, C15 Ireland-laptop provider acceptance |
| Preserve existing data and preview logins | C01 | Every pair preserves owned behavior; R01/R08/R15 verify |

## Final local acceptance journeys

1. A Weatherly buyer agent uploads a synthetic contract/counteroffer and submits an intake. It appears on Overview and as Intake received in that agent's portal. Opening/canceling review does not consume it. Ireland corrects proposed values and confirms exactly once; the original intake and documents remain available.
2. An HTO seller skips package choice, requests an existing optional gift, and submits. Confirmation creates the seller checklist, no service-fee path and exactly one appropriate HTO row. Roster membership changes do not rewrite the file's business/history.
3. Manual creation works with no contract, unavailable AI, blank dates and no intake snapshot. It has the same business/checklist/lifecycle behavior and no false submitted-intake attribution.
4. Ireland previews/applies an extension and changes closing, with completed/manual/earliest-of/calendar cases. Checklist, next deadline, Calendar, email merges and portals agree. An HTO edit goes through the same preview and cannot bypass it.
5. Ireland shares selected people/documents and an agent-visible step note. Agent and both client access paths show exactly their allowed content. Copying the link does not rotate it; revocation blocks future timeline/document access. Clients never receive notes or not-needed steps.
6. Ireland checks a milestone, chooses Later, assigns/reschedules a reminder, drafts a template and a scratch email, and manually checks another off. All To send surfaces agree. A fake send failure remains failed; actual-send and manual completion remain distinguishable; attachments never gain portal visibility automatically.
7. A Friday/weekend intake is processed before Monday's digest. It still appears once in the next appropriate private update, including when there are no deadline items. No old queued per-intake notification sends separately.
8. Close out warns without blocking on unchecked items, updates agent/client/HTO state, and preserves allowed read-only downloads. Reopen reverses status; terminate prevents a new service charge; confirmed deletion leaves no acting job, available link or orphaned file blob and does not reset the intake to New.
9. Notes/roster/HTO filters and totals persist across sessions. FUB export has exactly one person per CSV row and honors selection/filter rules. Existing user templates, historical fees, legacy custom checklists and preview passwords survive migration.

## Ireland-laptop acceptance and release handoff

| Area | Work from Ireland's laptop | Evidence required |
| --- | --- | --- |
| Gmail / Google Workspace | Connect her mailbox/consent, configure callbacks/watch if used; explicit controlled-recipient send/reply and direct Gmail sync. | Correct sender, thread/reply attached to correct file/Inbox, retries/revocation handled; no automatic send. |
| OpenRouter | Configure her key/model/approved ZDR providers, verify account privacy, confirm no alternate route, and use an approved representative contract bundle. | Counteroffer precedence, route restrictions and fail-to-manual behavior; no contract contents/secrets in logs. |
| Stripe | Configure her test account/key/webhook, then test closing service checkout/replay/termination and HTO denial. | Correct $425/$515 snapshot, no HTO service fee, gifts separate, no premature live charges. |
| Calendly / optional signer | Configure her approved URL/event/webhook/signature tool only if actually used. | Booking/inquiry merge, agreement step evidence, private signed file and correct invite state. |
| System mail / daily update | Configure her approved sender and private recipient through the chosen existing mail service. | Actual invite/recovery/digest receipt, intake window/weekend behavior, no duplicate intake notice. |
| Hosting / deployment settings | Review her target environment, secrets and callback origins, backup/restore evidence and migration order; deploy only when separately authorized. | Serving revisions for web/API/worker, applied migration, health plus relevant end-to-end checks, rollback path. |

Completion report must distinguish: **implemented locally**, **independently accepted at commit**, **awaiting content/decision**, **awaiting Ireland-laptop account verification**, and **actually deployed**. No chunk is reported as fully released merely because its local code or mock tests pass.
