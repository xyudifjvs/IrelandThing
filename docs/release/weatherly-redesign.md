# Supplied Weatherly redesign

Implemented from Ireland’s five November 4 attachments on `codex/weatherly-reference-redesign`, starting from clean `86538bf`. This is a source release candidate, **not a deployed release**. No Railway source pin, live account, customer record or integration was changed.

## Implemented

- Public Process page and exact shared marketing header/footer, including supplied navigation, copy, embedded typography, email and phone. Other marketing bodies are preserved because replacement references were not supplied. FAQ remains reachable from Contact. Client-friendly checklist wording uses the existing restricted read-only checklist capability; no public matter endpoint was added.
- Four separate reference forms: buyer, seller, buyer compliance and seller compliance. The original section order, cards, fields, radio choices, repeatable people, relationship reveal, address, occupancy, co-op, title/lender, commission/EMD, HOA/source/date, MLS, seller utilities/prior policy and gift presentation are retained. Changing side/service switches to the appropriate full reference, retaining earlier answers/documents.
- Actual authenticated identity; saved drafts/resume; existing Full Listing and historical draft flow; existing client contact preference; private queued uploads with retry and durable association; exact revision conflicts; atomic, idempotent submission; saved receipt and transaction link.
- Full original answers and upload groups persist in `referenceIntake` in saved matter details and immutable submission snapshots. Exhaustive review and authorized agent/coordinator detail display include previously hidden values and contact phones omitted by the prototype summary. Client projections exclude this intake record; authorized assistant record access remains available.
- No account invitations, gifts ordered, charges, financial credit balances, real email or provider activation is triggered by these inputs. Authenticator enrollment remains optional; same-origin write protection and existing permissions remain enforced.

## Approved owner decisions and remaining inputs

- **Current catalog:** Contract to Close $425 and Contract to Close + Compliance $515, both buyer/seller. Existing internal codes essentials/complete are retained. Full Listing is Coming soon, with new intake, direct coordinator creation and payment requests blocked; historical records, paid orders and idempotent historical replays remain intact. Migration14 updates current catalog rows only. New matters/receipts save an immutable service snapshot.
- **Drafts and final completion:** drafts save at any point, including partially entered fields and unfinished upload queues. Final submission requires an executed contract upload or explicit location direction. Dotloop checkbox alone is insufficient. Full field-by-field completion rules and sufficient external-location detail remain under interview; only the confirmed minimum is enforced pending those answers. The earlier blank-final policy is superseded.
- **Approval:** extracted/calculated dates are proposals until Ireland confirms them. Proposed dates do not populate authoritative task dates, the portfolio calendar or agent/client timelines. Chained rules observe current approval state; changing an upstream date withdraws downstream authority until reapproval. Official email sending remains an explicit coordinator action.
- **Client experience:** existing revocable no-login links show live shared milestones, confirmed dates, current progress and explicit What we need from you tasks. Coordinator completion synchronizes the same task for agent and client. Existing explicit sharing is preserved; detailed sharing/link-issuance and client-response interactions remain undecided. No broadening of old/default private milestones or automatic invitations was added.
- **Gifts:** supplied photos/descriptions/prices/payment URL remain placeholders. Policy copy and acknowledgment persist, with no invented catalog, supplier, payment completion or credit/refund implementation. Ireland deferred further gift decisions.
- **Other page bodies:** no replacement About, Services, Onboarding, Agent Portal, FAQ, Contact or Testimonials reference was supplied. The shared shell is new; existing bodies retain their content except approved catalog/availability updates.
- **Provider gates:** Ireland-owned Gmail, Stripe, Dotloop, system mail, Calendly and verified OpenRouter privacy remain as documented. A Dotloop location is a coordination request, not a successful import. Requests do not send invitations or grant access.

The established private document pipeline continues to accept PDF/DOCX, 20 MB each. The source picker also lists legacy DOC and images; unsupported files receive conversion instructions, without pretending that image OCR or legacy Word conversion exists. No provider bypass was added.

## Verification

- All 14 migrations applied on a new disposable local PostgreSQL 17 database. The additive catalog migration changes current catalog rows only.
- Complete isolated regression: **245 tests in 36 files pass**. Real-session isolated API acceptance and deployment safeguards pass. TypeScript and production Next build pass.
- Production-browser evidence exercises all four forms, six steps, every conditional reveal, multiple clients/relationships and mobile widths. Real synthetic authenticated save/resume, network-failure upload retry, uploaded-only HOA/utilities documents, full field review, immutable/idempotent receipts, downloads, all four contract-minimum submissions and blank-final rejection, Full Listing coming-soon gates, anonymous/client denial and foreign-origin denial are covered.
- Independent review and fault injection cover association retries without duplicate bytes, invalid file removal, failed-result removal, submission races, communication settings, focus, invalid variant URLs and source provenance. Its mocked UI API checks are labeled separately from the real auth/storage tests.
- Process full-page comparison at 1280×1200 and 390×844 has zero differing pixels against the safely rendered original. Intake comparison evidence explicitly normalizes live identity, operational-strip height, live status overlays and the documented mobile overflow correction; it compares the source form areas and condition states. Whole-page captures retain operational differences. All 166 intake comparisons have identical dimensions and interior RGB values; two have a one-pixel outer top-row crop difference. Whole-application pixel identity is not claimed.

Reproduce against a local synthetic API and production web build:

```sh
WEATHERLY_COMPARE_ORIGIN=http://127.0.0.1:3314 node tools/design/compare-process.mjs
WEATHERLY_COMPARE_ORIGIN=http://127.0.0.1:3314 node tools/design/verify-intake.mjs
WEATHERLY_COMPARE_ORIGIN=http://127.0.0.1:3314 node tools/design/check-intake-recovery.mjs
```

The main browser verification expects the local synthetic seed accounts and generates its own synthetic PDF/DOCX fixtures. These are not real-client tests. Full provider readiness, business-policy approval and live deployment remain separate.
