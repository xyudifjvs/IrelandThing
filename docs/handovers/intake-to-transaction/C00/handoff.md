# Shared refactor handoff

Base `2177674`. Integration branch `codex/intake-to-transaction`. The backend builder worked in `/private/tmp/weatherly-handoff-c00-matters` at `c791c90`. The coordinator extracted the workspace UI and authored the shared request contracts. Independent reviewer R00 reviewed the backend candidate and checks the combined gate before ownership transfers.

## Ownership after the gate

Backend paths and the preserved route/export inventory are recorded in [the backend refactor handoff](backend-refactor.md). The data and service interfaces are in [the shared contracts](contracts.md).

Paths below are relative to `apps/web/app/(workspace)/workspace/`.

| Owner | Extracted files |
| --- | --- |
| C00 | `_components/Operations.tsx`, `_components/WorkspaceHeading.tsx`, `_components/integration-summary.ts`, `_components/transaction-controls.tsx`, `_components/LegacyDocumentReview.tsx`, `_components/settings/Settings.tsx` |
| C03 | `_features/checklist/TransactionChecklistPanel.tsx`, `_features/checklist/LegacyDatesPanel.tsx`, `_features/checklist/LegacyDeadlineEditor.tsx` |
| C06 | `_features/people/LegacyFilePeoplePanel.tsx` |
| C07 | `_features/emails/Inbox.tsx`, `_features/emails/LegacyTransactionEmailPanel.tsx` |
| C09 | `_features/payments/Payments.tsx` |
| C10 | `_features/private-notes/LegacyFileNotesPanel.tsx` |
| C14 | `transactions/[id]/page.tsx`, `_features/transaction-workspace/TransactionWorkspace.tsx`, `_features/transaction-workspace/LegacyBrokerPanel.tsx` |

The transaction route retains its file-ID remount and one shared upload queue. The workspace still owns busy/error state and keeps drafts while switching tabs. The existing Settings, Payments, Inbox, Review and Heading exports remain reachable from `Operations.tsx`. Product replacements and removal of legacy screens follow their owning chunks.

The contract package subpath and `packages/platform/src/handoff-contracts/` stay with C00. C01 owns schema and migrations. C05 owns future receipt guards and the new creation path. If a schema addition would widen a current return type, land the corresponding compatibility change before enabling new records.

## Local validation

The baseline checkout's default `.env.test` points to a different local port and the sandbox denies its socket. A dedicated PostgreSQL 17 container, `weatherly-handoff-test-db`, uses loopback port 55462 and synthetic credentials. Each suite creates and drops a distinct database through the repository runner. No existing local or hosted database is reset.

The extracted UI passed TypeScript, the production build, and all 328 existing tests in 49 files against a disposable database. The backend builder passed 132 focused tests, and independent R00 passed 56 tests covering matters, communication hooks and billing termination. The combined revision receives a separate final check.
