# C11 HTO Operations and Follow Up Boss CSV

The workspace route is `/workspace/hto-operations`. C00 adds the Home Team Ohio navigation entry and mounts the HTO router at `/api/v1/hto-operations` with the workspace session, origin and rate checks. The router verifies coordinator access and returns private, no-store responses. It uses the saved, unarchived Home Team Ohio entries specified by C08's roster contract. Previously assigned roster entries stay visible on historical rows.

## Integration

Import the following exports from `packages/matters/src/hto-operations/index.ts`.

- `createHtoOperationsRouter({ updateFileFacts, closingDates })` accepts C05's canonical facts command `(tx, actor, matterId, input) => Promise<{ matterId, revision }>`. Supply C03's `previewHtoChecklistClosingDate` and `applyHtoChecklistClosingDate` as `closingDates.preview` and `closingDates.apply`, with `historicalDateEdits: true`. The wrappers receive the active transaction and the canonical Closing set command. Without the HTO wrappers, active date edits use the ordinary C03 commands.
- Call `syncHtoClosing(tx, actor, matterId)` inside the same transaction after C05 confirms a file and after lifecycle or business changes. It can also run through `matterChanged` so the match key stays current when the canonical property address changes. Each active linked row projects current file facts and stage directly.
- Call `removeHtoClosingBeforeDelete(tx, actor, matterId)` before the permanent Matter delete in the same transaction. This resolves the HTO row's restrictive foreign key. The canonical delete and provider cleanup remain part of C00's D7 composition.
- Acquire the Matter row lock before the HTO advisory lock. The linked hooks and commands enforce this order. Manual rows acquire only the HTO lock.

| Method and path relative to the mount | Inputs and result                                                                                                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                               | Optional `agentId`, `status` and `range`. Returns rows, agents, filtered totals and closed activity by agent for the selected period. The default range is `this_year` in America/New_York.          |
| `POST /rows`, `PATCH /rows/:id`       | Manual row with structured address, optional team assignment, clients, side, status, close/listed dates and price cents. Patch requires the row `expectedRevision`. Returns the row ID and revision. |
| `PATCH /rows/:id/facts`               | Linked row with the file's `expectedRevision` and optional agent, structured address/display address, contact snapshots, side or price. Runs the C05 command.                                        |
| `POST /rows/:id/closing-date/preview` | File `expectedRevision` and civil `date` or null. Returns C03 preview and digest.                                                                                                                    |
| `POST /rows/:id/closing-date/apply`   | Same revision/date, `previewDigest` and explicit `mode` of `update_all` or `only_this_date`. Returns the file revision and changed checklist keys.                                                   |
| `POST /rows/:id/match`                | `action`, match `key`, `expectedMatterRevision` and `expectedRowRevision`. Link also requires `candidateId` and `candidateRevision`.                                                                 |
| `POST /export`                        | `{ filters, rowIds? }`. Explicit selection takes precedence over filtering. Returns a UTF-8 CSV attachment with one line per person.                                                                 |

## Decisions for Ireland

- D5 matching links only an unambiguous active manual row with compatible side, team assignment, lifecycle and full address. Where dates and prices are needed to disambiguate an under-contract row, the matching rule uses the known canonical values. Preserve unit identifiers. Near or ambiguous matches require a current coordinator choice. Keep separate dismisses that candidate set for the file. When confirmed, the manual row keeps its identity and the file supplies the current deal facts.
- A file that leaves HTO has its row hidden from Operations, totals and export. Returning to HTO reuses the linked row. Permanent file deletion removes the linked row and retains the local audit. These are the D5 and D7 choices to confirm. Existing orders and account actions remain under the release handoff.
- For a closed linked file, the export and date filter prefer an explicitly recorded actual close date. If the file has no recorded actual Closing date, use its checklist Closing date, as the handoff describes for close-out. An HTO date correction changes the checklist date with a C03 preview. The Operations page labels both dates when an actual date is available. Confirm whether Ireland wants an explicit actual date captured at close-out or a separate correction workflow for that evidence.
- The HTO contact editor shows the canonical full name and property display address when split fields have not been confirmed. Open Edit on the linked row, enter the street/city/state/ZIP and each client's first and last name, and save the canonical facts before exporting the confirmed components. Legacy and initial creation records can have free text only. The CSV uses blank component fields in that case, and when saved components no longer match the canonical display value. It retains canonical email and phone. Confirm this treatment of unstructured records with Ireland.

The CSV includes exactly First Name, Last Name, Email, Phone, Street, City, State, ZIP, Close Date, Sale Price, Side and Agent. Client addresses use the tracked property. There is no agent contact information in the CSV. Formula-like text is escaped, and plain international telephone numbers retain their leading plus. The download filename uses the selected agent's first name when an agent filter is active. Follow Up Boss import is an Ireland account acceptance task.

## Local verification

Typecheck and the Next Webpack production build passed. The isolated PostgreSQL run applied all 19 migrations and passed 52 HTO and checklist tests. This covered concurrent exact linking, unit collisions, ambiguous and dismissed matches, manual status isolation, close-date preview and stale digest, dormant reactivation and deletion, current-filter totals, CSV quoting and selection, and coordinator-only HTTP. The linked facts HTTP test supplies a transaction-scoped synthetic C05 writer. R11 and the C15 combined run verify real C05, C03, C08 and C00 composition.

Chromium used the production web build and synthetic API responses. It exercised agent filtering, selected-row CSV download and filename, linked price editing, both dates visible for a closed file, the checklist preview and Only this date choice, near-match dismissal, and manual add at 390 pixels with no page-level overflow. Screenshots are in the local C11 evidence folder.
