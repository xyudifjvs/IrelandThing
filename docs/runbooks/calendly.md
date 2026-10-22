# Calendly scheduling and agreement delivery

Prepared October 21, 2026. Ireland has not created a Calendly account yet, as confirmed by the user. Implementation is local/reviewed source, not an activated Calendly connection or hosted deployment. Use Ireland's account only. No live booking, provider notification or subscription has been created as a test.

## Routes and durable records

- `/onboarding` is the public scheduling entry point. It embeds Ireland's approved event with Calendly's official JavaScript widget, with a direct booking link, bounded loading, retry and unavailable states. The service-information inquiry form remains.
- `/workspace/onboarding` remains the coordinator's inquiry, agreement-evidence and invitation workflow. Verified Calendly bookings are listed separately, with cancellation/reschedule state and time zones. Refresh the list to retrieve recent events; it is not a live subscription.
- Existing `Inquiry` rows and their manual statuses remain untouched. Booking a meeting never approves an agreement or grants portal access.
- `SchedulingBooking` is one record per provider invitee URI. `SchedulingDelivery` retains the verified provider fields, body digest, event type, source timestamp, receive timestamp and applied result. Exact-body SHA-256 deduplicates deliveries; a PostgreSQL transaction/advisory lock serializes updates across replicas. Canceled invitees cannot be restored by a delayed create. A reschedule creates a new invitee and retires the old record.
- `GET /api/v1/onboarding/scheduling` exposes only `{configured,eventUrl,syncConfigured}`. URL configuration and synchronization configuration are independent: the embed can work without webhook access. `syncConfigured` means required configuration is present, not that a subscription has been activated or a live delivery verified.
- `POST /api/webhooks/calendly` must receive the exact JSON bytes before Express JSON/session middleware. It checks HMAC-SHA256 of `timestamp.rawBody`, a constant-time signature comparison, a 180-second timestamp tolerance and the configured event-type URI. Unsupported, mismatched or unsigned events cannot become bookings. Browser `postMessage` events only change explanatory display text and never write records.
- Coordinator-only `GET /api/v1/onboarding/bookings` and `GET /api/v1/onboarding/bookings/:id` read PostgreSQL. Authenticated assistant API/MCP `query_records` supports `kind: "scheduling_bookings"`, with coordinator authorization and cursor pagination. Agents/clients cannot query these administrative records. Delivery payloads are not exposed through the assistant.

## Ireland account activation

1. Obtain Ireland's actual HTTPS event link, account/organization identity, event type URI and plan. Do not use a guessed link, Carson's account or a paid upgrade without authorization. Configure Ireland's availability, connected calendar, time zone, buffers and desired notifications in Calendly.
2. Set `CALENDLY_EVENT_URL` on the API to the approved `https://calendly.com/<owner>/<event>` URL. Only exact Calendly HTTPS event URLs without credentials, query strings or fragments are accepted. Leave blank until supplied. No web build-time secret is needed.
3. Verify webhook entitlement in the actual account. Calendly currently lists Professional, Standard, Standard Plus, Teams, Teams Plus and Enterprise for webhooks; a Free embed does not imply webhook access. A personal access token or OAuth app is required to create the subscription. Confirm organization/user scope and permissions, then retrieve the exact approved event type URI.
4. Through Ireland's approved account, create a subscription for both `invitee.created` and `invitee.canceled`, scoped narrowly to the intended user where possible. Set a unique strong signing key for a PAT subscription; OAuth applications use their assigned signing key. Set server-only `CALENDLY_EVENT_TYPE_URI` and `CALENDLY_WEBHOOK_SIGNING_KEY` to the matching values. Never commit/log these secrets. `CALENDLY_API_TOKEN` is an optional read-only fallback for older payloads lacking nested `scheduled_event`; restrict it to the account/event reads required. Fetches only use an exact `api.calendly.com/scheduled_events/<id>` resource and reject redirects.
5. Deploy the additive migration and matching API/web release before activation. Use the approved final HTTPS origin plus `/api/webhooks/calendly` as callback. DNS/TLS and origin cutover remain gated by [custom-domain.md](custom-domain.md); follow [railway-staging.md](../release/railway-staging.md) for deployment. Railway/account access must be restored separately. No localhost webhook or temporary public tunnel is an activated production integration.
6. Verify subscription status and signing configuration without creating a meeting. Live booking/cancel/reschedule notification testing needs explicit authorization for a controlled invitee. Until then, synthetic tests verify adapter behavior only. Historical meetings are not automatically delivered: use a separately reviewed read-only backfill/reconciliation if needed; do not infer that an empty list means no meetings exist.
7. Monitor rejected/failed webhooks and compare Calendly against stored records. A signing-key change or provider outage can stop updates; configured flags do not guarantee freshness. Disable the subscription or clear the signing key to stop intake; retain booking/delivery records and existing inquiry/agreement evidence. Reconcile uncertain deliveries instead of manually marking a browser notification confirmed.

## Send the agreement in Calendly's own email

The preferred account setup is an approved **agreement link in Calendly's booking confirmation email**. Standard or higher permits notification subject/body customization. In the intended event type, open Scheduling → More options → Notifications and automations → Email confirmation → Edit, and add Ireland's approved agreement/signing link and instructions. Confirm the notification type: Calendly email confirmations can contain hyperlinks; calendar invitations require the full URL. Do not switch invitation type without reviewing its different update behavior with Ireland.

If a separate message is preferred, eligible paid plans support an Automation/Workflow triggered by “New event is booked”, with “Send email to invitee” and an external hyperlink. Keep the sender as Calendly's `notifications@calendly.com` unless Ireland explicitly approves connecting her Gmail/Outlook. That avoids adding a new app mail integration for this feature. Team automations require the account's appropriate owner/admin permissions. Check reschedule/cancellation triggers to avoid repeatedly sending an agreement after every change.

Calendly's documented attachment guidance recommends linking to the PDF/document; arbitrary PDF attachments are not a supported Workflow mechanism. Its `.ics` calendar attachment is not the service agreement. The attachment guidance is older than the current notification articles, so confirm the actual account editor before promising a new attachment capability.

Prepared email copy (do not enable until the final agreement and actual URL are approved):

> Before we meet, please review the Weatherly service agreement using the agreement link below. Follow the instructions there to sign and return it. Ireland will review the signed agreement before arranging portal access.

Insert the approved agreement link using Calendly's editor; no placeholder link should be published. Do not put a private bucket URL, expiring coordinator download URL, invitation token or signed client document into a reusable public email template.

**Sending is not signing.** Calendly scheduling webhooks do not prove agreement email delivery, opening, acceptance or signature. This implementation never automatically marks `Agreement` sent/received/approved from a booking. The existing signed-evidence upload remains the available durable signature-recording path: retain recipient email, approved version, signed document in private storage and audit evidence before access. A reusable blank agreement link can remove manual sending, while the signed evidence still needs capture. Replacing manual evidence entry completely requires Ireland's approved signing destination/provider, verified signer/completion callbacks and an audited receipt/document import; that capability is not implemented or activated by Calendly alone. Email delivery evidence can be inspected in Calendly's timeline but is not synchronized into Weatherly by these booking webhooks.

## Official references checked

- [Embed options and supported plans](https://calendly.com/help/embed-options-overview)
- [Advanced embed, JavaScript events and iframe limitations](https://calendly.com/help/advanced-calendly-embed-for-developers)
- [Webhook plans and authentication](https://calendly.com/help/webhooks-overview)
- [Signature verification and timestamp tolerance](https://developer.calendly.com/api-docs/overview/webhooks/webhook-signatures)
- [Reschedule event pairs and invitee links](https://developer.calendly.com/docs/api-guides/see-how-webhook-payloads-change-when-invitees-reschedule-events)
- [Current webhook payload](https://developer.calendly.com/api-docs/calendly-api/webhooks/get-sample-webhook-data)
- [Notification customization and plan limits](https://calendly.com/help/how-to-set-up-basic-notifications)
- [Email confirmation versus calendar invitation](https://calendly.com/help/calendly-scheduling-notifications)
- [Automation plans and booking/reschedule/cancel triggers](https://calendly.com/help/automations-overview)
- [Insert an external agreement link](https://calendly.com/help/how-to-customize-emails-and-texts-for-automations)
- [Calendly Community staff attachment guidance, January 2024](https://community.calendly.com/how-do-i-40/attaching-pdf-file-to-confirmation-email-620)
