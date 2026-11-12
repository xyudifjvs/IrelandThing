# C03 checklist persistence and coordinator controls

The new checklist uses keyed Task rows as its displayed steps. The date graph stores due dates, exact instants, actual event dates, and actual instants separately. Appointments use the existing task details fields. The coordinator reviews a preview before applying a date edit or extension. Actual HOA delivery and completion save in the same transaction. Legacy files continue to use their existing controls.

## Interfaces for downstream work

- C05 calls `seedMatterChecklist(tx, matterId, input)` from `checklist/persistence.ts` within its confirmation transaction. `ChecklistSeed` comes from `checklist/seed.ts`. Start with an unversioned matter. The seeder rejects existing keyed rows or a set version, then writes the version, acceptance, timezone, and checklist. Existing unkeyed task and deadline rows are preserved for history.
- C06 strips `Matter.details.checklistDateAnchors` from role projections and protects note visibility. C05 must preserve the field on fact edits. The Remedies anchor only appears in the date graph.
- C11 can call `previewMatterChecklistDates(actor, matterId, input, tx?)` and `applyMatterChecklistDates(actor, matterId, input, tx?)` from `checklist/date-commands.ts`. HTTP clients use `POST /api/v1/matters/:id/checklist/dates/preview` and `POST /api/v1/matters/:id/checklist/dates/apply`. Apply checks the same revision and preview digest under the row lock and returns the new revision and changed step keys.
- Canonical due date consumers use keyed tasks and honor task status. Legacy deadline records are historical on a versioned file.

## Builder verification

The root typecheck and a local Next.js production build using Webpack passed. The default Turbopack build could not resolve the Next.js dependency through the isolated worktree's node_modules symlinks. The PostgreSQL acceptance runner applied 19 migrations and passed 156 tests across 22 files for matters, intake, AI, and communications. Coverage includes the 19 pure checklist tests and five integration tests for existing-file activation, extension concurrency, pinning, HOA delivery rollback, and step permissions. Browser workflow validation belongs to integrated acceptance. The test run used synthetic data and local PostgreSQL.

## Independent review follow-up

The coordinator can amend the Remedies request deadline from the Inspections row. The editor reads the saved calculation anchor and uses the same preview and apply commands as displayed dates. The buyer and seller templates still contain 16 and 13 rows respectively. Coordinator detail must retain the anchor for this control.

The appointment editor uses the coordinator's browser timezone. It rejects a local time that falls in a daylight-saving gap and shows both UTC offsets when a local time repeats. A place-only edit preserves the existing appointment instant.

The follow-up passed typecheck, a Webpack production build, 48 focused PostgreSQL tests, and Chromium with real checklist routes and disposable synthetic records. Chromium confirmed the Remedies preview and save, rejection of a nonexistent time, explicit selection of the second repeated hour, and preservation of that instant during a place edit.

## HTO closing-date adapter

C11 can inject `previewHtoChecklistClosingDate` and `applyHtoChecklistClosingDate` from `checklist/date-commands.ts` and pass the locked linked-row transaction. The adapter uses the canonical edit and apply shapes, accepts only a set of the Closing due date on an eligible linked HTO file, and binds the preview to HTO Operations. The audit event records its source.

On a closed or terminated file, the correction can change the completed Closing due date. Its status and actual event remain intact. The selected apply mode governs eligible unfinished dependents, and the canonical change hook still runs in the same transaction. The ordinary File routes keep terminal checklists read-only. Ireland's confirmation of terminal-row corrections is tracked in the handoff.
