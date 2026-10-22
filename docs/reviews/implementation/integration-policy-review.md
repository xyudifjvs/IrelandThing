# Independent integration policy review

Exact candidate: `639caf4`. Status: **fail pending corrections**. Tests use synthetic data, an isolated database, injected model responses and local Stripe-shaped event objects. No OpenRouter, Stripe, Gmail, Dotloop or other external operation was called.

## P1 — OpenRouter plugin escape

`packages/ai/src/gateway.ts` emits correct inference routing flags and rejects missing configuration before fetch. However it accepts a configured model ending in `:online` and omits explicit plugin disabling. Independent injected-fetch assertions confirmed both conditions. OpenRouter's [plugin documentation](https://openrouter.ai/docs/guides/features/plugins/overview) states that omitted plugins inherit account defaults and the online variant enables web search. ZDR inference routing does not cover plugin processing. Require verified safe account configuration, reject plugin-triggering variants, and explicitly disable content-forwarding plugins per request. Account-level prevent-overrides restrictions must also be checked before enabling the integration.

Probe: `/tmp/weatherly-independent-ai-policy.mts`. Unconfigured/no-fetch passed; online-variant rejection and explicit plugin-boundary assertions failed. Correct URL, zdr, data_collection deny, parameter support, provider allowlist and no fallbacks were observed.

## P1 — Billing advisory locks abort transactions

`packages/billing/src/service.ts` calls `$queryRaw` on `SELECT pg_advisory_xact_lock(...)`, whose PostgreSQL return type is void. Independent `applyStripeEvent` execution threw PrismaP2010/UnsupportedNativeDataType before processing the synthetic event. The same pattern is used by checkout. Use an execution method or return shape supported by the Prisma adapter and exercise actual PostgreSQL transactions.

Probe: `/tmp/weatherly-independent-integrations.mts`. Refund ordering could not yet be tested because the initial event aborted at this lock.

## P1 — Concurrent amendment can approve stale proposal

`approveReview` checks latest source version before acquiring the matter write lock. Independent controlled race:

1. Lock the matter row in a separate synthetic database transaction.
2. Start approval; it reads old proposal/version, claims the pending proposal, then waits on the domain matter CAS.
3. Upload a real newer PDF version changing the closing date from November25 to November30.
4. Release the matter lock.

Observed: old proposal approved November25, and the accepted deadline's evidence points to the newer PDF version while proposal refs still point to the old one. Serialize document-version writes and review acceptance with consistent locks and compare the expected version within that protected interval.

Probe: `/tmp/weatherly-independent-source-race.mts`. Latest controlled race failed the expected stale-source rejection assertion. PostgreSQL activity snapshots were explicitly refreshed to identify the lock pause; earlier harness attempts that did not reach the controlled pause are not used as product evidence.

## P2 — Unverified page provenance

Injected extraction returned an exact quote found on stored page1 but claimed page999. `processReview` persisted page999 unchanged. Validate page/quote against stored page text or remove the page claim and flag uncertainty.

Probe: `/tmp/weatherly-independent-integrations.mts`, first check. Expected page-provenance assertion failed.

## Pending refund-order check

Static inspection also found unconditional refund status replacement: a full-refund event followed by an older partial-refund snapshot appears able to change refunded to partially_refunded. Reproduce after the advisory-lock fix, then reconcile refund state monotonically or from authoritative current provider state. This is not yet a completed runtime finding because the lock failure prevented reaching the branch.

## Boundaries retained

Stripe has explicit Ireland-account owner/ID checks and rejects live keys outside production. No Carson Stripe account connection was attempted or authorized. Ireland's actual credentials and provider connectivity remain unconfigured and unverified. AI model-quality, live account privacy settings, external MCP client admission, provider sync, durable worker execution and recovery are separate acceptance gates.

## Fix recheck at17e19ab

All four reproduced security/correctness defects above are resolved in this exact checkpoint:

- Gateway rejects missing account-privacy attestation and `:online` before fetch; a valid synthetic model emits explicit disabled web/file-parser/response-healing/fusion plugins, empty tools/transforms and the original fail-closed routing flags. Four independent policy assertions pass.
- Actual PostgreSQL synthetic Stripe events now pass the advisory lock. Full refund followed by an older partial refund remains `refunded`.
- Model-supplied page999 is replaced with actual stored page1.
- Controlled source race observes the new-version upload blocked behind approval's Document lock. Once the matter pause is released, approval commits against its original source version; the later upload then completes. The accepted deadline retains the original version, so no stale proposal was silently rebound to a newer document.

These results resolve the reported findings; they do not establish a full integration pass. New assistant/MCP modules are undergoing coverage review. Their current seven tools omit promised record families such as onboarding/inquiries, intake/submission snapshots, agreements/catalog/templates, AI proposal/review history, audit and integration freshness; this gap has been reported. Workflow handling of confirmed rule-derived dates after anchor changes also needs an explicit stale/review policy and tests. Live provider/account validation remains blocked by configuration.
