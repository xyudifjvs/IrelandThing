# Contract extraction independent review

Reviewed `083dae0` and `70aff46c4ccb73e592edaa2a750253738b96e34e` in `/private/tmp/weatherly-handoff-c04`. Review scope is the extraction code, source asset and worker. C05 owns the creation interface and C00 owns worker registration.

## Changes requested

1. Preserve deadline meanings when adapting the runtime prompt. `packages/ai/src/creation-extraction/prompt.ts` asks the model to determine which offer was accepted but does not define the acceptance date as the date the last party signed that final accepted offer or counteroffer. It also drops most deadline definitions, including the appraisal constraint and the meaning of loan application and earnest money delivery. Those rules still apply under D2 and D3. Retain those definitions alongside signed-term precedence, exact hours and deterministic date arithmetic.
2. Check whether a fixed value is supported by its quotation. `packages/ai/src/creation-extraction/proposal.ts` verifies the quote occurs on a pinned page but does not verify the value. A proposal for `2027-06-30` survived with a real quotation of `The purchase will close on June 3, 2027.` Validate the supported explicit date and money forms and leave unsupported values blank for Ireland to enter. A real quote should not lend credibility to an unrelated value.
3. Classify malformed success envelopes as invalid output in `packages/ai/src/gateway.ts`. An injected fetch returning HTTP 200 with a non-JSON body produced one attempt and `provider_unavailable`. Malformed model content inside a valid envelope retried twice. Handle the invalid envelope within the same retry budget. Validate optional model/provider metadata before passing it to persistence.

## Verified

- The archived prompt is byte-identical to the fenced prompt supplied in the handoff. SHA-256 `b6dd6dc9282fbb9506e440429a4d52e9ccb79b156e487d6a136adc4a469fc548`.
- TypeScript, `git diff --check`, and all 23 focused tests passed. The suite applied all 19 migrations to a disposable database. The counteroffer fixture verifies the proposal adapter receives all pinned pages and retains the synthetic signed proposal. Live model behavior is a separate laptop check.
- An independent injected fetch exercised the actual schema serialization and confirmed the privacy opt-in, approved provider restriction, zero retention, denial of data collection, disabled fallback and strict response shape. The schema rejected invented `adjustments`. Mismatched version/document pairs and a missing first page yielded no source bundle. The gateway received every page in the test packet. The changed code does not log document content.
- An independent migrated database probe verified a non-coordinator and a revoked coordinator could not dispatch extraction. Expired work became unavailable without dispatch. Revocation, confirmation, and a same-generation Skip during extraction each prevented persistence. A successful generation stored one proposal, replay did not dispatch, and no Matter was created.
- C05 needs to advance or skip the active generation when source selections change and present manual entry when the 60-second window expires, including if the worker is unavailable. The worker leaves proposals separate from review edits and never publishes a transaction.

Provider calls used injected responses. No live credentials or contract records were used.

## Recheck of `9abb14eb53802e09f448fc1ee4bc37f3d218577a`

Changes requested. The runtime prompt restores the acceptance and deadline definitions and keeps signed-term precedence. The validator rejects mismatched civil dates and cents when the quotation includes the complete source value. An independently injected gateway retried non-JSON, array and null success envelopes and rejected non-string model and provider fields within the same two-attempt budget. Its request retained the strict schema, approved-provider restriction, zero retention, data-collection denial and disabled fallback. Disabling account privacy verification prevented dispatch.

1. Match complete value tokens in their pinned-page context. The normalized substring check in `packages/ai/src/creation-extraction/proposal.ts` accepts a clipped quote as evidence. In the independent probe, `Purchase price $100` cited against `Purchase price $100,000` retained 10000 cents. `Closing 6/3/20` cited against `Closing 6/3/2027` retained `2020-06-03`. Reject quotes that clip a numeric value or require a complete match in the pinned page whose span falls within the quoted text.
2. Ground the optional instant independently of the civil date. A proposal retained `2027-06-04T10:30:00-04:00` when the complete quote was `Possession June 4, 2027.` Keep the supported civil date and clear the instant when the quotation does not establish the clock time and offset.

TypeScript and the diff check passed. All 24 focused tests passed after applying all 19 migrations to a disposable synthetic database. The independent probe also confirmed valid whole-token short and long U.S. numeric dates, ISO and named-month dates, decimal currency matching, and rejection of mismatches against complete quotations.

## Recheck of `4c1bc453c3fd0e83928375ee738445d6d11ec579`

Accepted for the local extraction core and worker. Independent probes rejected the original clipped `$100` and `6/3/20` quotations, a clipped decimal amount, and a quote starting midway through a numeric date. A date-only quotation retained its civil date with a blank clock. A complete ISO instant and documented Eastern standard and daylight clocks survived. A summer clock proposed as daylight time against a quotation explicitly saying standard time was cleared.

TypeScript, the diff check, and all 25 focused tests passed on an independently created disposable PostgreSQL database with all 19 migrations. The isolated runner refused a synthetic non-local address, and the test configuration refused a local database without the `_test` suffix. Injected gateway responses confirmed the two-attempt budget for malformed success envelopes. The captured requests preserved ZDR, denied data collection, restricted routing to the approved provider, disabled fallback and tools, and kept a synthetic malicious document instruction in the untrusted user payload. Dispatch was blocked with account privacy verification disabled.

The validators establish token support. If a quote spans multiple terms, the reviewer still needs to check which term a value belongs to. A synthetic quote with a closing date followed by a separate possession date and Eastern clock can support a proposed closing instant by token matching. Exact clocks outside the supported ISO and Eastern formats fall back to a blank clock for manual review. C05 owns the review, date computation and confirmation flow. Legacy AI compatibility and real OpenRouter account verification are outside this candidate.

## Legacy compatibility review of `4e53cf52cd1eb8c0eb0aa02f6ac6f221cbd9a0aa`

Changes requested. In `packages/ai/src/legacy-review/worker.ts`, the canonical check and claim run before the pinned-document and subsequent owner lookups. An independent probe used C05's actual `startCreationReview` to open a review during the pinned version lookup. The canonical review had committed by the time the legacy worker invoked the injected generator. The post-inference guard discarded its result, but the dispatch would already have sent the source. Run the final canonical check and claim immediately before invoking the generator, after the source and owner checks, while preserving the post-inference guard.

The new modules preserve the service exports and leave the listing, owner-validation and rejection function bodies unchanged. In a synthetic agent-intake fixture, a legacy job produced the expected pending result and pinned evidence before a canonical review started. Once the review existed, requests, queued dispatch, approvals and conflict resolution were blocked, and intake preparation returned no proposals. Opening the canonical review inside the injected generator prevented persistence of the result. The Matter row serializes legacy mutations with C05's start and confirmation. C05 can hold a review row lock before waiting for Matter because the compatibility query reads the review without taking a row lock. Approval locks Matter before its source documents, matching C05's order.

TypeScript, the diff check and all 43 AI tests passed on a disposable database after all 19 migrations. The independent race probe also ran on a fresh disposable database. Every generator was injected.

## Legacy compatibility recheck of `9aa8a0a2bc908844b022cc60956c87eea864e00d`

Accepted locally. The worker checks and claims under the Matter lock after loading the pinned source and rechecking the owner. In an independent disposable database, the actual C05 start command at `8404343f00c3063421b5bd2ebf1d7b319a8b233a` committed an open review while the pinned version was loading. The legacy generator received zero calls and the old proposal retired. A review already open at worker entry also prevented dispatch. Opening a review during the injected generator caused the completion check to discard the result without changing the Matter or storing model metadata. The legacy control produced a pending proposal with pinned evidence.

TypeScript, the diff check and all 43 AI tests passed after migrating a fresh synthetic database. The probe used no live provider or credentials.
