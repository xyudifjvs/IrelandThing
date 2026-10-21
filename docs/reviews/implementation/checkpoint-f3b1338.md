# Independent refund-correlation recheck:f3b1338

Exact product commit: `f3b1338467337b33cd0973ed74eb097b88c6b0ef`. Reviewed2026-10-20 America/New_York. Only reviewer-owned evidence changed. All execution used the isolated local synthetic database and an injected fake Stripe provider. No external account, payment, refund or provider call occurred.

**The mixed dashboard/local refund accounting finding is resolved.** The original31 independent billing assertions pass31/31. Six additional correlation boundary assertions pass, for37/37 total. Typecheck also passes at this exact product commit.

The new assertions exercise one6500-cent payment with an earlier distinct1000-cent dashboard refund and a new1000-cent local success:

- A subsequent5000-cent request is rejected before reconciliation.
- A complete refund list whose succeeded total disagrees with the retrieved charge does not mark the local request accounted.
- Incomplete refund pagination does not mark the local request accounted, even when it includes matching local evidence.
- A complete consistent refund list including both distinct refunds, matching the2000-cent charge aggregate, marks the local request accounted.
- A4501-cent request is then rejected; exactly4500 cents is permitted without double counting; another cent after that reservation is rejected.

The earlier negative authorization, approved quote, checkout concurrency/idempotency, gift-state CAS, cancellation/session expiry, response-loss refund hold, immediate concurrent fulfillment denial, failed-refund release, missing-evidence hold and monotonic reconciliation assertions continue to pass in the same37-check run.

## Correlation inspection

The implementation deducts the provider-confirmed aggregate plus each active unaccounted local intent. Matching evidence requires the payment-order metadata, local refund key and exact amount. Successful requests become accounted only when pagination is complete and the succeeded refund total matches the retrieved charge aggregate already covered by the monotonic stored settled total. Requests missing from the list remain unchanged. Explicit failed/canceled evidence can release its own reservation; absence does not.

Preserving a previously proved accounted flag is safe under the current invariant that stored refundedCents is monotonic and preserved by subsequent detail merges. Concurrent reservations unseen by a reconciliation snapshot remain unaccounted in its fresh locked database read. The payment lock protects the final merge of evidence without replacing concurrent request details.

Provider retrievals are not an atomic remote snapshot. Inconsistent data and the20-page limit therefore conservatively retain holds; an operator may need to reconcile again or review the real account. This is an availability boundary, not evidence of live provider behavior. No further concrete defect was found in this scoped correlation inspection. It does not replace real Ireland-account sandbox testing, signed webhook delivery, live provider validation or the separate browser acceptance work.

Reproduction: `probes/weatherly-independent-billing.mts`, run from the repository using the explicit isolated database and safety instructions in `probes/README.md`. The initial unmodified31-check output retained the prior f014c1a label; the actual checked-out source wasf3b1338. The expanded37-check run updates its candidate label tof3b1338 and is the final result recorded here.
