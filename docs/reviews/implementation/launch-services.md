# Independent launch services review

Date: October 21, 2026. Reviewer: independent check-team agent, not an author of the implementation or builder tests.

## Exact source and disposition

Initial reviewed builder commit: `21698fdcdf6c9a960c0d919506fa5219887fab0f`. Repairs: `477141c3d4877e2e314ee5249235c2d62b73c09a`, then `75b38f13a1075748d9287612162b0630c0228514`.

**Pass for the bounded independent checks below at `75b38f1`. All three reported retrieval findings are resolved.** The checkout was clean and its HEAD was checked before/after the final pure probe. The root integration `d1f7d8bc8edab78f1b5e667c03ef8525a06c8620` has no diff from that builder commit in `packages/billing`, `packages/assistant`, `packages/assistant-ui` or `packages/ai`.

Builder changes stay within those four owned package boundaries and their handover. No schema or root API/worker edits came from this builder. Review repairs were authored by the builder, not the reviewer.

## Independent execution

| Probe                                   | Result                  | Scope                                                                                                                                                                                                                                                             |
| --------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/tmp/weatherly-launch-independent.mts` | 1,568 assertions passed | Pure synthetic payment configuration/key/event matrix; injected authorized retrieval fixtures; claim/verifier/history checks; gateway policy/resource/concurrency guards; assistant role denial                                                                   |
| `/tmp/weatherly-launch-ask.mts`         | 9 assertions passed     | Actual authorized domain reads and assistant persistence in disposable PostgreSQL, injected synthetic generation/verification only; persisted deterministic coverage and usage audit, saved follow-up context, invalid-quote abstention, concurrent save conflict |

The large assertion count is primarily a matrix, not 1,568 different workflows: 192 runtime/deployment/approval/mode combinations, each checked against mode selection, five key shapes and both event modes, account for 1,536 assertions. The remaining checks target distinct retrieval/AI behaviors.

The first actual-database probe used JSON string ordering to compare PostgreSQL JSONB coverage; it produced a probe-only false failure because JSONB reorders keys. Replacing that comparison with structural equality yielded the recorded 9/9 result. No product change was requested for it.

Scratch probe hashes:

- `weatherly-launch-independent.mts`: `385bff6f356bcf2a2eb5b563a4e9b4d3e17bb50ef0f329398ef44a7df2223ad7`
- `weatherly-launch-ask.mts`: `06b252fcc5cdcea240b3a1ff3cfc52cd9fba04651971445efef1daba950b7a10`

The actual-database probe uses only `checker_launch_ec82009_test`, created for this review. It injects generation functions and replaces network fetch with a throwing function. Synthetic OpenRouter configuration exists only inside that short-lived probe process so the public service's normal configuration check can run; no production/account privacy setting was changed. No real provider, inference, email or payment was called. The application gateway has no public test bypass.

## Findings and repairs

1. **Resolved: mixed question omitted authoritative payment status.** At `21698fd`, portfolio question “What did the email say about payment, and is it paid?” requested only messages, omitted payment records, and could report complete coverage. `477141c` unions requested families; final `75b38f1` always scans the bounded authorized payment/gift/message families and reports `recordKindsScanned`.
2. **Resolved: named-property amendment lost behind unrelated clauses.** Eighty authorized matters/documents had generic closing clauses; the target's document name was “Magnolia amendment” and its matter was Magnolia, while its body contained the new date without repeating the name. Initial ranking omitted it behind unrelated files despite scanning all documents. Final ranking propagates authorized matter/name affinity, includes the assigned matter in source metadata and prioritizes likely matching documents before the text budget. The original independent fixture now includes the target source.
3. **Resolved: natural scope question never read email.** `477141c` still skipped message records for the exact scope example “What did the lender last say?”, because it contained no literal email/message/sent keyword. Coverage showed no scanned record families and `incomplete=false`. `75b38f1` removes that keyword gate; the original independent case now reads messages. Related ordinary questions remain subject to lexical ranking and disclosed caps.

## What passed

- Default/test mode rejects live secret/restricted keys, including when staging uses production authentication settings. Invalid/empty modes fail closed. Live mode requires all explicit approval/deployment/runtime inputs. Event envelope mode is checked separately; Ireland account verification remains on the normal provider path.
- Retrieval traverses more than 200 matters and finds document text beyond 20,000 characters. The named-property and mixed/natural-language record-family regressions above pass. Scan/context limits and lexical document sampling produce deterministic coverage rather than model-only caveats.
- Every claim needs an actual exact quotation. Invalid quotes skip verification and return abstention. Missing, duplicate or contradicted verdicts fail; unrestricted free-form answer fields do not pass the schema. Saved history is bounded and excludes system-role spoofing.
- Agent/client calls to the coordinator assistant fail before readers/generation. Default domain readers retain existing authorization. The actual-database probe reads the real synthetic matter/document projection and persists its answer coverage and audit metadata.
- Two overlapping requests against one saved conversation result in one saved pair and one `CONVERSATION_CHANGED`; stored history retains exactly the winning pair.
- The gateway keeps the fixed OpenRouter URL, explicit ZDR/data-collection denial/provider allowlist, no fallbacks, disabled plugins, no tools/transforms and account privacy gate. Bad token/context limits fail before the injected fetch. Four in-flight requests are allowed; a fifth fails, and capacity is released after completion. Unknown cost remains null.

## Limits that remain

This is not complete semantic retrieval or proof of answer correctness. Retrieval is lexical and bounded (5,000 matters, 1,000 documents, 1,000 records per operational family, eight million document characters; 70 source excerpts/90,000 context characters). Ranked chunks can omit relevant evidence. Saved follow-up context is also bounded. Complete paginated API/MCP availability does not mean all records enter an in-app answer.

The second verifier uses the same approved route/model and is probabilistic. Injected positive/negative verdicts establish application handling, not actual model entailment, independence or resistance to every malicious document. Root's separately authorized synthetic OpenRouter run and builder suites are supporting evidence, not execution performed by this reviewer. Representative real-contract/amendment evaluation, actual approved provider/privacy controls, account-wide spending limits, and external MCP client compliance/consent remain separate gates. Production privacy verification must remain false while account logging controls are unverified.

The reviewer could not access a CUA browser surface; assistant coverage rendering was inspected in source, not independently exercised in-browser. No claim of real Stripe sandbox/live acceptance, production account readiness or launch approval is made.
