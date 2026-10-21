# Independent billing review:b8c33dd

Exact product commit: `b8c33dd`. Reviewed2026-10-20 America/New_York in the isolated reviewer checkout/database. No Stripe connection, account read, credentials, charge, refund or other external provider action occurred. Tests inject an in-process provider and use synthetic records. Stripe's documentation connector required reauthentication, so public official documentation was read through the web fallback; no account was accessed.

Status: **corrections required**. The independent billing probe has25 assertions,20 passing and5 failing assertions grouped below. The separate owner-bootstrap probe passes8/8. The kind=matters matterId filter finding from2859d65 is resolved: the requested authorized matter is now returned as a singleton.

## P1: refund requests do not reserve funds or block fulfillment

`refundPayment` stores an audit receipt after the provider returns, leaving PaymentOrder.status paid and no pending refund hold. `fulfillGift` reads that status while locking only GiftOrder; it does not serialize with the payment advisory lock used by refunds/events.

Three independent reproductions fail:

1. A paid6500-cent gift receives an acknowledged full6500-cent refund from the injected provider. Before webhook/reconciliation, fulfillGift immediately accepts ordered.
2. The fake provider accepts a full refund and deliberately withholds its response. A concurrent fulfillGift completes ordered during that controlled pause. It does not block on the payment decision.
3. Acknowledged4000-cent refund requests with two distinct keys against a6500-cent payment both pass local remaining-balance validation before a webhook. The real Stripe API separately disallows aggregate excess; this fake-provider result establishes the missing local reservation, not a claim that Stripe allows an over-refund.

Persist a durable refund intent/hold with key, amount and request fingerprint before external dispatch, preserve ambiguous delivery for reconciliation, account for unresolved reservations when determining available refund balance, and block new gift fulfillment while refund state is unresolved. Serialize payment evidence and fulfillment with a consistent lock order; webhook processing already acquires payment before updating gifts. A hold written only after provider success in the same transaction can disappear if the provider accepted but the response or database commit fails. That ambiguity path remains a required follow-up probe.

[Stripe refund documentation](https://docs.stripe.com/refunds) describes pending and failed refund states and prohibits refunding more than the original charge. The application should model unresolved requests explicitly rather than treating the old paid projection as available funds.

## P1: cancelled gifts still expose an active checkout

Reproduction: quote a saved gift, create checkout, cancel the unpaid gift with its current revision, then call createCheckout for the same gift. The service follows gift.paymentOrderId before checking gift status and returns its active pending provider URL. Existing issued links are also not expired by cancellation.

A cancelled gift must not advertise a payable link. Expire the open provider checkout when cancellation is completed, or retain a visible pending cancellation/error state until expiry is verified; handle any payment/cancellation race explicitly. Merely hiding the newly returned URL leaves an already issued external URL payable.

## P2: refund idempotency does not bind request parameters

Reproduction: refund1000 cents with a key, then submit2000 cents using that same key. The second call returns requested:true with the old audit receipt instead of rejecting the changed request. Same-key concurrent identical requests correctly call the provider once, but changed amount/reason must not masquerade as success for the new request.

Bind the key to a canonical request fingerprint and reject mismatched replay with conflict. [Stripe idempotency documentation](https://docs.stripe.com/api/idempotent_requests) likewise states that a reused key with changed parameters is rejected. Retain original receipt/result for identical replay.

## Passing independent checks

- Agent quote/refund authorization denial; unapproved quote, unpaid fulfillment and stale quote denial.
- Concurrent checkout creates one local order and uses a stable provider idempotency key. Its amount comes from the approved quote.
- Paid state comes from provider evidence; a checkout response alone cannot order a gift.
- Ordered-before-delivered and terminal gift-state rules; concurrent same-revision ordering has exactly one winner.
- Over-balance refund denial; same-key concurrent refund requests make one provider call; provider key binds the payment and request key.
- Reconciliation rejects incorrect metadata and total, accepts retrieved full-refund evidence and preserves full refund against an older partial snapshot.
- Owner bootstrap rejects the placeholder mailbox, short password and missing owner confirmation without creating a user. Two concurrent fresh bootstrap commands produce exactly one coordinator. The catalog contains approved375/475/625-dollar prices; one hashed credential is stored; existing coordinator bootstrap refuses mutation.

Evidence scripts: `probes/weatherly-independent-billing.mts` and `probes/weatherly-independent-bootstrap.mjs`. The fake provider respects checkout and refund idempotency keys but intentionally permits arbitrary refund totals so the application boundary can be tested independently of provider enforcement. This is not live payment certification. The stale-quote harness initially passed a current revision and the cancelled-checkout harness initially retained an unrelated retrieved session; both harness mistakes were corrected before the final25-assertion run and are not product findings.
