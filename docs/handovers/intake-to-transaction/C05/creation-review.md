# Creation review domain

The intake package now has separate modules for validation, draft/submission persistence, receipt queries, legacy intake opening and HTTP. The existing intake router and package exports remain available.

Mount `createCreationReviewRouter({ seedChecklist, seedPeople, afterConfirm })` under the existing coordinator session, origin and rate checks at `/api/v1/creation-reviews`. The router applies private no-store responses. The start, save and extraction request schemas are in `packages/intake/src/creation-review/inputs.ts`. Confirmation uses the shared `CreationConfirm` schema.

| Request | Body |
| --- | --- |
| POST / | `{ requestId, intakeId? }` with a UUID request ID. |
| GET /:id | Returns stored edits, a read-only intake snapshot, pinned sources, document metadata, review revision and extraction status. |
| GET /matter/:matterId/intake | Returns the immutable intake snapshot and original attachments for the coordinator's file Intake panel. Returns null for manual files. |
| PATCH /:id | `{ expectedRevision, facts?, people?, dates?, business?, sources? }`. A supplied facts object patches individual fields. A supplied array replaces that array. |
| POST /:id/extraction | `{ expectedRevision, action: "start" | "skip" }`. |
| POST /:id/confirm | Shared `CreationConfirm`. Returns `{ matterId }`. |

- A manual start persists only the review and its audit event. A legacy start retains the pending Matter ID and leaves the receipt and intake snapshot alone. An intake with a pinned original contract queues extraction when its first review opens. A new start for the same open intake resumes its existing review for the owner. The first request key remains the retry identity.
- A source change, extraction start or Skip advances both the review revision and extraction generation. Confirmation checks the revision and revalidates the pinned source documents and exact versions under lock. A newer version of the same document can be selected explicitly without replacing the original.
- The extraction job is `creation.extract` with `{ reviewId, generation }` and prompt version `creation-signed-terms-v1`. A queued or running generation reads as unavailable after 60 seconds even with the worker down. Results remain separate from editable fields.
- Confirmation atomically creates or opens the file, seeds checklist and private contacts, associates staged documents, marks the intake processed, records the idempotency receipt and runs the supplied hook. The old service snapshot survives a legacy confirmation using the same package. A new Weatherly package captures its approved catalog terms. HTO uses `hto_included`. A pending file with an existing service order requires resolution before a business or package change.
- Direct legacy intake opening and file confirmation reject active creation reviews. The matter extraction approval adapter rejects an active creation review or a canonical checklist. C04/C00 must guard legacy AI proposal jobs and the standalone conflict resolver before exposing both route families.
- D2 uses signed contract dates for Remedies and Title Commitment when they differ from defaults. D4 keeps downstream dates fixed after Only this date. C04 and C03 own their respective behavior, and both decisions remain on the Ireland confirmation list in C00.

## Wiring

- The coordinator selects an active saved entry from C08's `GET /api/v1/onboarding/roster`. A name-only entry supplies `agentRosterId` with a null login. Existing unlinked agent accounts can be selected separately.
- Editable People can retain incomplete names and contact details in a saved review. Confirmation requires a valid name for every retained row. An extracted name can fill an unnamed intake row only when one same-side row and one contract name remain and every named intake client already matches.
- New receipts freeze the submitter's name, email, brokerage and roster phone in the intake snapshot. Both submitted-details views use those captured values. Older receipts can display a separately labeled current profile without treating it as a submitted answer.
- Confirmation uses the selected file business independently of roster affiliation. The selected roster entry must still be active and consistent with the assigned login.
- Agent receipt documents use explicit intake ownership or the original upload IDs in the immutable snapshot, with the effective agent audience. Version metadata is limited to versions present at submission. The coordinator keeps the existing file document view. After C06 integrates, replace the equivalent agent audience predicate in `queries.ts` with `documentAudienceWhere("agent")`.
- C00 supplies C03's `seedMatterChecklist`, a C06 transaction-scoped initial people writer and the transactional after-confirm hook. The hook is where C00 composes C11 HTO synchronization and other confirmed-file internal effects. Tests supply deterministic transaction callbacks that write real database rows.
- C06 owns staged upload/view and document audience handling. A staged upload must serialize with confirmation by locking its open review before association. Confirmation leaves document visibility and sharing fields intact.
- C00 can enqueue the gift-only effect after intake confirmation. The existing `intake.submitted` job also invokes legacy extraction and is unsuitable for the canonical path.
- C00 opens `/workspace/new` from the manual link and `/workspace/new?intakeId=…` from each intake. Both replace the URL with a durable review ID after the authorized start. The browser stores request IDs in session storage and uses explicit Save review for durable field edits.
- C06 stages a new document through multipart `POST /api/v1/documents` with `creationReviewId`, `category=contract` and `uploadRequestId`. Review saves pin the returned version. Existing originals remain available through `GET /api/v1/documents/:id/view?versionId=…`.
- C14 mounts the exported `TransactionIntake` component on the coordinator file Intake tab. Legacy direct setup links remain available for historical files.

## Intake Matter ID migration

The current writer always creates a pending Matter and `IntakeSubmission.matterId` remains required. A separate schema and coordinated writer change is needed to receive new intakes without a Matter.

- C05 `packages/intake/src/submission.ts` creates the placeholder Matter, assigns uploads and populates both receipt and draft Matter pointers. Both idempotent replay branches dereference the Matter. `queries.ts` also requires the Matter and currently discovers intake documents through it. `legacy-creation.ts` uses the Matter for locking, contact hydration and its worker payload. `creation-review/storage.ts` currently requires that legacy pending Matter before opening or confirming. `creation-review/sources.ts` uses the legacy fallback to discover existing attachments.
- C06 `packages/matters/src/projections/matters.ts` builds a Matter `notIn` filter from unprocessed intake IDs. It needs a non-null filter and narrowing before the schema changes.
- C04 `packages/ai/src/intake-review.ts` and C09 `packages/billing/src/service.ts#recordIntakeGift` validate a Matter-bound intake. C00's old `intake.submitted` worker handler in `apps/worker/src/main.ts` requires a concrete Matter ID and should only handle confirmed or legacy bound records.
- C05/C13 receipt types in the workspace intake page, intake inbox and portal landing page should accept a null Matter pointer and link to the intake when the pointer is absent. Existing direct Matter links remain valid for historical rows.
