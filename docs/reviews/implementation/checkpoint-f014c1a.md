# Independent targeted review:f014c1a

Reviewed exact product commit `f014c1a` on2026-10-20 America/New_York. Only synthetic local PostgreSQL records and injected Stripe/model implementations were used. No real Stripe account, payment, refund, mailbox, Dotloop account, AI route or Railway service was accessed.

## Resolved billing findings

All three findings fromb8c33dd are resolved in the tested scenarios. The original expanded billing batch passes30/30:

- Refund intent is committed before provider dispatch. An acknowledged full refund blocks fulfillment; the controlled paused provider response produces an immediate REFUND_HOLD. This immediate rejection is valid serialization through durable reservation and does not need to wait for the provider.
- A provider-accepted response-loss exception leaves a durable fulfillment hold. Same-key identical requests make one provider call; changed amount conflicts with IDEMPOTENCY_CONFLICT. Unresolved acknowledged requests reduce available refund balance.
- Verified failed-refund evidence releases the matching hold, allowing original paid fulfillment; missing provider evidence retains the hold.
- Unpaid gift cancellation expires the previously issued provider checkout, and subsequent checkout reuse fails GIFT_CLOSED.
- Original authorization, quote/revision/transition/concurrency, amount/metadata and monotonic reconciliation assertions continue to pass.

## Remaining P2: external and local refunds can be mistaken for overlapping amounts

The extended batch adds one failing assertion, for a final30/31 result. Reproduction on a6500-cent payment:

1. An earlier distinct dashboard refund records refundedCents1000 and partially_refunded state.
2. A new local1000-cent refund succeeds, but its updated charge total has not arrived yet.
3. A further5000-cent request passes local validation.

The code computes `Math.max(settled,succeeded)+pending`, assuming local successes overlap the provider-confirmed aggregate. Here they are distinct, so actual remaining funds are4500, but the local gate allows5000. Stripe's own aggregate refund limit remains a separate safeguard; the test deliberately uses a permissive fake to challenge the application boundary. This is not evidence that Stripe permits an over-refund.

Conservatively reserve uncorrelated local successes in addition to the confirmed aggregate, or correlate exact refund evidence during reconciliation before treating them as accounted for. Reported to parent with the exact fixture.

## Source-bound email AI

Independent injected-generator checks pass18/18. They establish:

- Unverified account privacy, noncoordinator actor and mismatched source matter fail before generation.
- Valid classifications and text suggestions persist as pending human review with exact source revision/hash. The prompt labels source email as untrusted and forbids operational instructions; this is inspected request construction, not a claim that a live model always obeys it.
- Invented source quotes and recipient fields in generated output are rejected. Email proposals cannot use the contract-review apply path.
- A source body change without a revision increment is caught by its fingerprint during generation and persists a stale attempt. Old detail refuses changed source; list displays stale status. Reassociation during generation prevents acceptance under the original matter.
- Suggestions and untrusted email do not complete the synthetic task, create outgoing drafts or enqueue sends.

An initial harness assertion expected a different error-code spelling for the contract/email kind guard; the actual denial was correct. The harness was corrected to REVIEW_KIND_MISMATCH and the complete18-check run repeated successfully.

Typecheck passes at the exact reviewed checkpoint. No browser/visual acceptance is claimed here; the parent is exercising the integrated preview separately.

## Reproduction portability

The retained probes now resolve product imports relative to the checkout. They explicitly require a local disposable database via CHECKER_DATABASE_URL or DATABASE_URL and reject production/nonlocal databases. The billing/email probes were rerun from their retained repository locations after that portability change, preserving the results above. The portable recovery probe also passes12/12, and the portable fail-closed AI routing/plugin probe passes4/4 at this checkpoint. Historical exact-commit results remain in their original reports. See `probes/README.md` for requirements and safe execution boundaries.
