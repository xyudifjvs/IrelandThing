# Ireland’s Weatherly handoff

## November 17, 2026: merge-field cleanup deployed

Ireland’s new merge-field uploads and final corrections are live at https://www.weatherlytc.com. API, worker and web serve release `32a89577836a3284bc27d717c24338537e73ff69`; all four migrations applied, every service is healthy and no staged work remains. Full field list, source decisions, tests, actual deployment IDs and verification limits: [merge-field release record](../merge-fields-2026-11-17.md).

Possession terms now use the Possession checklist wording/rule/date. Buyer-agent commission has an autosaving Commission box on each transaction and supplies `{{buyer_agent_commission}}`; Title introductions with one literal 3% are migrated to the field. The repair-completion deadline field was removed. Greetings use the first word of full names, wiring instructions are shared per brokerage, and typed custom keys have no automatic prefix. Settings source bindings, transaction Details, editable checklist amounts/date wording, filled email previews, recipient chips and Save for later/reminders are deployed.

The release passed 467 tests across 71 files, TypeScript and a production build. Six backup/recovery tests were excluded because local pg_dump/pg_restore are unavailable. Public health returned 200; unauthenticated private endpoints returned 401; the served accent is black. Hosted coordinator edits and real email deliveries were not exercised. Existing provider configuration and the API migration pre-deploy safeguard remain intact. The older November 14 provider/progress record below remains useful context, rather than the current source/deployment receipt.

## Earlier handoff context

Current review: **November 14, 2026**. Start with the [dated progress and next-work record](../handovers/intake-to-transaction/IRELAND_PROGRESS_2026-11-14.md). It records Ireland’s decisions, actual provider configuration, deployment receipts, deferred items and unfinished acceptance. It supersedes earlier all-providers-pending descriptions. Keep secrets in Railway/provider secret stores.

## Repository and source update

The primary checkout was synchronized to GitHub main `20d806d02485daae570322b4a7a4c5994936f2aa` after backing up local changes. The secondary linked checkout remains at that baseline in detached HEAD state. This update adds custom email merge fields and Ireland’s replacement social artwork; source deployment, the new migration and browser acceptance must be checked after publishing it.

Before future synchronization, preserve local changes and use a fast-forward pull:

```sh
git status --short --branch
git switch main
git pull --ff-only origin main
git log -1 --oneline
```

Follow [Run locally](../../README.md#run-locally), the [environment map](environment.md), [release record](../release/intake-to-transaction.md), and [recovery runbook](recovery.md). The old full-suite results belong to the original candidate; they do not certify new changes.

## Decisions and content

All nine workflow decisions were addressed with Ireland. Signed-contract dates are proposed for review; linked dates use **Update all** based on uploaded-contract rules; HTO corrections preserve lifecycle/actual dates; dormant HTO rows are reused; older document publication requires explicit sharing; older drafts require fresh recipient review/save/approval; private summaries use weekday 8 a.m. Eastern cutoffs.

The release candidate removes unsupported Remedies and Title Commitment assumptions from new creation reviews and requires saved client names and phones before Follow Up Boss downloads. Verify these corrections with synthetic transactions during hosted acceptance. See the [original correction scope](../handovers/intake-to-transaction/IRELAND_PROGRESS_2026-11-14.md#required-corrections-not-yet-implemented).

Ireland will add her buyer/seller templates and compliance items later. Keep current client-portal wording for now, with future copy changes expected. Do not invent substitute templates or compliance tasks. Service-agreement/signing link and Calendly confirmation wording, dual Gmail routing, and Dotloop are explicitly deferred.

Custom merge-field creation is implemented at the bottom of email-template settings. See [migration and validation](../release/custom-email-merge-fields.md). Ireland’s selected 1200 × 630 `og-1-cream.png` is stored unchanged in `apps/web/public/brand/og-1-cream.png`; social metadata and the older image route use it. Verify both features on the newly deployed source.

## Current provider status

Use the existing **Weatherly** Railway project, environment named **staging**, serving **https://www.weatherlytc.com**, and Ireland’s real provider accounts. The environment name is not permission to substitute provider sandboxes. Exact resource/deployment identifiers and evidence are in the dated progress record.

| Area | Current state | Remaining acceptance |
| --- | --- | --- |
| OpenRouter | Enabled with Ireland’s explicit contract-data processing approval. API owns the key; worker references API. Claude Sonnet 4.6, only Amazon Bedrock US; strict ZDR-only account settings, training/sharing/logging off, privacy flags enabled. | Fresh synthetic extraction/key-validity and route-failure checks. |
| Gmail | Disabled; two-account implementation deferred. HTO sender `office@hometeamohio.com`; Weatherly sender `ireland@weatherlytc.com`. | Separate OAuth connections and business/mailbox-specific draft approval, sends, sync, replies and recovery. |
| Stripe | Ireland’s real account, live webhook and live-mode configuration installed. Worker owns the key; API references worker. Live-money approval remains false and staging release gates remain closed. | Key/account match and billing/webhook/refund/reconciliation acceptance; separate real-money launch approval. No charges/refunds performed. |
| Resend/system mail | Three DNS records verified; approved provider setup test delivered. API/worker sender, verified Ireland coordinator recipient and weekday 08:00 America/New_York summaries enabled; both final deployments succeeded and readiness reports scheduled. Worker references API’s domain-restricted sending key. Gmail remains disabled. | First scheduled digest (Nov 16 at 8 a.m. Eastern), digest wording, invitation/resend/reset and duplicate-job acceptance. Scheduled is not delivered. |
| Calendly | Approved 30-minute booking link configured: https://calendly.com/ireland-weatherlytc/30min. Public scheduling endpoint verified configured=true, syncConfigured=false. | Signed booking/cancel subscription and acceptance. Agreement link/email changes deferred; booking never establishes signature evidence. |
| Dotloop | Explicitly deferred. | Revisit account/API permissions and import checks later. |
| Private storage | Existing Railway documents bucket and API/worker storage variable names inspected; credentials are redacted by the connector. Source requires production S3 and authorizes/checksums downloads. | Verify actual references, synthetic upload/download, audience access, share withdrawal, deletion cleanup, backups and isolated recovery. |

## Continue the handoff

1. Verify the newly published source, custom-field migration and browser behavior, and hosted social previews.
2. Verify the corrected contract-rule and Follow Up Boss flows using a signed-term fixture, a fixture with missing terms, and an export with an incomplete client.
3. Finish private-storage acceptance and encrypted backup/isolated restore planning and rehearsal, including independent key storage, cadence, retention and monitoring.
4. Complete provider/runtime acceptance and coordinator/agent/client journeys. Never infer delivery, payment success, storage recovery or launch approval from configuration/deployment success.
5. Resume deferred items when Ireland asks. Final real-client launch remains a separate explicit decision.

See [provider operations](providers.md), [Calendly](calendly.md), [deployment](deployment.md), and [backup/recovery](recovery.md). Use controlled recipients and synthetic records for acceptance; keep document bodies, tokens and credentials out of logs.
