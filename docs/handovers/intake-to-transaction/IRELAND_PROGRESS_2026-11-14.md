# Ireland handoff progress — November 14, 2026

This is the current handoff status after Ireland's decisions and account setup. It supersedes older statements that all providers are unconfigured. Configured, deployed, and verified delivery are separate milestones. Secrets are stored in Railway/provider accounts and are not included here.

## Source and validation

Started from GitHub main `20d806d02485daae570322b4a7a4c5994936f2aa` (PR #4). Preserved 25 changed/added local files, the patch and original checkout state in a local backup before replacing the primary checkout. The linked `intake-workflow` checkout was reset to the same baseline in detached HEAD state; ignored local environment files/data were retained. That secondary checkout does not contain the subsequent feature changes.

This source update includes custom email merge fields, Ireland's replacement social image, and the handoff documentation. It does **not** implement the contract-default or Follow Up Boss corrections below. The verified hosted deployments listed here ran the earlier baseline; verify the new source deployment and migration independently after publishing this update.

- Prisma client generation and repository TypeScript checking passed. TypeScript and `git diff --check` were rerun successfully before this commit.
- Five custom-field regression cases and targeted component rendering checks passed previously through a TypeScript module runner with mocked dependencies. See [feature validation](../../release/custom-email-merge-fields.md).
- Standard Vitest was retried before committing and cannot start: the local Rolldown native binding is missing, with fallback `@rolldown/binding-wasm32-wasi` also unavailable. No standard Vitest pass or new full production build is claimed.
- The earlier 456 tests/69 files and 20-migration rehearsal belong to the original release candidate, not a rerun of this update.

## Decisions confirmed with Ireland

| Item | Decision | Remaining work |
| --- | --- | --- |
| D2 — signed terms | Propose the signed contract's explicit Remedies/Title Commitment date for Ireland's review when it differs from a normal calculation. | Provider extraction acceptance. |
| D4 — moving dates | Use **Update all**, using dependencies from the uploaded contract. Independent dates remain fixed. Ireland did not approve permanently pinning downstream dates as a default. | Remove the unsupported fallback rules described below. |
| D3 — business/package changes | Keep the existing option; useful but rarely needed. | Low priority; no extra feature requested. |
| D5 — terminal corrections | Correct linked HTO facts/Closing after close-out or termination without reopening lifecycle status; preserve recorded actual dates/history. | Hosted acceptance. |
| D5 — HTO row lifetime | Keep the row dormant when leaving HTO, reuse it on return, remove it on permanent file deletion while retaining audit history. | Hosted acceptance. |
| D5 — FUB export | Export saved full client name and saved phone; require completion before export instead of generating blank name/phone cells. | Implement the replacement export/review below. |
| D6 — older documents | Require the explicit client-sharing choice before publishing documents from older-version transaction records to portals/shared links. | Hosted audience/publication acceptance. |
| D7 — older drafts | Require recipient review, fresh save and approval for drafts missing recipient-approval evidence; preserve sent history. | Gmail acceptance remains deferred. |
| D8 — private digest | Weekdays at **8 a.m. America/New_York**, since the previous weekday cutoff; Monday includes the weekend. Include processed submissions, exclude deleted intakes, preserve boundary and uncertain-delivery rules. Both businesses may appear in Ireland's private summary. | Enabled and ready; first scheduled delivery is unverified. |

## Implemented source changes

### Custom email merge fields

The bottom of Settings' email-template section now supports creating custom field definitions with a name, stable `custom_` code and optional default value; editing defaults uses revision checks. Templates validate saved custom codes. The composer shows fields used by the selected template, accepts per-email values, and saves those values with the draft snapshot. Changed values require refilling and reviewing before sending; refilling saved wording is explicitly labeled. Custom fields cannot replace canonical transaction facts.

Coordinator-only APIs and the `CustomMergeField` table are included. Apply migration `20261114010000_custom_email_merge_fields` before starting the updated API. Real database migration, browser acceptance and source deployment still require verification. Creating a merge field does not add automatic contract extraction for that field.

### Replacement social artwork

Ireland selected `apps/web/public/brand/og-1-cream.png`, unchanged at 1200 × 630, SHA-256 `29059c514e151c594116bc8f8e517ffbf12d84ce5983db25ffbfed002f1866d7`. Open Graph/Twitter metadata uses it on all seven public pages; `/opengraph-image` redirects to it. Targeted metadata checks and byte comparison passed. Verify hosted previews after source deployment.

## Required corrections not yet implemented

1. **Contract-derived date rules:** `apps/web/app/(workspace)/workspace/_features/creation/review-model.ts` inserts `checklistWorkflowDefault` values when neither a saved date nor extracted proposal exists. `packages/matters/src/checklist/templates.ts` supplies Remedies on the inspection deadline and seller Title Commitment 15 calendar days before closing. These are not necessarily uploaded-contract terms. Remove automatic assumptions from new creation reviews; retain supported contract dependencies and explicit manual choices. Missing/ambiguous terms should remain unresolved. Do not silently rewrite saved transactions.
2. **FUB name/phone completeness:** use FUB's supported single `Name` column with canonical saved full name, or joined saved manual name parts. Use the same client's saved phone. Before download, show selected clients missing name/phone and require completion; do not invent values, substitute an agent's phone, silently skip clients, or match by name alone. Recover older data only through unambiguous identity matches with conflicts shown for review. Preserve CSV formula and international-phone protections. [FUB import documentation](https://help.followupboss.com/hc/en-us/articles/4402323033751-Importing-Contacts-Overview).

## Content and intentionally deferred work

- Ireland has buyer/seller email templates and will upload them through the app later. Do not invent substitute template wording.
- Compliance items will be added later; leave the tab empty.
- Keep current client-portal wording for now. Future wording changes are likely; this is provisional copy acceptance.
- Service-agreement signing link and related Calendly confirmation wording: **later**. Booking never establishes signed-agreement evidence.
- Dotloop: **later**, explicitly selected November 14. Leave disconnected; account/developer access and import acceptance remain deferred.
- Two-account Gmail transaction routing: **later**. HTO uses `office@hometeamohio.com`; Weatherly uses `ireland@weatherlytc.com`. These are separate Gmail accounts. Current code supports one mailbox/connection per coordinator. Implement separate OAuth connections, mailbox-specific synchronization/threading and business-specific dispatch before enabling this routing. Bind sender/business to draft approval and require renewed review after changes; never fall back to the other business's account. Gmail remains disabled.

## Current hosted account and provider status

Existing Railway project **Weatherly**, project `30de0fd0-a76c-4152-955b-597a37e75be0`, environment named **staging**, `dfa8c390-c08e-4864-a1ba-93830ef1f9e5`, serves the real domain **https://www.weatherlytc.com**. The environment's name does not change Ireland's instruction to use her real provider accounts. Do not substitute a different project/account based on older infrastructure notes.

### OpenRouter

Ireland entered the key on **API**; worker references `${{api.OPENROUTER_API_KEY}}`. Both use `anthropic/claude-sonnet-4.6`, only `amazon-bedrock/us`, with ZDR/account-privacy flags enabled. The signed-in account was checked: ZDR-only retention choices, model-group ZDR enabled, training/public sharing/data-discount options off, input/output logging off, and no configured trace destination. Ireland explicitly approved sending uploaded contracts and related transaction details to this route. Configuration deployments succeeded. A fresh paid inference/key-validity and route-failure acceptance run has **not** been performed.

### Stripe

Ireland required her **real** account `acct_1UYGFP9w5uktzmMn`, not the sandbox. Live webhook `we_1Ubl4p9w5uktzmMnJw07iHf5` targets `https://www.weatherlytc.com/api/webhooks/stripe` for Checkout completion/async success/failure/expiration, refunds and dispute creation. Live mode/account/signing-secret settings are installed. Ireland entered the key in **worker**; API references `${{worker.STRIPE_SECRET_KEY}}`. Actual key/account-match acceptance remains unverified.

`PAYMENT_LIVE_APPROVED=false` remains; the environment is staging, so the live-payment release gates remain closed. No charges, refunds or real-money acceptance tests were performed. Do not enable payments merely because account configuration is present.

### Calendly

Connected Ireland account, Eastern time; approved **30 Minute Meeting** at https://calendly.com/ireland-weatherlytc/30min. API event URL and exact event-type URI are installed. Public scheduling endpoint returned HTTP 200 with `configured=true`, the approved URL, and `syncConfigured=false`. Signing key/subscription and booking/cancellation synchronization are not activated. No booking or provider notification was created as a test. Agreement link/email changes are explicitly deferred. See [Calendly operations](../../runbooks/calendly.md).

### Resend and private weekday summaries

Ireland approved three Squarespace DNS additions for `weatherlytc.com`: DKIM TXT at `resend._domainkey`, and the MX/TXT pair at `send`. Exact values matched public DNS and each provider record reports verified. Existing Google Workspace and Railway DNS records were retained. Resend's aggregate domain state was `partially_verified` because the separate Forge `rsend` CNAME remained pending; Forge was not enabled.

The explicitly approved content-free setup test from **Weatherly <ireland@weatherlytc.com>** to **ireland@weatherlytc.com** was reported **delivered**, provider email `01a1db5d-06a6-7946-9119-62173ca87d6a`, November 14 at 18:41:09 UTC. This was a connected-provider test, not an application digest/invitation/password-reset journey.

Ireland separately authorized Railway activation. A read-only server check confirmed exactly one verified coordinator at the approved address, user `ab970a19-dbd2-4bcc-8ab7-858a45668c53`, no access revocation and no queued system/digest/invitation/Gmail-send messages. No identity permissions/passwords were changed. Browser sign-in was not required; the available browser account was Preview Client and was not promoted.

A new Resend key restricted to **sending from weatherlytc.com** was stored directly on API; worker references `${{api.RESEND_API_KEY}}`. No token was written to source/chat. A `/domains` lookup returned HTTP 401 with `restricted_api_key`, which reflects its sending-only scope. The earlier key's HTTP 401 without a captured error body did not establish that it was invalid. The temporary check initially treated every 401 as invalid and failed two diagnostic deployments; it was removed before the successful normal rollouts.

Both services have:

| Setting | Value |
| --- | --- |
| `SYSTEM_EMAIL_FROM` | `Weatherly <ireland@weatherlytc.com>` |
| `REMINDER_RECIPIENT_USER_ID` | The verified coordinator ID above |
| `REMINDER_TIMEZONE` | `America/New_York` |
| `REMINDER_LOCAL_TIME` | `08:00` |
| `REMINDER_WEEKDAYS` | Monday–Friday (`1, 2, 3, 4, 5`) |
| `REMINDER_LEAD_DAYS` | `7` |
| `PRIVATE_REMINDERS_ENABLED` | `true` |
| `OUTBOUND_EMAIL_ENABLED` | `true` |
| `GMAIL_ENABLED` | `false` |

Both server-side checks reported `ready=true`, `status=scheduled`, `deliveryStatus=scheduled_not_verified`, and the exact approved recipient/schedule. No additional immediate email or digest was sent. First scheduled run: **Monday, November 16, 2026 at 8 a.m. Eastern**. Actual scheduled delivery and final digest wording remain to verify.

Final verified configuration deployments before this source update:

| Service | Deployment | Result |
| --- | --- | --- |
| API | `5171d082-99d8-4362-9df2-09fb3b13acc9` | SUCCESS; startup confirmed; all 20 baseline migrations applied, none pending |
| Worker | `adaa873e-7fce-4a83-97f1-780eb7978419` | SUCCESS; startup confirmed |
| Web | `0e2cfe91-49bb-40da-a428-23ec05f50b5b` | Earlier successful baseline deployment |

Temporary diagnostics and the completed legacy preview-password bootstrap were removed from saved deployment configuration. API pre-deploy is now `npm run db:deploy`; worker pre-deploy is empty. Scheduled readiness is not proof of delivery.

### Private storage — inspected, acceptance incomplete

Existing Railway `documents` bucket `0a9190cb-3cb2-4e4e-9eff-492b883dbce6`, S3 bucket `documents-gsk3sm4bna3zv3q`, endpoint `https://t3.storageapi.dev`, region `auto`, virtual-host addressing. API and worker both define `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. OAuth tools redact credential values, so names alone do not verify correct references or actual storage access.

Source inspection confirms production requires S3 storage; downloads check actor/document access and checksums and omit storage object keys from API metadata. No hosted synthetic upload/download, anonymous access probe, share-withdrawal, deletion-cleanup or recovery test was completed in this session. Do not call storage acceptance complete.

## Next work

1. Verify source deployment/migration and custom merge-field browser behavior after this commit is published; verify hosted social previews. A push to the existing source branch may start Railway builds automatically.
2. Implement and test the two outstanding contract-rule/FUB corrections.
3. Complete private-storage access and synthetic lifecycle checks, then the encrypted-backup/isolated-restore rehearsal. Backup cadence/retention, independently stored recovery key and operational monitoring are not yet established.
4. Verify the first scheduled digest and authorized invitation/password-reset flows; verify OpenRouter inference and Stripe account/runtime behavior while live-money gates remain closed.
5. Finish coordinator/agent/client access acceptance and representative intake-to-transaction journeys. Restore reconciliations and final real-client launch approval remain separate requirements.
6. Resume explicitly deferred templates/compliance, dual Gmail accounts, agreement link and Dotloop only when Ireland asks.

The handoff review is ongoing. Provider configuration, this commit, or deployment success does not establish full release acceptance or real-client launch approval.
