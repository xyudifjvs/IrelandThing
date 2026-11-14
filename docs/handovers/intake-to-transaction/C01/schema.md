# C01 persistence handoff

The foundation migration is `20261111233000_intake_transaction_foundation`. It adds nullable columns to existing tables and creates ten tables for new records. It leaves existing rows, document versions, account credentials, checkout records, and signed agreement evidence in place. Existing facts remain classified and visible according to the legacy services until a reviewed feature activates the new model.

## Storage contracts for feature teams

| Owner | Fields and records | Boundary |
| --- | --- | --- |
| C03, C05 | `Matter.business`, `checklistVersion`, `acceptanceDate`, `acceptanceAt`, `deadlineTimeZone`, `purchasePriceCents`, `agentRosterId` | `Business` has `hto` and `weatherly`. A null value retains legacy behavior and is not an HTO classification. Use `checklistVersion = 1` for canonical task dates. Treat `agentRosterId` as a roster assignment and `agentId` as the existing authenticated assignment. Preserve package and payment snapshots separately. |
| C03 | `Task.stepKey`, `dateCapable`, `dateRule`, existing `dueDate`, `dueAt`, `actualDate`, `actualAt` | Stable nonnull keys are unique within a matter. Civil dates use YYYY-MM-DD. An instant requires its paired civil date. Use the shared rule schema and task metadata for notes, appointment details and the note audience. Use existing `Task.status` and audit history for completion, Not needed and extensions. |
| C04, C05 | `IntakeSubmission.business/deletedAt/deletedById`, `CreationReview`, `CreationExtraction` | `CreationReview` has `ownerId`, `state` (defaults to `open`), `revision`, `extractionGeneration` (starts at zero), `payload` and `sourceRefs`. `startRequestId` is unique. A nonnull `intakeId` is unique. Set `confirmedMatterId`, `confirmedAt`, `confirmationRequestId` and `confirmationFingerprint` together in the confirmation update. The confirmation request and linked file are individually unique. Deleting the linked file clears that link and retains the request receipt. C05 still owns the D7 disposition and content cleanup. |
| C04 | `CreationExtraction.reviewId/generation/sourceRefs/promptVersion/status/result/model/provider/errorCode/startedAt/finishedAt` | The review and generation identify one extraction record. Generation starts at one for actual extraction. `sourceRefs` pins document/version pairs. The worker checks the owning review and its current generation when taking and completing work. `AIProposal` remains the legacy record type. |
| C05, C06 | `Document.intakeSubmissionId`, `creationReviewId`, `shareWithAgent`, `shareWithClient` | Use the explicit owner relation when a file does not yet exist. Retain original attachments when a review selects a replacement version. The audience flags must both be set or both null. Null pairs use the existing visibility mapping. For new client-only access, use coordinator visibility for old readers. The flags do not change document version and upload replay identities. |
| C06 | `MatterContact` | Stable per-file `id`, `matterId`, `role`, `name`, `email`, `phone`, `company`, `shareWithAgent`, `shareWithClient`, `retiredAt`, `revision` and optional `directoryContactId`. Both audience flags default false. The directory link supplies provenance. Retire contacts while keeping email delivery history tied to its saved recipients. |
| C06 | `ChecklistShareSecret.matterId/shareId/ciphertext` | There is at most one secret per file. `shareId` is an immutable generation marker, separate from the current hash row. Rotation and revocation update or remove the secret in the transaction that changes the share. An old binary can rotate or revoke a link without retargeting the secret. A copy attempt rechecks the current share ID, expiry, revocation, access and decrypted token hash. Use the existing server encryption helper. Keep ciphertext off assistant and ordinary metadata selections. Existing hash-only links need explicit replacement for copy access. |
| C08 | `RosterAgent` and optional roster links | `name`, optional `email` and `normalizedEmail` pair, `phone`, `brokerage`, `userId`, `business`, `agreementSentOn`, `archivedAt`, and `revision`. Nonnull normalized email and User ID are individually unique. Name-only HTO roster rows may omit both email fields. The optional `rosterAgentId` on `Invitation`, `Inquiry`, `Agreement` and `SchedulingBooking` retains source relationships. `Agreement.signedOn` records the civil date. Keep the existing approval evidence and account-binding flow. |
| C07 | `CommunicationTemplate.linkedStepKey/recipientGroup/recipientRoles/position/isPlaceholder`, `EmailWork`, `EmailDraft.workItemId` | `EmailWork` is unique per file and nonnull template. It records `templateRevision`, `linkedStepKey`, `laterAt`, `remindOn`, `manualCompletedAt`, `manualCompletedById` and `revision`. Actual delivery remains in the related draft and message history. Retire referenced templates using the existing active flag. The FK protects work history from an accidental hard delete. |
| C10 | `PrivateTodo`, `PrivateScratchpad` | A to-do has `ownerId`, optional `matterId`, `body`, `completedAt`, `revision` and timestamps. The scratchpad has one row per `ownerId` with its own `body`, `revision` and `updatedAt`. Legacy private notes remain in `Note`. |
| C11 | `HtoClosing` | A nonnull `matterId` is unique. Unlinked rows own `manualAgentRosterId`, `manualPropertyAddress`, `manualAddress`, `manualClients`, `manualSide`, `manualStatus`, `manualCloseDate`, `manualListedDate` and `manualPriceCents`. Keep `matchKey` nonunique. Read linked facts through the canonical file and checklist. Resolve linkage in the lifecycle command before deleting a linked file. The restrictive FK prevents an accidental reappearance of stale manual data. |
| C12 | `DigestCursor` | One row per `recipientId/stream`. Store `highWaterAt`, `pendingWindowStart`, `pendingWindowEnd`, `pendingJobKey` and `revision`. The pending values are set and cleared together. The pending job key is unique. Keep existing Outbox delivery evidence. D8 defines the first window and cutoff. |

`purchasePriceCents` and `manualPriceCents` use `Decimal(16, 0)` and accept integers from zero through 9,007,199,254,740,991. Convert to the shared API's number shape after range validation. Existing service prices use their original storage.

## Migration order and recovery

Deploy the foundation before any application version writes its new records. It deliberately keeps `IntakeSubmission.matterId` required. C05 will request a separate additive migration when replay, intake detail, waiting-intake filters, document ownership, gift and extraction jobs, and existing response types handle an unlinked receipt. A pre-guard application cannot safely read the null-linked receipts created after that later rollout.

Leave the additive database structure in place if rolling back application code at this initial foundation checkpoint. Once new flows write records, choose a rollback application that understands the stored generations, audience flags and intake linkage. Treat confirmed documents, payments and outgoing job receipts as retained operational records. Lifecycle cleanup needs C05's explicit domain commands. The migration performs no backfill, reclassification, document movement, object deletion or account reset.

## Validation

Ran in an isolated local worktree and dependency directory. Prisma client, generated types and workspace links resolved inside that worktree. All database commands used disposable local synthetic databases.

- Fresh database applied all 19 migrations. Prisma found no schema difference.
- Populated database applied the original 18 migrations, loaded the synthetic legacy fixture, then applied the foundation. Compared every original column in every legacy table. All 40 original rows across 42 tables matched. Existing business, checklist, and document-audience fields retained their null legacy markers. Reapplying found zero pending migrations. Prisma found no schema difference.
- Constraint probes covered simultaneous creation start replays, duplicate intake and extraction links, confirmation receipt completeness, stable task keys, paired document flags, exact safe-number cents, HTO linkage and delete restriction, duplicate email work, digest window completeness, and an old share rotation that cannot retarget ciphertext.
- Prisma schema validation, isolated client generation, TypeScript, and all 328 existing tests across 49 files passed.

For a populated rehearsal, apply the prior migrations to a new local database named `weatherly_c01_*_test`, then run `legacy-fixture.sql` with psql and stop-on-error enabled. Set `DATABASE_URL` to the same disposable database for these commands. Use a local temporary snapshot path.

```sh
node docs/handovers/intake-to-transaction/C01/verify-upgrade.mjs capture .local/c01-before.json
npm run db:deploy
node docs/handovers/intake-to-transaction/C01/verify-upgrade.mjs verify .local/c01-before.json
node docs/handovers/intake-to-transaction/C01/verify-constraints.mjs
npm run db:deploy
```

The constraint script rolls back its fixture changes and removes its own committed concurrency probe. Dispose of the rehearsal databases and snapshot once the review is complete.
