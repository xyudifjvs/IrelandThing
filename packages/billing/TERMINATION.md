# Service fees and checkout cancellation

Weatherly service fees are due at closing. A new canonical service request requires Ireland's explicit `closingPaymentConfirmed: true` in `POST /api/v1/billing/checkout`. The confirmation can be recorded on a published Under contract, Closing, or Closed file and does not change its stage. Legacy files and old clients still use the existing Closing or Closed gate when the new confirmation is absent. Checking a task, closing out a file, or reopening it does not issue a request. Existing catalog snapshots remain authoritative for historical service amounts.

Home Team Ohio file business disables service fees before checkout creation or resumption, regardless of the assigned agent's membership. Gift quoting and payment remain independent. Agent payment views exclude service rows on HTO files. The coordinator's payment history retains settled and canceled rows, including after file deletion. Existing HTO service settlements are recorded from verified evidence and marked for reconciliation.

## Lifecycle composition

- After applying a file lifecycle transition, C00 calls `queueTerminatedServiceCheckouts(tx, actor, matterId)` inside the existing transition transaction. The helper also remains compatible with the legacy matter-change hook. It stages unpaid service expiration for a terminated canonical file, a recorded pre-closing termination on a legacy file, or an HTO file with a retained service checkout.
- Before deleting a file, C00 calls `queueDeletedFileCheckouts(tx, actor, matterId)` inside the deletion transaction. It stages expiration of unpaid service and gift checkouts while retaining the payment history. The same hook can be used for a legacy pending Matter removed during intake deletion. The old intake gift job checks the current Matter and the receipt's deletion marker under locks.
- Both hooks are database-only. The existing `billing.expire_checkout` worker calls `expireTerminatedServiceCheckout`. Its stored order cancellation remains effective when the file is reopened or deleted. A terminated file's gift requests remain separate unless the file is deleted.
- The C05 confirmation path rejects a package or business change when a legacy pending file already has a service order that needs resolution. D5 governs later business switches. Paid, refunded, and disputed orders retain their original amounts and snapshots. Refunds and credits remain coordinator decisions.

Each saved session receives one durable expiration job. With no session ID, the unpaid order is canceled locally. When session creation had started, the order retains evidence that the outcome may be uncertain. A late provider response or a correlated webhook records its session and queues expiration while withholding the URL. A fresh explicit closing request after reopening can proceed once cancellation is resolved. Replaying the old request key keeps that old order closed.

The worker verifies the session ID, order metadata, amount, currency, and test/live mode. It expires an open, unpaid session and verifies the outcome. A provider error is followed by a fresh read. A completed session or verified settlement is kept for coordinator reconciliation, including when the file no longer exists. An already distributed provider URL stops working after Stripe confirms expiration.

## Verification

Local tests use synthetic Postgres and injected provider doubles for creation, resume, expiry, and settlement races. Live account verification and a test checkout and webhook run belong in Ireland's Stripe context on her laptop.
