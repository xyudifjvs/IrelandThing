# Independent document batch upload review

Reviewed 2026-10-21 by the independent checking agent. Product implementation was owned by separate build agents and the parent. This reviewer changed only the dedicated test files and this evidence file; no provider accounts, email, charges, DNS, deployment, or production data were used.

## Complete entry-point inventory

| Entry point                                              | Implementation                                                  | Treatment                                                                                                                                                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coordinator transaction Documents tab                    | `workspace/transactions/[id]/page.tsx` → shared `DocumentFiles` | Multiple new documents through the shared queue; matter ID and chosen sharing scope sent separately with every file.                                                                                |
| Agent portal transaction document list                   | `portal/transactions/[id]/page.tsx` → shared `DocumentFiles`    | Same multiple-document queue with server-enforced agent visibility; refresh after the batch.                                                                                                        |
| Client portal transaction document list                  | Same shared component with `canUpload=false`                    | Existing read-only permission preserved. Clients cannot create or replace documents through the API.                                                                                                |
| New transaction intake, executed contract                | `portal/_components/Intake.tsx`                                 | Contract/amendment queue; each durable ID appended and saved to the intake draft through serialized draft revisions.                                                                                |
| New transaction intake, brokerage checklist              | Same Intake component                                           | Multiple checklist/supporting IDs plus backward-compatible legacy first-checklist ID. Every distinct ID is assigned atomically at submission.                                                       |
| Coordinator signed agreement evidence                    | `workspace/onboarding/page.tsx` → `SignedAgreementBatch`        | Multiple private uploads, then an explicit primary signed agreement selection. Remaining documents are supporting evidence for the same agreement. Approval still requires signed primary evidence. |
| Existing-document version replacement, coordinator/agent | Shared `DocumentFiles` version form                             | Explicit exactly-one treatment: multiple dropped files are rejected without creating versions. Original bytes and old versions remain immutable; new version format must match.                     |
| Mobile and alternate portal rendering                    | Same responsive components                                      | No separate hidden file input or alternate upload route found.                                                                                                                                      |

The initial repository-wide scan found exactly five file inputs: new document, one replacement version, intake contract, intake checklist, and onboarding agreement. No preexisting custom drag-and-drop handler existed; new queue/drop handlers cover the same entry points. Dotloop imports and inbound email attachments are existing provider ingestion paths rather than user file pickers; they continue to call the existing durable document service.

## Source checks

- Each file is a separate authorized multipart request. Keeping the server at one file per request avoids buffering an unbounded multipart batch; UI workers cap active uploads at two.
- Client queue limits are 20 MB per file and 100 MB per batch, with bounded queue counts. Server independently validates byte size, extension/signature and DOCX archive limits. Extra files and oversized requests now return actionable 422/413 responses.
- A stable UUID receipt is scoped to authenticated uploader and content/destination context. Concurrent duplicate create requests produce one PostgreSQL version, one audit event and one stored object. Changed file/destination reuse produces a conflict.
- Agreement recording has its own durable request receipt, so response-loss retry does not create duplicate agreements or approval audit records. Changed approval/files with the same receipt are rejected.
- File bytes remain in the existing object store. PostgreSQL retains document/matter association, uploader, immutable checksum/version, original selected filename, status and provenance. Document API/MCP projections exclude storage keys and upload receipt hashes.
- Agent upload permissions, cross-matter isolation, client read-only behavior, coordinator sharing approval, client-shared version review and revoked access are preserved.
- Intake uses synchronous payload refs and a serialized save chain, so concurrent completions cannot overwrite each other's IDs. An association-save failure retains the uploaded result for save-only retry. Submission requires the submitting agent to own every document and prevents reuse of a file already assigned to another matter.
- Authenticated transaction parents hold the local queue above their live-read loading/error return. A transient read failure still removes protected server content, while local selected files, receipts and completed IDs survive for retry. Both parent bodies are keyed by matter ID. Account/context changes immediately mask old queue metadata, stop queued requests and clear idle state before the new context is enabled.
- Queue controls have accessible labels, per-file status announcements, individual retry/remove names, a clear error for each rejected file and visible keyboard focus. Responsive CSS wraps long filenames and places mobile actions below file details. Actual browser verification is recorded below when completed.

## Independent automated evidence

Command: `npx vitest run packages/documents/test/batch.test.ts tests/document-upload-workers.test.ts tests/document-upload-queue.test.ts tests/live-data-upload-retention.test.ts tests/transaction-document-uploads.test.ts`

Latest complete run: **31 passed, 0 failed**, including the normal 255-character filename boundary assertion, after deploying the additive migrations to the disposable local `weatherly_root_test` database. Vitest's safety guard rejects any nonlocal database or a database whose name does not end in `_test`. Tests create synthetic UUID records, use a unique temporary local object directory and clean up only their own data.

Eight real PostgreSQL/HTTP/storage tests cover:

1. Multiple independent file requests with a mixed invalid signature and injected transient storage failure; successful peers remain saved, and only failed work is retried.
2. Original UTF-8 filename preservation and exact download bytes through a newly constructed router/object-store instance.
3. Concurrent lost-response replay with one document/version/audit; altered bytes, filename, category or destination conflict; uploader-scoped receipt use.
4. Anonymous/client/unrelated-agent denial, sharing forgery denial, explicit coordinator sharing and revoked client access.
5. Empty, legacy, spoofed, oversized and extra-file validation with actionable errors and no unwanted records.
6. Immutable original and replacement bytes, exact selected filename for each version, repeat version receipts and safe rejection of multiple replacements.
7. Explicit signed primary plus durable supporting agreement files; unsafe/missing primary rejection; concurrent agreement replay without duplicate audit; changed approval/files conflict; authorized administrative/MCP discovery.
8. No orphaned extra storage object from replaying a saved upload.

Three helper tests cover the two-worker concurrency ceiling, completion of peers despite an individual failure, failed-only retry, format/size boundaries and an empty queue.

Four actual queue-controller tests exercise mixed completion, invalid-peer exclusion, receipt-preserving failed-only retry, save-only retry after association failure, refresh failure without lost results, duplicate detection, removal, bounded iteration/retained bytes and the same-tick double-start guard.

Twelve live-read lifecycle tests exercise the picker integration fix: opted-in online authenticated detail data remains available through temporary visibility/pagehide events, polling pauses and return events restore reads; HTTP 401/403/404/410/500 and offline still clear the data. Default/public-bearer background and pagehide concealment remains intact, including suppression of late responses.

Four hoisted transaction-controller tests check transient read failure/resume with the same local receipts, immediate old-account metadata masking plus queued-request blocking/idle clearing, correct matter/sharing/file/receipt payload with only the returned ID retained, and mounted-list refresh callback registration/cleanup. The controller/lifecycle tests compile the actual hook source into controlled React-hook adapters and real event targets (the transaction wrapper uses a controlled queue stub; actual queue behavior is tested separately). They do not claim to replace actual browser/React rendering checks.

The intake build agent also owns separate real-database tests under `packages/intake/test/`; their results should be reported separately from this checker's tests.

## Findings corrected during review

- Multer size/count errors previously became generic HTTP 500 responses. Corrected and tested.
- Multipart Unicode names needed explicit UTF-8 filename decoding. Corrected and tested.
- Lost agreement-record responses could duplicate the agreement even though file receipts were stable. Added durable agreement replay protection and tested concurrent replay.
- Replacement-version filenames previously inherited only the root document name. Added per-version original filenames and tested original/revised download disposition.
- A 255-character PDF basename previously lost its extension due to 250-character truncation. Full sanitized basenames now persist; the focused boundary assertion and full independent suite pass.
- A concurrent live-checklist hook cleared the authenticated parent transaction when the native chooser backgrounded the tab, unmounting its file input. Added a narrow authenticated-detail retention opt-in; independent tests preserve public bearer concealment and fail-closed behavior on access/network failure. Browser validation is recorded below.
- A transient authenticated matter-read error could unmount the local queue and lose retry receipts. Hoisted the queue controller above the detail error boundary without retaining protected server lists; independently reviewed and tested account/context changes and resumption.

## Browser and final integration status

The parent reports a successful actual native-chooser selection/upload of two private agreement files, explicit primary/supporting recording, durable association and list refresh on the coordinator agreement form. This checking agent attempted a separate portal browser tab, but its CUA surface returned `Browser is not available: iab`, and the live inventory contained `browsers: []`. No sign-in state was changed and no picker was attempted by this agent. Actual portal/mobile browser verification must therefore be recorded from the parent or another available authorized browser surface; static/controller checks alone do not establish it.

The latest full-source `npm run typecheck` passes. An earlier missing-export integration failure from concurrent checklist work has been resolved.

No hosted rollout, migration of a production database, commit or push was performed by this checking agent. Final synchronization and hosted status belong to the parent report.


Parent integration evidence (2026-10-22): final combined-checkout isolated suite passed 214 tests across 31 files, TypeScript and production Next build. Actual agreement browser flow selected/uploaded two files, displayed per-file permission denial under the agent session, preserved the selections for an authorized retry, required explicit primary selection, recorded one supporting file and refreshed both download links; persisted record remained after reload. Portal rendering measured width/scrollWidth 390 at 390 x 844. Portal picker automation repeatedly stalled and finally failed after local preview connection loss; successful portal upload submission, native drag/drop and complete mobile picker traversal remain unverified in-browser. The parent restored the normal API/web preview. See `docs/release/batch-document-uploads.md` for the checkpoint scope and limits.
