# Independent checker evidence

Scope: local implementation only, synthetic fixtures only. No provider booking, email, account setup, provider API call, production data mutation, commit, or push.

## Source review

- `/onboarding` renders supported Calendly `initInlineWidget` script integration with direct external-page fallback, configuration errors, script errors, and timeout/retry states. Service-information inquiry form remains.
- `/workspace/onboarding` adds verified provider bookings separately from legacy inquiries and agreement evidence/access workflows.
- Browser messages require exact Calendly origin and the mounted iframe's contentWindow. `calendly.event_scheduled` changes explanatory display text only and makes no persistence/API mutation.
- Webhook handler authenticates timestamp plus exact raw bytes, uses timing-safe digest comparison, rejects stale/future signatures, validates resource URI/event type, and writes distinct provider booking/delivery tables.

## Finding fixed during review

P1: `packages/onboarding/src/calendly.ts` advisory-lock query originally returned PostgreSQL `void` via Prisma `$queryRaw`, causing every valid webhook transaction to fail with `Failed to deserialize column of type void`. Backend builder replaced it with `SELECT 1 AS locked FROM pg_advisory_xact_lock(...)`. A real PostgreSQL rerun passed that statement and reached the scheduling table query, confirming this particular failure is corrected.

## Acceptance tests

`tests/acceptance/calendly-checker.test.ts` independently exercises exact raw-body signatures, multiple v1 rotation values, stale/future/malformed timestamps, unsafe event URLs, signed event-type scope rejection, duplicate persistence, untouched existing inquiry, cancellation terminality, reschedules in both arrival orders, API role boundaries, and assistant record projection role boundaries.

Latest run at initial review: signature and configuration tests passed; persistence checks could reach local PostgreSQL but awaited root's schema deployment (missing SchedulingBooking/SchedulingDelivery and Inquiry.requestId). These were environment readiness failures, not asserted successful persistence. Final results will be appended after migration.

## Final independent database and HTTP run

Command: `node --env-file=.env.test --import tsx tests/acceptance/run-suite.ts tests/acceptance/calendly-checker.test.ts`

Result: **9/9 passed**. The runner created an isolated localhost PostgreSQL database, applied all 10 migrations, ran the tests, and dropped the database. Earlier undeployed-base failures are superseded by this successful isolated run.

Verified in real PostgreSQL: signed booking persistence, single durable delivery for identical replay, preserved inquiry values/revision, signed wrong-event-type rejection without booking, terminal cancellation, linked reschedules in both delivery orders. Verified HTTP/router boundaries: anonymous 401, agent/client 403, coordinator 200 for booking list/detail; whitespace-altered raw body 401 versus correctly signed exact bytes 200; browser-shaped POST to booking collection 404 with no new record. Assistant record projection likewise allows coordinator and rejects agent/client. This tests the projection and router authorization; full authenticated MCP transport is root-owned.

Root API diff review: `/api/webhooks/calendly` uses `express.raw` before global JSON parser/session middleware. Scheduling records are added to existing generic MCP records registry under coordinator enforcement. No new mutations or browser-confirmation route were introduced.

Browser runtime verification is root-owned and separate from this independent source/HTTP/database report.

## Follow-up: authenticated MCP and agreement guidance

Expanded isolated checker: **10/10 passed**, using `PG_TOOLS_CONTAINER=weatherly-local-db node --env-file=.env.test --import tsx tests/acceptance/run-suite.ts tests/acceptance/calendly-checker.test.ts`. Full synthetic MCP transport coverage now supersedes the earlier projection-only limitation: a persisted MFA coordinator, approved synthetic client/manifest and scoped bearer grant successfully call `tools/call` → `query_records` → `scheduling_bookings`, returning the PostgreSQL booking. Revoking that same grant yields HTTP 401 `INVALID_TOKEN` and no booking disclosure. Fixture rows are removed and MCP environment variables restored; no preview configuration is changed.

Independently reviewed `docs/runbooks/calendly.md` and the expandable agreement guidance in `CalendlyBookings.tsx` against current primary documentation. No misleading activation/completion claim or unsupported promise found. Account activation, real agreement destination, actual sending and signature capture remain explicitly pending/separate. Relevant checks:

- [Basic notifications](https://calendly.com/help/how-to-set-up-basic-notifications): current article explicitly permits message customization on Standard or higher.
- [Scheduling notifications](https://calendly.com/help/calendly-scheduling-notifications): email confirmations allow hyperlinks; calendar invitations use full URLs and have different update behavior.
- [Automation customization](https://calendly.com/help/how-to-customize-emails-and-texts-for-automations): supports external hyperlinks and lists eligible plans.
- [Webhooks](https://calendly.com/help/webhooks-overview): listed webhook plans match the runbook, with entitlement verification left to Ireland's actual account.
- [Webhook signatures](https://developer.calendly.com/api-docs/overview/webhooks/webhook-signatures): PAT optional custom signing key, OAuth assigned key, exact timestamp/body signing and three-minute example align with implementation.
- [Reschedule payloads](https://developer.calendly.com/docs/api-guides/see-how-webhook-payloads-change-when-invitees-reschedule-events): paired created/canceled events and invitee-level old/new references align with reconciliation.
- [Attachment guidance](https://community.calendly.com/how-do-i-40/attaching-pdf-file-to-confirmation-email-620): Calendly staff's January 2024 limitation is accurately identified as older guidance, with live account confirmation required before any promise. No attachment or e-signature implementation is claimed.

No remaining confirmed findings from independent source, HTTP, database, MCP, or documentation review. Browser runtime remains separately reported by root.

Final source follow-up: widget initialization now catches synchronous provider-script exceptions, clears its load timer and exposes the existing error/retry UI. Mobile CSS gives the widget a centered viewport-width breakout while preserving iframe min-width override. These changes introduce no persistence path. Actual configured provider iframe rendering remains unverified because no approved Ireland URL is available.

Root separately reported actual browser checks at 390px: document content width equals viewport, no manual meeting-time field, API outage produces configuration-error/retry, and Enter activates Retry. These are root-reported runtime checks, not independent checker browser observations. No live provider frame, booking, email, subscription or account activation was exercised.

Final follow-up TypeScript check passed with the authenticated MCP test included.
