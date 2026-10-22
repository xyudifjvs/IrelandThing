# Launch review preparation

Prepared against source `e89a29f` on October 21, 2026. This is an independent review matrix, not execution evidence or acceptance. Final reports will name the exact integrated commits exercised. The reviewer does not author product code or builder tests.

## Isolation and boundaries

- Use a disposable local database and isolated API/web ports, guarded against production/nonlocal targets. Do not reuse the user's preview database or stop its processes.
- Use synthetic records and injected providers. No actual Gmail, Stripe, Dotloop, system-mail or external MCP account activation. The root agent alone handles any explicitly authorized synthetic OpenRouter ZDR call.
- Keep scratch probes outside product/test directories; write review evidence only under `docs/reviews/implementation/launch-*.md`.
- Inspect frozen source in an isolated checkout. Results from an earlier SHA do not certify later changes. Builder suites provide supporting evidence, not independent certification.

## Payment mode

Exercise missing/invalid/test/live mode against local, staging and production runtime combinations. Test synthetic `sk_` and `rk_` test/live key shapes; reject mismatches before network access. Explicitly test staging with production authentication settings. Retain Ireland account identity checks. Check event mode, checkout, refund and reconciliation paths consistently honor the same mode; replay/uncertain outcomes must retain their existing conservative handling.

## Assistant retrieval and answer coverage

Create target facts beyond document 40, beyond character 20,000 of a document, beyond matter 200, and across message/history pages. Include an unrelated matter, private coordinator records, duplicate addresses, amendments, superseded dates and missing information. Ask both scoped and portfolio questions, including a follow-up referring to an earlier answer.

Use a synthetic generator that deliberately omits caveats or returns an exact but irrelevant citation. Independently inspect the material actually supplied to it. Coverage/truncation/staleness must be deterministic response data and visible to the user, rather than relying on model prose. Distinguish full authorized record availability via paginated API/MCP from evidence actually retrieved for the in-app answer. Do not equate exact quote existence with support for every claim.

Verify context-budget exhaustion is explicit, pagination terminates, selection is reproducible, and unauthorized records never enter context or citations. Inspect revocation and concurrent source-change handling. Test literal search separately from question-driven retrieval and report its actual scope.

## UI and permissions

- At a narrow viewport and with keyboard navigation, reach account settings, support and sign-out. Check focus visibility and operation after navigation.
- Upload a synthetic file, add a distinguishable second version, download each exact version, share it with a client, and revoke access. Verify client and unrelated-agent direct metadata/download URLs, including historical versions, before and after revocation.
- Current permissions are document-wide. UI copy must disclose whether sharing applies to all versions; a selected version must not imply version-specific publication unless the domain model supports it.
- Force stale document revisions and failed uploads; do not show success or overwrite a newer decision. Check lists beyond their initial page.
- Intake: fail draft retrieval, fail save, edit after a successful save, resume an existing draft, and change branches. Retain entered data, clearly mark unsaved changes, preserve option semantics, and focus the new step or validation error. A failed lookup must not silently imply no drafts exist.

## Root indexing, SEO and operations

Inspect generated HTTP headers and HTML, not only configuration. Staging must default to noindex even without an owned domain; account/workspace/portal/deep-link/error responses must not accidentally inherit public indexability. Verify public-only sitemap/canonical URLs use the approved configured origin, reject unsafe origins, and exclude record/query/token URLs. Robots directives are not authorization.

Verify rate-limit identity through the actual web/API proxy chain: distinct clients, spoofed forwarding headers, missing headers, repeated abusive requests, and unaffected health/recovery traffic. Check shared-store limitations explicitly if scaling remains unsupported.

For any operations work, distinguish tested local utilities from established hosted scheduling, key custody, alert delivery, restore success and cutover approval. Review configured/serving revision evidence without reading secret values. Do not claim real-provider readiness or accessibility conformance from bounded synthetic checks.

## Evidence required from builders

Frozen exact SHA, owned-path diff, changed contracts, dependency/setup instructions, synthetic fixture locations, test commands/results and known limitations. Root supplies the integrated SHA for combined HTTP/browser checks. Findings return to the relevant owner; reviewers do not repair the source they certify.
