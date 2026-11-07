# Intake review queue release review — November 7, 2026

Reviewed Ireland's `4f0a278` change on `codex/intake-review-queue` against `main` at `4909e56`. The submitted-intake inbox, coordinator transaction handoff, original document/contact preservation, manual creation, contract/date review and milestone syncing are retained.

The failed GitHub run [42316637571](https://github.com/xyudifjvs/IrelandThing/actions/runs/42316637571) passed migrations, TypeScript, unit tests and the production build. Its HTTP acceptance test still submitted an intake as a coordinator and received the intended 403. Acceptance now uses an agent, verifies coordinator/client denials, checks the new inbox and verifies the coordinator-only, repeat-safe handoff before activation.

Three additional regressions were reproduced before correcting the source:

- The intake-detail API exposed coordinator-only document metadata to the submitting agent. Its document query now enforces document audiences.
- Saving a task date together with a note/appointment replaced the newly merged metadata. The manual-override flag now preserves that metadata.
- A confirmed deadline with an alias such as “Closing deadline” did not inherit a subsequent narrowing of its linked “Closing date” task's audience. Projection now follows the saved source deadline IDs when resolving linked task audiences. Public visibility requires the linked milestone to allow clients.

Validation of the corrected source:

- All 18 migrations applied to a new disposable PostgreSQL 17 database.
- 328 tests in 49 files passed through the isolated database runner, including encrypted backup/restore, private document metadata, combined date/note saves, aliased deadline audiences, and notification replay/redaction using a mock sender.
- Global TypeScript, optimized production web build and deployment safeguards passed.
- All 10 HTTP acceptance groups passed with real synthetic sessions and no provider calls.
- A real local Chrome session verified agent contract upload, desktop/mobile inbox and intake detail, saved-document handoff, explicit unresolved-date activation and manual transaction creation. The tested mobile screens had no horizontal overflow or browser runtime errors.

The schema change is additive (`processedAt`, `processedById`, and a queue index); existing active transaction submissions are backfilled as processed. Provider credentials and activation flags are unchanged. Live mail, AI extraction and other provider-account acceptance are outside this local validation. GitHub quality checks must pass for the final branch head before merge; Railway service statuses and the public health endpoint must be checked after automatic deployment from `main`.
