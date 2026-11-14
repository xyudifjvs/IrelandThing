# File lifecycle and intake deletion

C00 can call `registerFileLifecycleRoutes` from `packages/matters/src/routes/lifecycle.ts` on the existing protected Matters router. C11 can receive the `changeFileLifecycle` command through injection. Both use the required `onTransition` effect. It runs after the stage is written inside the Matter transaction.

| Matter request | Body and result |
| --- | --- |
| GET /:id/close-out | Returns `expectedRevision` and unchecked item IDs and titles for the warning. |
| POST /:id/close-out | Accepts `{ expectedRevision }`. Returns the closed stage, revision and unchecked items. |
| POST /:id/terminate | Accepts `{ expectedRevision, reason? }`. Returns the terminated stage and revision. |
| POST /:id/reopen | Accepts `{ expectedRevision }`. Returns the under-contract stage and revision. |
| DELETE /:id | Accepts `{ expectedRevision, confirmation: "DELETE" }`. Available when C00 supplies the D7 deletion effects. |

All actions require a coordinator. Close-out keeps unchecked tasks open and records the time and actor. Termination records the optional reason and pre-closing evidence for billing. Reopen works from Closed or Terminated and preserves both prior events and the checklist. The generic PATCH retains its legacy transitions for historical files. Versioned files use the explicit commands to enter and leave terminal stages. Tasks do not change lifecycle.

The delete command locks creation reviews before the Matter and verifies the expected revision. The configured effect sees the live file and associated records in the same transaction. Deletion cascades to the checklist, documents, notes and public link. It also removes stored creation proposals and review working fields, preserves the confirmation receipt and audit, and marks any source intake consumed and deleted. File deletion requires a published file. A repeated canonical confirmation returns a deleted-file error after the Matter has been removed.

## Separate intake deletion

C00 can pass `beforeIntakeDelete` to `createIntakeRouter` to register `DELETE /api/v1/intakes/submissions/:id` with body `{ confirm: true }`. The command accepts an unprocessed intake and locks its pending Matter and any review. It preserves the original receipt with a deletion disposition, discards the working review and removes the unpublished Matter and staged documents. It does not consume the intake. Deleted receipts disappear from normal receipt queries and submit retries return a deleted response.

## Transaction effects and activation

- C07 cancels queued sends, draft work and reminders on close-out or termination, removes local file email history at deletion, and rechecks lifecycle in leased jobs. Reopen keeps previously invalidated work inactive. D7 governs remote email retention.
- C09 stages cancellation of payable checkouts and retains payment records. Checkout expiration and settlement handling need to work even if the file has been reopened or deleted. C00 and C09 must also make the old gift handler honor the intake deletion marker and prevent payment creation after deletion.
- C11 synchronizes HTO status through `onTransition`. The delete effect must resolve the HTO row's restrictive foreign key in line with D7 before the Matter can be removed.
- C06 queues durable object cleanup for every file document version before cascade deletion. For an unprocessed intake, include both legacy Matter documents and staged intake or review documents. The worker confirms ownership and retries cleanup without a live Matter. C06 and C13 enforce read-only closed and terminated portal access and remove link access at deletion.
- C04 and C00 invalidate any remaining legacy AI jobs and remove legacy proposal content during deletion. The canonical creation worker sees the deleted state or stale generation before persisting a proposal.
- These hooks operate on database state and outbox rows. They do not call providers inside lifecycle transactions. C00 can mount transitions independently of deletion. The deletion routes depend on the agreed D7 behavior and their real effects.

Synthetic tests cover simultaneous lifecycle changes, unchecked-item warnings, stale revision, role enforcement, hook rollback, local file deletion, retained confirmation receipts and independent intake deletion. They exercise deterministic transaction effects. Provider work and the full composed deletion sequence are pending integration.
