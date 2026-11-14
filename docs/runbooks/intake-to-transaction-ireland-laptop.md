# Ireland’s Weatherly handoff

Use Ireland’s laptop and her own provider accounts for account configuration and provider acceptance. The [local release record](../release/intake-to-transaction.md) tracks the reviewed application commit and the local checks. The [environment map](environment.md) lists where deployment settings belong. Put secrets in the approved environment’s secret store.

## Sync the repository

Open the existing `IrelandThing` checkout on Ireland’s laptop and run `git status --short --branch`. If it shows local changes, preserve them before switching branches. Then run:

```sh
git switch main
git pull --ff-only origin main
git log -1 --oneline
```

If there is no existing checkout, run `git clone https://github.com/xyudifjvs/IrelandThing.git` and open the `IrelandThing` folder. For local app setup, follow [Run locally](../../README.md#run-locally). Use the release and recovery runbooks below for any hosted database or deployment changes.

## Decisions and content

Review the [decision register](../handovers/intake-to-transaction/C00/contracts.md#decisions-for-ireland-to-confirm) and record a decision for each pending entry. Confirm the signed-contract precedence for Remedies and Title Commitment, **Only this date** pinning, HTO terminal corrections and recorded actual dates, dormant HTO rows, confirmed Follow Up Boss fields, the legacy document publication switch, business and package changes, and the weekday digest cutoff and wording.

Supply the final buyer and seller email wording, client portal wording, compliance item list, and `og-1-cream.png`. The Compliance tab starts empty. To add starter email placeholders to an existing database, run `npm run db:seed-email-templates` against the approved environment after the database migrations. Edit the placeholders in Settings and preview the approved wording and recipients before using them.

## Provider checks

Use a controlled test recipient and synthetic transactions. Record the environment, date, feature checked, and provider receipt or redacted evidence. Keep contracts, tokens, keys, personal information, and email bodies out of test logs.

| Provider | Setup on Ireland’s laptop | Verify |
| --- | --- | --- |
| OpenRouter | Set `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and `OPENROUTER_APPROVED_PROVIDERS`. Verify account privacy and the approved zero-data-retention routes before setting `OPENROUTER_ZDR_APPROVED` and `OPENROUTER_ACCOUNT_PRIVACY_VERIFIED`. | Use a synthetic contract with and without explicit signed terms. Confirm the route and source evidence, then test the unavailable route. Creation should still permit manual dates. |
| Gmail | Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_MAILBOX`, and `GMAIL_REDIRECT_URI` with the approved HTTPS origin and `/api/v1/communications/callback`. Configure the approved watch topic if used. Connect the actual Weatherly mailbox through Settings. | Use the controlled inbox to verify sync, reply threading, private attachments, explicit send approval, stale-recipient handling, and recovery of a delivery with an uncertain outcome. Enable outbound delivery for the controlled send after reviewing its recipients and contents. |
| Stripe | Use Ireland’s test credentials and signing secret with `STRIPE_MODE=test`. Configure the signed callback at the approved HTTPS origin plus `/api/webhooks/stripe`. | Verify the Weatherly service fee, HTO gift-only behavior, termination cancellation, webhook replay, refunds, and reconciliation of uncertain Checkout creation. Review the [payment gates](providers.md) before any live-money approval. |
| System mail | Set the approved `RESEND_API_KEY` and `SYSTEM_EMAIL_FROM`. Set `REMINDER_RECIPIENT_USER_ID` to Ireland’s verified coordinator account before enabling `PRIVATE_REMINDERS_ENABLED`. | Verify invitation, resend, password reset, and the intake-only digest using the controlled inbox. Check that duplicate jobs do not produce additional deliveries and that a processed intake still appears in its digest window. |
| Calendly | Follow the [Calendly runbook](calendly.md) for Ireland’s event URL, approved event type, signing key, optional fallback token and the signed `/api/webhooks/calendly` callback. | Verify one authorized test event and its cancellation. Check the native agreement-link email and confirm that accepting an agreement still requires signed evidence. |
| Dotloop and private storage | Confirm Ireland’s approved Dotloop account, redirect and access scopes if enabled. Set the private storage credentials and backend references from the [environment map](environment.md). | Use an authorized synthetic document to check access, share withdrawal, download, deletion cleanup and recovery. |

Review the [provider recovery checks](providers.md), [deployment runbook](deployment.md), and [backup and recovery runbook](recovery.md) before the separate release authorization. Hosted acceptance covers the web, API and worker individually, followed by the verified provider journeys.
