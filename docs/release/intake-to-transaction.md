# Weatherly intake-to-transaction release record

Independent integrated acceptance passed for local candidate `8325b5f0e157f919fe9795279f7cdc62a3f34f3b` on `codex/intake-to-transaction`. All 16 chunks passed independent review. The [R15 review](../reviews/intake-to-transaction/C15/review.md), [implementation checkpoint](../handovers/intake-to-transaction/CHECKPOINT.md), and [Ireland laptop handoff](../runbooks/intake-to-transaction-ireland-laptop.md) record the evidence and account verification steps.

## Verified local milestones

- The full suite passed 456 tests across 69 files. TypeScript and the Webpack production build passed. The three trailing blank lines found during the branch-wide diff check were removed. The final diff check, typecheck, and all 49 focused intake tests passed afterward.
- A fresh PostgreSQL database applied all 20 migrations. An independent populated rehearsal applied migrations 19 and 20 to data at migration 18 and verified retained records across eight tables, audience flags, and migration replay. A custom-format backup restored into a second isolated database with matching rows and migration history.
- Real-cookie HTTP checks covered canonical intake confirmation and replay, older pending and processed receipt compatibility, scoped routes, HTO reassignment, termination, reopen, and deletion. The concurrent same-revision test allowed one write and rejected the competing action with a revision conflict.
- Real desktop and mobile Chrome covered coordinator tabs, agent and client views, and cookie-free bearer publication and withdrawal after close-out. Independent review also verified workspace history across a session change and the absence of stale private data.
- The local worker drained both older intake notification job formats with outbound delivery disabled. The email placeholder setup inserted seven rows on its first synthetic run and zero on replay.

## Ireland’s handoff

The November 14 review has addressed all nine workflow decisions and configured several of Ireland’s own provider accounts. The [current progress record](../handovers/intake-to-transaction/IRELAND_PROGRESS_2026-11-14.md) is authoritative for setup, deployment receipts, deferred items and remaining acceptance. Contract-derived date defaults and FUB completeness still require code corrections. Templates/compliance, dual Gmail routing, the agreement link and Dotloop are deferred; current portal wording is provisionally retained. Full hosted acceptance and real-client launch approval remain incomplete.

## November 14 laptop artwork update

Ireland supplied and approved the 1200 × 630 `og-1-cream.png`. Its unchanged bytes are stored at `apps/web/public/brand/og-1-cream.png` (SHA-256 `29059c514e151c594116bc8f8e517ffbf12d84ce5983db25ffbfed002f1866d7`). Open Graph and Twitter metadata reference the static image, and the old `/opengraph-image` endpoint redirects to it.

Targeted module execution verified image URLs for all seven public pages, dimensions, the absence of image URLs without a configured public origin, and the existing endpoint's redirect. Source and destination hashes match; `git diff --check` passed. A full application build was not run. This records a local source change, not a deployed preview update.


## November 14 feature and hosted-configuration update

This source update includes [custom email merge fields](custom-email-merge-fields.md), the supplied artwork, and consolidated handoff documentation. Apply the new additive migration `20261114010000_custom_email_merge_fields` before the updated API starts. Verify browser behavior and social previews after the new source deployment; the baseline’s 20 applied migrations do not include this 21st migration.

Before publishing, repository TypeScript and diff checks pass. The standard focused Vitest command remains blocked at startup by the local missing Rolldown binding; prior targeted module checks are documented separately. No new full-suite or full production-build pass is claimed.

The last verified hosted configuration deployments before publishing this source are API `5171d082-99d8-4362-9df2-09fb3b13acc9` and worker `adaa873e-7fce-4a83-97f1-780eb7978419`, both SUCCESS. Both confirmed the verified Ireland recipient and weekday 08:00 America/New_York digest readiness. A content-free Resend provider test was delivered; the first actual scheduled digest remains unverified. OpenRouter processing is explicitly authorized/configured; fresh inference acceptance remains pending. Stripe real-account configuration is installed with live-money gates closed. Calendly’s approved URL responds; signed synchronization is inactive. Private storage has only configuration/source inspection, not lifecycle/recovery acceptance.

A push to the existing Railway source branch may start builds automatically. Capture the resulting source commit, migration and application acceptance separately; deployment alone is not a real-client launch decision.

## Launch follow-up

- The social image uses an explicit TypeScript import that Node can resolve when loading Next.js configuration. Custom-field refills work after other edits to a saved draft. The refill replaces message wording and leaves pending recipients and attachments in the editor for review and saving.
- New creation reviews leave unsupported Remedies and Title Commitment dates unresolved. Follow Up Boss exports require the full saved client name and phone. The review identifies incomplete clients before download and offers prior details for manual confirmation only when the same email identifies a single client on both versions of the row.
- In isolated PostgreSQL, all 21 migrations applied and the full suite passed 463 tests across 70 files, including encrypted snapshot and isolated restore checks. TypeScript, the default Turbopack production build, HTTP contract smoke and deployment safeguards passed. Real Chrome verified coordinator, agent and client journeys, document share withdrawal, custom-field refill and save, the incomplete-client repair and CSV download, and the exact social artwork served via the redirect.
