# Calendly scheduling release evidence

October 21, 2026. Ireland has not created a Calendly account yet (confirmed by the user). This is completed source and synthetic/local verification, with account activation and hosted rollout pending.

## Scope

Public `/onboarding` replaces the manual proposed-time form with an official Calendly embed, direct-link fallback and loading/error/unconfigured states. The information-inquiry form remains. Coordinator `/workspace/onboarding` adds a separate verified booking list and native Calendly agreement-email setup guidance; existing inquiry, signed-evidence and invitation workflows remain.

Separate additive `SchedulingBooking` and `SchedulingDelivery` tables preserve existing inquiry data. Signed server deliveries alone can create provider-verified records. Browser origin/source checks protect display hints, which have no business-record write path. API and MCP reads remain authenticated and coordinator-only. No meeting, email, paid subscription, provider account, DNS or hosted release was activated.

Builders and an independent checker used separate ownership in an isolated clone based on `717985e`. This release's commit excludes the concurrent checklist-share and batch-upload changes. Its scoped changes were also applied to the shared checkout without replacing their API/schema/agreement edits. Shared-checkout combined release validation remains the responsibility of the final integrated release; the test counts below describe this isolated Calendly candidate.

## Validation

- `PG_TOOLS_CONTAINER=weatherly-local-db node --env-file=.env.test --import tsx tests/acceptance/run-suite.ts`: **139/139 tests**, 20 files, fresh local PostgreSQL database, all ten candidate migrations applied, database dropped after execution. The local database container supplies `pg_dump`/`pg_restore`; an initial attempt without these binaries failed only in recovery tests and was rerun successfully with them.
- `npm run typecheck`: passed.
- `API_INTERNAL_URL=http://127.0.0.1:4300 npm run build`: passed; public and coordinator onboarding pages compiled. This is a build, not deployment.
- Independent checker: **10/10** adversarial HTTP/PostgreSQL/MCP checks. Exact raw-byte HMAC, altered-body rejection, stale/future signatures, multi-signature headers, scoped event-type rejection, duplicate idempotency, terminal cancellation, reschedules in both orders and unchanged legacy inquiry/revision. Anonymous/agent/client booking reads denied. Real synthetic scoped MCP `query_records` succeeded; revoking the persisted grant denied the next call. No actual external assistant client or live MCP admission was enabled.
- Checker found a Prisma inability to decode the advisory-lock function's `void` result. The corrected lock query returns an integer; all persistence/replay tests passed afterward. [Independent report](../reviews/calendly/independent-checker.md).
- Actual in-app browser: inspected the old public form, then verified the replacement on isolated `http://127.0.0.1:3300/onboarding` and integrated `http://127.0.0.1:3000/onboarding`. At 390px and 320px, document width equaled viewport width and the manual datetime field was absent. Reviewed the desktop layout. Stopping the isolated API produced the clear configuration-failure state; pressing Enter on Retry invoked the retry, and restoring the API returned the unavailable state. A local preview remains available at port 3000.
- Browser evidence is saved locally at `.local/calendly/onboarding-desktop.jpg`, `.local/calendly/mobile-unconfigured.jpg` and `.local/calendly/mobile-failure.jpg`. No real Calendly iframe/calendar, provider confirmation, webhook subscription, notification delivery or e-signature completion can be verified before Ireland supplies the account and actual event URL. Widget fallback/security branches received independent source review; configured provider-frame behavior remains an activation acceptance check.

## Activation and agreement delivery

Ireland must create her account, provide the actual public event URL, set availability/calendar and approve notification behavior. An eligible webhook plan plus account-scoped event type, signed subscription and matching server secret are needed for synchronized booking/cancellation/reschedule records. Blank provider configuration remains the correct state until then. No Carson account is used.

An approved agreement link can be included in Calendly's own confirmation email with Standard-or-higher customization; eligible paid plans also support a booking-triggered email Automation. Ireland still needs the final agreement/signing destination and account settings. Sending a link does not capture a signature, prove email delivery or approve access. Existing private signed-evidence capture remains required. Fully automatic signature completion/import would require a separately approved signing service and verified completion evidence.

Follow [the Calendly runbook](../runbooks/calendly.md) for official plan/security references, exact configuration, native email setup and rollback/reconciliation. Deploy the migration with the matching reviewed API/web release after Railway access/build availability is restored. The Squarespace DNS/TLS/origin cutover and all other provider/AI gates remain unchanged. Existing draft release PR #1 does not itself activate this feature; the isolated scheduling PR must be integrated into the selected release.
