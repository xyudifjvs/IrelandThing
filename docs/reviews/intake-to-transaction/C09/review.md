# C09 independent review

**Verdict — approved.** Independently rechecked exact commit `1e837c4f80eccd5bbe143863b59513decbc8731b` in the isolated C09 worktree. Both findings below are resolved. All provider responses and webhook fixtures were synthetic.

## Recheck

- Terminating and reopening a file after Stripe accepted Checkout creation and the response was lost left the original order in reconciliation. Requests with the original and a fresh key returned `PAYMENT_CLOSED` without creating a replacement Checkout session. The recovery job reused the exact original payload and idempotency key even after `WEB_ORIGIN` changed. It verified and expired the original session. A fresh key returned a new URL after verified expiration.
- A request with its original payload still saved after the replay window elapsed stayed in reconciliation without calling Stripe. A replacement stayed blocked. The reconciliation command rejected wrong-currency evidence and denied agent access. The billing suite separately verified the legacy hold and release after matching coordinator-supplied expiration evidence.
- An initial response with the wrong order, amount, and environment returned `PAYMENT_MISMATCH`. The order stayed in `creating` with no session ID. The billing suite also checked each mismatch separately.
- The actual webhook route rejected a forged late settlement for the unresolved original session. The correctly signed event attached the original session, recorded the payment with a reconciliation flag, and produced one receipt across two deliveries. A fresh request returned the original paid order with no URL.
- All 60 tests across seven billing suites, TypeScript, and the candidate diff check passed. The independent probe also rechecked the direct HTO gates, close-out without payment creation, and in-flight gift cancellation after deletion.

The recheck harness is in `/private/tmp/weatherly-r09-fix-extra-probe.mts`. Ireland runs live provider verification on her laptop.

## Original review

Reviewed `d3c6869881bab19e02529a9d56ce25be5501c443` and requested changes. All provider responses were synthetic, including the signed webhook fixtures.

## Findings

1. **P2. Keep reopened-file checkout blocked when a prior provider creation has an unknown outcome.** `packages/billing/src/termination.ts:61` records a dispatched order without a saved session ID as `cancelled` with `creationOutcomeUncertain: true`. `packages/billing/src/order-requests.ts:106` excludes every canceled order, while the expiry worker returns `NO_SAVED_CHECKOUT` at `packages/billing/src/termination.ts:289`. I simulated Stripe accepting the original create and losing its response, then terminated and reopened the file with the actual lifecycle commands and billing hook. Replaying the old key correctly returned `PAYMENT_CLOSED`, but a fresh key immediately issued a second URL while the synthetic first session remained open and unreconciled. Keep this unresolved cancellation from authorizing a fresh order until the original provider outcome is resolved. Preserve the distinction between a never-dispatched order and a dispatched order with unknown outcome.
2. **P2. Verify the initial provider session before saving it or releasing its URL.** `packages/billing/src/checkout.ts:147` receives the Checkout result and the persistence path at line 188 stores its ID without matching the payment order, amount, currency, or saved mode. I injected a nominally open Checkout result with an unrelated order ID in its metadata, a live-mode response for the test request, and a one-cent amount for a 42,500-cent order. The function returned a usable-looking Stripe URL and moved the order to `pending`. The existing resume path verifies these fields. Apply equivalent fail-closed validation to the initial create response so the caller cannot distribute an unverified session.

## Passed checks

- TypeScript and the candidate diff check passed. The clean candidate passed all 57 tests across seven billing suites on a fresh disposable PostgreSQL database.
- Independent direct route checks rejected HTO service order creation and agent resume of a previously issued service checkout. Both returned `SERVICE_FEE_EXEMPT` and the billing response carried `private, no-store`.
- The actual raw-body webhook route rejected an invalid synthetic signature. A correctly signed late HTO settlement preserved the original amount, recorded payment with a reconciliation flag, and replayed the same event without an additional receipt.
- An independent close-out using the lifecycle billing hook created zero payment orders. An in-flight gift checkout whose Matter was deleted withheld its URL, retained its order and expiration job, and expired the synthetic Stripe session after deletion.
- Independent Chrome verification on the candidate production build found no checkout request before explicit confirmation, no HTO service checkout control, and no stale link or confirmation after switching the selected file. The accepted request contained the selected Weatherly file ID and `closingPaymentConfirmed: true`. Gift presentation and the requested Compliance description remained available.

The independent HTTP and provider probes are in `/private/tmp/weatherly-r09-probe.mts` and the browser harness is in `/private/tmp/weatherly-r09-browser.mjs`. Production lifecycle composition and Stripe account acceptance remain separate. Ireland runs live provider verification on her laptop.
