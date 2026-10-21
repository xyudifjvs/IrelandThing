# Independent planning review

Final recheck: 2026-10-21 01:49 UTC (2026-10-20 in the project's timezone). This is a static review of planning artifacts and source references. It is not implementation acceptance, provider-access verification, runtime testing, or deployment authorization. The reviewer did not author the three planning documents and changed no product code or planning document.

## Result

The planning artifacts pass this independent static review. The proposed scope covers the complete Weatherly product and preserves the material source conflicts. The shared-service architecture, one schema/migration owner, independent checker responsibilities, and four-slot rolling execution model are appropriate. All four findings below were corrected and independently rechecked. No remaining concrete planning defect or major scope omission was found. Unresolved business decisions and provider-access gates remain explicitly identified; this result does not resolve them or authorize product implementation.

## Findings

1. **Resolved P2 — MCP action scope.** The implementation plan now promises API/MCP coverage for authorized business reads, uses authenticated APIs for product writes, and limits external MCP grants to reads. Future external writes require separately approved scope. This agrees with the technical plan. B08 owns tool mapping onto domain services; B00 only mounts exported registrations.

2. **Resolved P2 — Exclusive path ledger.** B00 now explicitly retains app-level manifests/configuration, shared web root pages/styles, public assets, root test wiring and integration mounts. Module fixtures stay in their packages; acceptance fixtures/configuration stay under B13. B12 uses `infra/**` and `.github/workflows/**` without a root deployment exception. URL ownership and duplicate-route prevention are explicit. New paths require allocation before edits. Schema/migrations remain B00-only.

3. **Resolved P2 — Requested model.** Both teams now explicitly use GPT-6.1 sol, consistent with reusable assignment prompts.

4. **Resolved P3 — Planning-only authorization.** The status now explicitly identifies a planning deliverable, states that product implementation has not started, and distinguishes separately authorized repository synchronization from permission to begin product implementation or deployment.

The final recheck also confirms that foundation acceptance uses contract fixtures rather than requiring B08's unfinished MCP implementation, avoiding a circular gate. Deterministic document processing belongs to B03; model extraction/classification/draft generation to B07; Q&A orchestration/tool mapping to B08; domain mutations to their owners; UI composition to B09–B11. B04 owns communications services and query APIs rather than overlapping portal/workspace screens.

## GitHub follow-up checked

The final implementation plan records the existing `xyudifjvs/IrelandThing` repository, isolated builder branches/worktrees, pushed exact-commit checker handoffs, coordinator integration, committed review evidence, checkpoint/fix synchronization, no shared-checkout branch switching, and explicit reporting of unsynced commits. README navigation agrees with the three plans and identifies this review as planning evidence. The stale no-Git statement was removed. Local inspection confirms `origin` targets that repository and initial history includes `3de33bf Initial commit`. Push completion is the coordinator's subsequent action and is not asserted by this review.

## Reviewed content fingerprints

SHA-256 of the final reviewed files, before the coordinator's commit/push:

| File | SHA-256 |
| --- | --- |
| `PROJECT_SCOPE.md` | `665175a87de4aa0590691463689946d1b71da77bc426468c792a833177fb9b97` |
| `TECHNICAL_PLAN.md` | `f14775eff1f7f4123e3407903db6ce91f13a18d021026a9535aef462fb4550e2` |
| `IMPLEMENTATION_PLAN.md` | `fda792595afdf62f63e8cf6395cb2a2475a1f4ff34f69b07b5367649ad9e76f1` |
| `README.md` | `f69818dbd6bee515c4144fbc7407c01bd2725369d9fd5e89288fb9684bbb7266` |

## Source reconciliation checked

- Read all eight extracted website designs: About Me, Service Levels, A Simple Process, New Agent Onboarding, Testimonials, FAQ, Agent Portal, Contact. Ireland is the named founder with Ohio/US experience; no country-of-Ireland or multi-business assumption is justified.
- Read the coordinator platform's rendered markup and component logic. Checked dashboard and listing stages, matter checklist, extraction/review, configurable email groups and merge fields, recipients/attachments, send history, broker library, private notes/to-dos, contact management, inbox proposal/approval/rejection, settings, invitations, and missing portal links.
- Read the complete standalone intake markup and script. Checked six steps; buyer/seller and cash/finance conditions; upload/Dotloop branch; multiple clients/relationships and contact restrictions; all title/lender/HOA/reissue choices; broker/pre-1978/checklist fields; notes; gift tiers/options/personalization; review and prototype submit behavior. Required-field enforcement is disabled in the source.
- Verified the differing service prices, $65/three-choice website gift offer versus three blank-price intake tiers, absent Full Listing intake, service-agreement/access gate, incomplete copy/contact details, Venmo mockup versus planned Stripe, and brokerage/person/vendor template residue. These remain explicit owner decisions or approved production replacements.
- Confirmed the plan includes actual authenticated agent/client portals rather than treating absent linked designs or preview toasts as implemented functionality. Full Listing retains its matter identity through the under-contract transition.

## Architecture and policy checked

- Current FF dashboard source confirms the cited pattern: `server/src/lib/matterService.ts` exposes shared operations and `server/src/lib/agent/tools.ts` imports them and obtains actor context outside model input. This is evidence of a useful local pattern, not proof of a production remote MCP server or of that repository's runtime security.
- B00 owns all schemas/migrations and registry wiring. Domain owners own service semantics and domain writes. B08 can own tool mapping while calling domain services; separate per-domain tool files are not required. HTTP/MCP parity needs independent authorization and visibility tests rather than duplicated workflow code.
- OpenRouter's current [ZDR documentation](https://openrouter.ai/docs/guides/features/zdr) supports endpoint-based inference restrictions and warns that plugins/tools have separate retention behavior. Its [provider-selection reference](https://openrouter.ai/docs/guides/routing/provider-selection) documents the proposed routing fields. Its [PDF reference](https://openrouter.ai/docs/guides/overview/multimodal/pdfs) confirms the parser-fallback concern. The proposed local text/page preparation, approved endpoint routing, no external OCR/embedding escape hatch, no direct-provider fallback, and unavailable-capacity retry/manual state preserve the requested policy.
- External MCP access cannot control downstream model choice after returning content. The plan correctly requires a separately compliant client deployment; implementation must supply a concrete admission mechanism, and deny access when compliance cannot be established. Client registration or an OAuth identifier alone cannot prove model routing.
- Independent reviewers may not repair or approve their own implementation/tests; fixes return to builders and exact revisions require re-review. The final reviewer independently checks acceptance coverage. Four concurrent slots support coordinator + two builders + one checker, not twenty-eight simultaneous agents.
- Early Gmail, Dotloop, OpenRouter, payment, storage, and recovery probes are dependencies with honest blocked states. Provider mocks cannot satisfy integration acceptance. Database and document-object restoration are both required.

## Remaining owner decisions and evidence limits

Owner decisions still include catalog/gifts, fee timing and cancellation/refund policy, domain/mailbox and territory, brokerage rules and contract examples, agreement/copy, historical import, portal sharing, retention/deletion, recovery target, and admitted external assistants. The plans correctly avoid inventing these answers.

This review did not exercise Gmail, Stripe, Railway, Dotloop, authentication, OpenRouter account settings, or a remote MCP client. It did not validate launch pricing, legal policy, live credentials, production document handling, or any implemented product. Other linked provider documentation was assessed for placement and claim clarity, not independently revalidated in this checker pass.
