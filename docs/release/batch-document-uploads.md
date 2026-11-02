# Batch document uploads

Implemented locally with separate build and independent checking agents. Uploads remain separate authorized requests through the existing PostgreSQL document/version records and private object store; no provider, DNS or deployment changes are part of this work.

## Coverage

| Surface | Behavior |
| --- | --- |
| Coordinator transaction Documents tab | Select/drop multiple new PDF/DOCX documents with one chosen sharing scope. |
| Agent transaction portal | The same batch queue, with agent visibility enforced by the server. |
| Client transaction portal | Existing read-only access remains enforced in UI and API. |
| Intake executed contracts and amendments | Upload multiple files and persist each successful ID immediately to the draft. |
| Intake brokerage checklist | Multiple checklist/supporting files; old single-checklist drafts remain compatible. All files associate with the authorized transaction on submission. |
| Signed service agreement evidence | Upload multiple private documents, explicitly choose one primary signed agreement, and attach remaining files as supporting evidence for the same agent/version. |
| Revised document versions | Explicitly accepts one same-format file per version. A multi-file drop is rejected without creating any version. |
| Mobile/alternate renderings | Use the same components; no other live upload inputs were found. |

Each queued file has validation, removal, individual status and retry. At most two upload requests run at once. New-document/agreement queues hold 20 files, intake queues hold 30, and retained selections are capped at 100 MB per queue, with the existing 20 MB per-file ceiling. Invalid files do not prevent valid peers from saving. Successful uploads and association receipts remain available on retries; upload and agreement request keys prevent duplicates after lost responses. Filenames, immutable originals, checksums, uploader attribution, audits, sharing and server authorization remain intact.

Authenticated transaction upload controllers remain mounted above transient matter-read error views. Only local selections and upload receipt IDs are retained there; protected matter/document lists still clear on failed authorization/read responses. Public bearer checklist concealment remains unchanged. The native-picker background opt-in is limited to authenticated detail views and cannot apply to bearer links.

Two additive migrations introduce upload replay metadata, original filenames per version, agreement supporting-document IDs and agreement replay receipts. Apply both upload migrations with the ordinary release migration process before deploying this code. They have been applied only to synthetic local preview/test databases during this task.

## Verification and limits

- Independent source/API/storage/controller/lifecycle review: **31 checks pass**. Intake build verification: **7 checks pass**. See [independent review](../reviews/implementation/batch-upload-review.md).
- Final combined checkout: **214 tests across 31 files pass** in a fresh disposable local database; all 13 currently present migrations, TypeScript and the production Next build pass. That combined checkout also includes concurrent checklist/account-history work and uncommitted Calendly work; only upload-owned changes are staged for this checkpoint.
- Actual coordinator agreement browser check: selected/uploaded two files, verified per-file permission errors and retained retry selections, retried with coordinator authorization, chose the primary, recorded supporting evidence, and observed the refreshed download links and persistence after reload.
- Actual portal rendering at 390 x 844: measured document scroll width 390 (no horizontal overflow), inspected the shared upload controls and accessible names. Portal file-selection automation repeatedly stalled and ultimately failed after preview connection loss; a successful portal upload submission, native drag/drop and complete mobile picker traversal are **not browser-certified**. Source/controller and real API/storage tests cover their underlying behavior, but do not replace that remaining browser acceptance.
- Upload bytes can save even if text extraction needs attention. Existing scanned-document/OCR restrictions remain; no external OCR or client AI was enabled. Native page reloads cannot retain local File objects; already saved documents remain durable and available through authorized APIs/MCP.

The normal local preview was restored at `http://127.0.0.1:3000`. This checkpoint does not deploy the upload changes or certify hosted behavior. Ireland's provider-account/privacy launch gates remain in place; no email was sent, no charge occurred, and Carson's Stripe was not connected.
