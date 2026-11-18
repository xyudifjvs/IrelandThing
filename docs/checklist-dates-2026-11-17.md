# Checklist dates, display text, and Remedies — November 17, 2026

## Ireland's requested behavior

Creation with or without an intake accepts a real calendar date, optional display text, or both for every dated checklist step. Examples: `on or before 8/30/26`, `within 3 days of closing`, `Received`, and `date and time of closing`. Saved display text appears in agent, authenticated client, and public client timelines, and active closing summaries. When text is empty, the date or existing reviewed-rule wording appears. Existing exact deadline times are formatted in the transaction timezone. The creation form previews the shared label and saves text in resumable reviews.

Display text is literal. It does not parse or invent a deadline, move downstream dates, complete a checkbox, or create a reminder without a real date. Date changes retain the reviewed contract graph and existing preview/Update all behavior. Actual closing dates still appear on completed-file summaries. Optional wording can also be edited on the transaction checklist under **Date display text**.

Three separate steps remain in order: **Home Inspections** (seller files retain **Buyer's Inspections**), **Remedies**, and **Remedies Negotiated**. Each has its own completion checkbox, due-date controls, and display text. The previous standard **Repairs Agreed On** label becomes **Remedies Negotiated**. Coordinator-customized titles are retained.

## Existing data and deployment

Migration `20261118010000_remedies_checklist_step` promotes the stored Remedies graph anchor to a normal task on existing version-1 checklists. It preserves due/actual dates, exact instants, date rule, completion/not-needed state, and downstream key references; it inherits the inspection row's visibility. Other task order is retained. The promoted anchor is removed from hidden anchors to prevent duplicate graph keys. New buyer checklists have 17 steps; seller checklists have 14. Older noncanonical workflow files are unchanged. No emails or provider variables are changed by this release.

Rollout target: existing Weatherly Railway project, environment **staging**, real site https://www.weatherlytc.com. API deploy runs the normal `npm run db:deploy` pre-deploy safeguard before the new web release. API, worker, and web should be pinned to the same release commit/branch. Deployment receipt will be added after successful rollout.

## Validation

- Full disposable-local-database regression run: **471 passed across 72 files**. Six existing backup/recovery tests were excluded because local pg_dump/pg_restore are unavailable.
- Final closing-summary follow-up: **25 passed across 2 files**, including the new actual-versus-display closing-date check.
- Root TypeScript check and final Next production build passed.
- Integration coverage confirms manual and intake creation, save/resume/confirm, text-only entries, real dates with wording, agent/client/list/public projections, private-note/rule exclusion, independent Remedies completion, and preservation of old Remedies state/order/visibility during backfill.
- Local browser acceptance: both creation entry points expose matching date/text fields; the selected fixed date and wording survive Save review; the migrated checklist has three separate inspection/remedies items; Remedies' checkbox works independently; the public client timeline displays the saved date, literal wording, and updated completion state. These checks used only synthetic local data. The local launcher omits credential encryption, so the public preview was seeded as a temporary synthetic share fixture rather than generated through the local Share control.
- Hosted coordinator/agent/client data edits and real outgoing emails are outside this verification.
