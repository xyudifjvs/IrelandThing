# Ireland’s Weatherly handoff

## November 21, 2026: archived roster recovery

A saved, archived roster entry still reserves its normalized email, but the previous UI hid archived entries and offered no restore path. The coordinator roster now has a separate **Archived agents** section with explicit **Restore** controls, and name/email/brokerage search covers both active and archived entries. The duplicate-email error distinguishes an archived record and directs Ireland to restore it. Active duplicate protection remains in place.

Coordinator-only `GET /api/v1/onboarding/roster/archived` returns a minimal contact list. Revision-checked `POST /api/v1/onboarding/roster/:id/restore` clears only the archive flag, increments the revision, and audits the restoration. It preserves the original identity, contact data, business and history. Restoring does not create or link an account, change roles, assign files, create an invitation, approve an agreement, or queue email. Archived records remain absent from ordinary assignment pickers. No schema migration or provider-setting change is required.

Validation: **474 tests passed across 72 files**, root TypeScript passed, and the production web build passed. The existing six backup/recovery tests remain excluded because local pg_dump/pg_restore are unavailable. New regression cases cover preserved history, normalized-email duplicates before/after restore, stale revisions, coordinator-only access, and no invitation/account creation. A synthetic local browser check confirmed email search, explicit restoration, and opening the original record. Archive recovery is live on API/web source `700c11d78e2a6b3e022063dda93f0b4f3ed8c653`, branch `codex/roster-restore-700c11d`. API deployment `e1ba5642-e801-428d-9ac0-1ff53517dd2c` and web deployment `52333678-d28f-46c0-9edd-231c93982729` succeeded. The existing API pre-deploy migration safeguard reported 26 migrations with none pending. All services were healthy with no staged work; health returned 200 and an unauthenticated archived-roster request returned 401. Ireland's original archived contact was located and explicitly restored through the live UI, preserving its original inquiry history; the restored record showed no agent invitation, approved agreement, or assigned files. At this archive-recovery step, no test invitation was sent. The worker remains on `2a012c7` because this update only changes the API and web.

Ireland also confirmed that the roster must retain interested, signing-up, and active agents. Active records already remain visible; they move from Signing up into the ongoing Weatherly group. The misleading subtitle is replaced with “Track interested agents, sign-up progress, and active agents in one place,” the group is renamed “Weatherly agents,” and rows show their status. Inquiry-only Archive/Restore and retained active-agent history remain the current behavior. There is no permanent-delete control for agent records.

Ireland explicitly approved a **Personal test invitation** option after the original record was recovered. The coordinator must confirm that the recipient is their own email. It is available only for an unassigned Weatherly roster record with no existing account or approved agreement, cannot target a client role or a transaction-specific invitation, and uses the existing queued invitation email. A server-authored, audited personal-test exception supports signup; no signed agreement is created or approved. Registration rechecks that no transactions have been assigned since the invitation was issued, and rolls back acceptance/account creation if that check fails. The roster/profile retains a Personal test label; once accepted, it is an ordinary agent account starting with no assigned transactions, not an isolated sandbox. Resends preserve the test decision and expire the prior invitation. The coordinator account and normal agents' agreement requirements remain unchanged.

The personal-test/wording follow-up passed **476 tests across 72 files**, TypeScript and the production web build. Two added cases cover required confirmation, pending/active test labels, resend continuity, expired old links, no fake agreements or assigned files, acceptance-time assignment drift, unchanged coordinator roles, and denial of client/noncoordinator/scoped-invitation misuse. Production rate limits remain unchanged; test router instances isolate their rate-limit stores. The follow-up is live on API/web release `286f794a518db25b7e28689be59ed5bba8a3a71a`, tree `7a52bd825797b39a6d67991c79eccfa43bf613f3`, branch `codex/personal-invite-286f794`. API deployment `b4a399ea-e0b0-4b38-bf4d-17565ba62019` and web deployment `6c937662-96fc-4ecc-a444-2f1e3274ab6d` succeeded. All four services were online with one running replica, no issues or pending work. The migration safeguard is unchanged; 26 migrations, none pending. Worker code remains `2a012c7` because the standard invitation handler and message format are unchanged.

Hosted acceptance: the updated ongoing-roster subtitle, Weatherly agents heading, own-email confirmation and personal-test controls were verified in Ireland's coordinator session. One authorized invitation was submitted through that control, using the restored original contact. The app reported queued and marked the entry Personal test / Invited; it still showed no agreement and no files. Resend confirmed **delivered** for subject “Your Weatherly agent portal invitation” on November 21 at 19:37:36 UTC (14:37:36 Eastern), email ID `01a1ff9d-3792-711d-b876-93ef5157697e`. No duplicate/resend was submitted. Existing active agents also remained visible under Weatherly agents with Active labels. The coordinator session remains intact. Ireland must open the delivered link and choose her own test password; no password was set and no test account was accepted on her behalf. A private browser window keeps her test login separate. Invitation links, tokens, personal email addresses and passwords are excluded from this record.

## November 17, 2026: checklist dates and Remedies follow-up

Ireland requested real dates plus optional display text during creation with or without an intake, shared with both agents and clients. She also requested three separate checkboxes: Home Inspections, Remedies, and Remedies Negotiated. This follow-up is live at https://www.weatherlytc.com on API, worker and web release `2a012c717121b611c95000e3ec025ed17f240a46`. The Remedies migration succeeded, all services are healthy, no staged work remains, and the served web bundles contain the new controls and wording. Implementation, migration, validation and deployment IDs are in the [checklist follow-up record](../checklist-dates-2026-11-17.md). Display text stays separate from reminders, date calculations and completion status. The previous merge-field release below remains useful provider and feature history. Hosted account edits and real outgoing emails were not exercised by this follow-up.

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
