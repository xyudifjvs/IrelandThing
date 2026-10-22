# Independent account history review

Reviewed October 21, 2026 (America/New_York) against the shared local implementation. The checking team changed only `tests/acceptance/account-history.test.ts` and this review. No provider account, live payment, notification, deployment, preview fixture, commit or push was created by the checking team.

## Result

**Pass for the reviewed local account history scope.** The independent acceptance suite passes **16/16 tests** with actual PostgreSQL persistence in the disposable local database selected by `.env.test`. The test configuration refuses a non-local database or a name without the `_test` suffix. Synthetic fixtures have unique per-run prefixes and are deleted after the suite. TypeScript checking passed during this review.

Command: `npm test -- tests/acceptance/account-history.test.ts`.

Final independent run: 16 tests passed; duration 2.46 seconds. No live Stripe credentials or provider calls were used. Checkout retrieval uses an injected in-process provider only.

## Original reference evidence

- `Weatherly Transaction Co. Website Design.html`: decoded the packed `__bundler/template` and `__bundler/manifest`, including its nested **Agent Portal** HTML resource `aa14f7a2-f2cc-4518-ab98-aeb19fb71c55`. The portal explicitly has **My Submissions** and **Payment** navigation, cream panels, muted brown accents, Cormorant Garamond and Montserrat. Its payment example is a Venmo QR placeholder, with no persisted invoice/payment implementation. The new account sections appropriately use the established saved Stripe-order domain rather than publishing that placeholder.
- `Weatherly Transaction Co. Platform (v2) – Your workspace (v2).html`: decoded its packed `__bundler/template`. The platform reference establishes stage-based transaction summaries, property-centered records and explicit agent/client visibility boundaries. Its notes and coordinator to-do content are expressly private.

Decoded originals were inspected from temporary review files only; supplied HTML files remain intact. `New Transaction Intake.html` is a preserved intake source, not the account-history design used for this review.

## Independent coverage

The fixed fixture includes **212 authorized transactions** and **217 authorized payments**, exceeding the older 200-record API cap. It also includes inaccessible foreign/revoked matters and payments whose large amounts would expose accidental scope leakage in counts or totals.

- Complete transaction traversal returns every authorized row exactly once, ordered by creation time and ID, including tied timestamps. All six actual domain stages are represented: listing, under contract, closing, closed, terminated and archived. No active-only restriction is accepted.
- Case-insensitive address/title search, stage and side filtering apply to the complete history. Filtered totals are distinct from the unfiltered full-history summary. Invalid limits/stages/sides are rejected.
- Complete payment traversal returns all 217 rows exactly once. Payment filtering by status, search and environment retains the complete unfiltered summary.
- Foreign, missing and revoked cursor anchors fail closed. Revoking a participant removes both their transaction and payment access immediately and invalidates their previous cursor.
- The HTTP checks use the actual session middleware with only session retrieval substituted. Real persisted user roles, access-revocation audits and agreement/override eligibility still run. Unauthenticated requests, clients, revoked accounts and agents without required access eligibility are denied.
- Transaction/payment projections omit private intake details, coordinator notes/tasks, provider IDs, idempotency keys, full snapshots, internal refund reasons and arbitrary provider details. Foreign payments cannot alter agent totals.
- Net paid, pending, refunded and disputed amounts match the complete authorized fixture. Currency and payment environment are separate groups, including live CAD, test USD and legacy mode-unverified USD. A checkout-success/redirect-shaped detail does not change a pending record into a paid record.
- Missing, negative, excessive and string-valued legacy partial-refund amounts remain unknown and do not fabricate net paid/refund totals. Durable unresolved refund reservations remain distinct from recorded settlement. Failed/cancelled or already accounted refund intents do not inflate the unresolved-refund amount.
- Unconfigured billing preserves saved history and disables checkout. Resuming a request never creates an order or changes pending status. Wrong provider session/metadata, mode, amount, currency, closed checkout and unsafe URL fail. Payment completion or participant revocation during provider retrieval is rechecked before returning a link.
- Actual MCP `tools/call` requests successfully reach `list_account_transactions` and `list_account_payments` with the existing approved coordinator read-grant gate. Responses are paginated and sanitized. Invalid/revoked grants and disabled MCP fail. This task does not expand MCP access to agents.
- HTTP validation errors, empty results and sanitized database-failure responses are covered. React rendering of the actual view source verifies announced loading/error states, actionable retry, honest empty/provider-unconfigured states, semantic captions/column headers, permitted detail links, full-history counts, explicit currency/mode labels and client profile/security without billing/history requests.

The view harness compiles the actual TSX with TypeScript for Node because the Next app's nearest tsconfig intentionally preserves JSX. Real React renders the views; network responses and CSS class names are substituted. This is view-branch coverage, not a replacement for browser interaction or visual checks.

## Findings resolved during review

1. Unknown-refund explanatory copy initially mentioned only exclusion from refund totals. It now explains that related paid balances and unverified refund amounts are excluded from totals.
2. A stale/revoked pagination cursor initially offered only a retry of the same invalid cursor. Both history error panels now offer **Return to first page** when the cursor stack has advanced.

Independent source review confirms labeled native form controls, named search/pagination landmarks, table captions and scoped headers, visible keyboard-focus styling inherited from the application, loading/status/error announcements, responsive stacked settings and card-style mobile tables. Main controls have 44-pixel minimum heights; mobile inputs use 16-pixel text. Existing profile saving, authenticator setup and password recovery remain available.

## Boundaries

No remaining blocking finding was identified in the independently tested local scope. The parent team owns live desktop/mobile browser inspection, preview fixture cleanup, GitHub synchronization and the final release report. This independent review does not certify hosted deployment or real-provider operation.

Ireland's own approved Stripe configuration remains required before online payment actions can be used. The existing persistence model is `PaymentOrder`, not an invoice/receipt ledger; the account page must not claim receipt/invoice artifacts or settlement that the product has not retained. No new account, live-charge approval or connection to Carson's Stripe was performed.
