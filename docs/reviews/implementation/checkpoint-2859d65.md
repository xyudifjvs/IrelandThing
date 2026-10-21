# Independent frozen-checkpoint review:2859d65

Date: 2026-10-20, America/New_York. Product source was checked out at exact `2859d65` in the isolated reviewer worktree. Only reviewer reports/probes are edited here. All runtime evidence uses synthetic accounts, a separate local PostgreSQL database and local document stores. External AI, Gmail, Stripe, Dotloop and Railway operations were not performed.

## Finding requiring correction

**P2 — query_records ignores matterId for kind=matters.** Actual shared-service call `queryStoredRecords(owner,{kind:'matters',matterId:'demo-oak',limit:100})` returns12 matters, including unrelated IDs. The switch calls listMatters with cursor/limit but drops matterId. This is a query correctness issue for the coordinator, rather than a cross-role disclosure. Apply the requested matter filter using an authorized domain read, or reject that combination explicitly. Parent notified with the reproduction.

## Resolved findings

- EmailThread revision migration is committed and applies. The later normalization migration no longer repeats the column addition. A read-only Prisma migration diff after both newly committed migrations is empty.
- API and worker register the transactional draft-refresh hook. Six independently authored actual-HTTP checks pass: generated date fields refresh, a hand-edited body is preserved while generated subject updates, preserved edits require review, stale reset409, current explicit reset restores generated content, and the confirmed merge value carries its source ID.
- The earlier inaccessible history gap is closed for the tested primary message query:230 synthetic messages are all returned across three cursor pages without duplicate IDs. Primary matter pagination exposes its next cursor. Actual MCP resource reads succeed and current-grant audit rows include both resource and tool receipts.

## Independent evidence at this exact checkpoint

| Probe | Result | Practical boundary |
| --- | --- | --- |
| Core HTTP/auth/intake |17/17 pass|Real cookies, negative actor isolation, narrow client projection, revision race200/409, identical intake replay200/200/same matter, exactly one submission, agreement evidence gate, immediate session revocation|
| Real PDF/document API |20/20 pass|Actual parser, immutable original/latest bytes, authorized sharing, direct cross-role metadata/download denial, draft isolation, invalid PDF/legacy DOC refusal|
| OAuth/MCP |30/30 pass|Real Next proxy and API routes, allowlist/consent/PKCE/single-use code, read-only tools,230-message history, current-grant tool/resource audit, origin/bearer/revoke denial|
| Date-to-draft refresh |6/6 pass|Actual mounted HTTP hook, manual override preservation and explicit reset|
| Dotloop |15/15 pass|Independent in-process fake provider plus actual PostgreSQL; unconfigured/no fetch, coordinator/state binding, one-use state, encrypted token, unrelated-client isolation, binary verification gate, HTML refusal, revoked owner fails before fetch|
| Encrypted recovery |12/12 pass|Separate fresh migrated source/target databases and local stores, two immutable object versions, exact bytes/linkage, wrong key/ciphertext tampering refusal, source DB/store overwrite refusal and populated-target refusal|
| Schema drift |Empty diff|Committed migrations match current Prisma schema|

The recovery probe authenticates the manifest, challenges modified encrypted object bytes, restores every table and checks both immutable document versions against database linkage. It uses local PostgreSQL17 tooling through the existing synthetic container. It does not certify an actual Railway backup, off-site retention, external storage access or unattended scheduled recovery.

Dotloop metadata sync correctly reports manual_upload_required when binary capability has not been verified and creates no pretend document. An unexpected HTML response with binary capability enabled fails with DOTLOOP_BINARY_UNAVAILABLE and leaves actionable link error state. These checks establish local gating and processing behavior only; Ireland's actual Dotloop account capability remains unknown.

The real-PDF regression completed20/20 after the normal authentication cooldown. Earlier429 attempts did not reach the document assertions and are not counted as failures or successes. Typecheck passes at this exact checkpoint. The committed deployment-safeguard script also passes its checks for automatic-seed exclusion, private service declarations, unprivileged runtime declarations, health probes and secret exclusions. This is static configuration evidence, not a built image or deployed runtime check.

## Remaining limits

No overall production approval is issued. Real account credentials, provider privacy settings, Ireland's own Stripe identity, actual Gmail/Dotloop scopes and binary document access, external OAuth callbacks, Railway deployment/restore, live payment reconciliation, full source-to-screen acceptance, accessibility and browser interaction coverage still require their own evidence. Synthetic probes cannot establish live provider success. The full original scope should not be described as completed merely because local integration checks pass.
