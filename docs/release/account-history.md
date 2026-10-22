# Agent account history

The `/account` page combines retained transaction history, saved payment requests, profile editing and account security. The local preview is `http://127.0.0.1:3000/account`. This is a local implementation; this task does not deploy to Railway or activate a provider account.

## Original design references

- `Weatherly Transaction Co. Website Design.html`, embedded **Agent Portal** page (`aa14f7a2-f2cc-4518-ab98-aeb19fb71c55`): the “Preview: after logging in” strip with **My Submissions** and **Payment**, warm cream backgrounds, white bordered panels, serif headings and wrapping navigation. Its Venmo QR code is a placeholder, not a configured payment integration.
- `Weatherly Transaction Co. Platform (v2) – Your workspace (v2).html`: the dashboard's **Active transactions** rows, listing-stage counts, compact status indicators and private coordinator boundaries. The new history extends those rows across every retained stage rather than inheriting the mockup's active-only scope.
- `New Transaction Intake.html`, **Review & submit**: confirms that gift payment precedes ordering. The existing approved service catalog remains USD 375 / 475 / 625; this change does not introduce automatic fee timing or a new gift catalog.

The website mockup contains nested bundled HTML. Inspecting its outer source alone misses the Agent Portal design. The original files remain unchanged.

## Authenticated data access

The following routes use the existing session middleware and billing router. Agents see matters assigned to them or explicitly shared through active participation; clients are denied these history APIs. Coordinators retain their existing wider access. Responses allowlist history fields and exclude internal matter details, coordinator notes, raw payment snapshots, provider identifiers and refund-operation details.

- `GET /api/v1/billing/account/transactions`: `q`, `stage`, `side`, `cursor`, `limit` (1–100, default 20). All stages are included by default: `listing`, `under_contract`, `closing`, `closed`, `terminated`, `archived`.
- `GET /api/v1/billing/account/payments`: `q`, `status`, `environment`, `cursor`, `limit`. Environments are `all`, `test`, `live`, `unknown`; no payment history is hidden merely because its provider is unconfigured.
- `POST /api/v1/billing/account/payments/:id/checkout`: resume an already issued pending checkout. It cannot create an order or choose a price. The original environment, provider response, amount, currency, session metadata, safe Stripe URL and current matter permission must match. A completed checkout response does not change the saved status.

Collections return `{items, nextCursor, total, summary}`; payments also return `provider`. Follow `nextCursor` until null for the entire retained collection. Stable creation-time/ID ordering avoids the former first-page ceiling. `total` describes filtered matches; `summary` describes all authorized records, independently of current filters. Reads use a repeatable-read PostgreSQL transaction. Cursor anchors must remain authorized.

MCP exposes read-only `list_account_transactions` and `list_account_payments`, with the same query schemas and service functions. The existing admission manifest, consent, coordinator-only grants, expiry, revocation and audit gates remain in place. Adding tools does not enable external MCP or grant agents new external access.

## Financial meaning and provider limits

`PaymentOrder` is the persisted source of truth. New orders save `details.paymentEnvironment` before contacting Stripe; verified payment events preserve that provenance and reject known environment mismatches. Older records without evidence stay explicitly **unknown** until reconciled. Refund/reconciliation paths enforce the saved environment. Financial summaries stay separate by environment and currency and distinguish paid balances, pending requests, confirmed refunds, disputes and unresolved refund reservations. A partial refund without a reliable saved amount is disclosed as unknown rather than included in a precise net-paid total.

The product currently has no separate saved invoice or receipt model. The account shows actual payment requests and supported checkout actions; it does not fabricate invoice numbers, receipt URLs or settled payments. There are no automatic charges, notifications or provider account connections in this change. Ireland's own Stripe configuration remains required for checkout. Carson's account must not be used.

## Verification

Builder tests: `packages/billing/test/account.test.ts`. Independent acceptance and permission/MCP checks: `tests/acceptance/account-history.test.ts`. Independent findings and final results are recorded in `docs/reviews/implementation/account-history-independent.md`.

Parent browser acceptance used the actual authenticated preview on desktop and at 390×844. It verified next/previous pagination (27 retained synthetic rows, 20 then 7), archived filtering, no-match guidance, payment status/environment filtering, archived detail navigation, payment rows and unavailable actions, unchanged profile saving, signed-out recovery and client settings without history/billing. Mobile document width equaled the 390-pixel viewport. Reference panels were also rendered at desktop and mobile widths. Temporary browser fixtures were explicitly labeled synthetic, contained only nonsettled requests, and were removed after verification.

The clean reviewed product commit **`61a2590`** passes **162/162 tests across 22 files**, TypeScript checking and the production Next build (32 outputs). Validation used its own installed lockfile dependencies and a newly created PostgreSQL database with all ten committed migrations; the isolated runner removed that database afterward. All nine existing HTTP acceptance groups and deployment safeguards also pass on that snapshot, including real cookie sign-in, role isolation, intake idempotency, deadline corrections and provider-disabled gates. No external provider calls were made.

The broader shared-checkout TypeScript check and production build also pass. Its integrated test run passes 207/208 tests; the sole failure belongs to concurrent uncommitted document-upload work (`packages/documents/test/batch.test.ts`, filename-boundary preservation), which is excluded from this task's commit. That shared failure does not occur in the clean reviewed account snapshot. Synthetic tests cannot establish live Stripe readiness.

GitHub synchronization continues on `build/B00-foundation` and the existing draft PR #1. This change adds no migration and does not deploy or alter the hosted Railway services, DNS, provider accounts or live-charge approvals.
