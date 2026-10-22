# Independent implementation risk checklist

Reviewer: check team, GPT-6.1 sol. This checklist is prepared from the approved scope and technical/implementation plans. No product code or builder-owned tests are authored by this reviewer. Items begin untested; approval requires evidence against a supplied exact commit in this isolated checkout.

| Area | Independent evidence required |
| --- | --- |
| Foundation | Clean install/build/typecheck; schema initialization and upgrade; durable persisted state survives restart; job lease/retry/outbox recovery; explicit errors and redacted logs |
| Identity/access | Coordinator, two unrelated agents and unrelated client fixtures; sign-in/recovery/invite reuse and expiration; MFA; revocation; direct URL/API/search/export/file/MCP isolation |
| Intake | All package/side/cash/contract branches, multi-client relations/contact policy, title/lender/HOA/reissue/compliance/checklist/gift answers; answer changes; resume; validation; double-submit; actionable tasks |
| Matter/workflow | Same-ID listing conversion; linked dual-side matters; concurrent edits/revision conflicts; unknown/N/A distinctions; correct date anchors/timezones; accepted/amended proposals preserve manual corrections |
| Documents | Authorized upload/download, immutable versions, provenance/checksum, unsupported/malicious/oversized files, safe signed access and expiry; useful PDF/Word text/pages; no external parser bypass |
| Communications | Draft/recipient/attachment overrides/reset and sent snapshots; unresolved merge rejection; client-contact and copy-agent enforcement; message association ambiguity; approval before consequential changes; safe retries after ambiguous send |
| Money/gifts | Server prices and snapshots; raw webhook signature; duplicate/out-of-order/refund/failure handling; no redirect-as-payment; confirmed payment before order; truthful unconfigured/test state |
| Dotloop | Loop/doc authorization, import through document service, origin/deduplication/refresh, revoked/missing state; unconfigured integration never reports successful sync |
| AI/ZDR | One OpenRouter gateway; enforced ZDR/data policy/endpoint allowlist; caller cannot weaken flags; unavailable or unknown endpoint fails closed; no direct provider, external OCR/plugin/search/embedding escape hatch |
| Assistant/MCP | Same domain services and authorized read parity; source citations/current revisions/freshness; restricted searches; no arbitrary model-supplied principal; external read-only grants and verified-compliant client admission |
| Public/portal/workspace | All eight public purposes; working onboarding call and email-info routes; approval/agreement gate; authenticated agent/client projections; every source workspace control wired; accessibility/responsive/error/empty states |
| Operations/release | Synthetic/test isolation; no live sends/payments without configuration; database plus object restore; CI and runbooks; secrets excluded; exact reviewed source SHA; persistent usable live preview |

Use independently authored scratch HTTP/browser probes to challenge implementation assertions. Builder tests may be rerun, but their passing output alone is not independent acceptance. Findings include severity, exact source revision, reproduction, observed/expected behavior, and responsible owner. Fixes return to builders and require re-review. Credential-dependent behavior remains blocked until actually configured and exercised; local simulation cannot certify provider integration.
