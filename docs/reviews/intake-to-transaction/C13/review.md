# C13 independent portal review

Changes requested on `5b3a525088dad27db47b8cf0325374bd7a277844`. The exact C13 checkout stayed clean. The browser overlay used that C13 tree and the accepted C09 billing diff through `5f47156`, with a fresh 19-migration PostgreSQL database, local Better Auth cookies, private synthetic documents and Stripe test mode without provider credentials.

## Findings

### P2 · Upcoming payments can retain a withdrawn file indefinitely

At `apps/web/app/(account)/account/useFeeObligations.ts:13`, the new Account obligations list loads on mount or manual error retry. The account session revalidates independently, so a valid session on an agent reassigned away from one file leaves that file's previously returned address and amount visible in Upcoming payments.

Independent Chrome reproduction kept a real synthetic HTO agent's Account open and reassigned its only quoted-gift file to a different synthetic agent. The accepted billing API immediately returned an empty obligations list and 404 for the file summary. The open account continued showing the former address and $45 quote after window focus and more than two session refresh periods. Chrome observed zero new obligations requests. The same one-shot load can leave an upcoming item visible when an issued order replaces it. Revalidate on focus and bounded polling, keep requests single-flight and clear withdrawn or failed results. Recheck that a newly persisted order does not leave the preceding obligation visible.

### P3 · A partial appointment suppresses the client contract-date fallback

At `apps/web/app/(portal)/portal/_views/PortalTimeline.tsx:42`, a place by itself counts as appointment text and replaces the scheduled row's contract date and “Details to come.” The client next-step summary uses the same place-or-date precedence at `apps/web/app/(portal)/portal/_views/ClientFile.tsx:113`.

An authenticated synthetic coordinator used the actual task PATCH to save a Closing place with `appointmentAt:null`. The seller projection retained the contract date, and the seller's browser showed only the place in the Closing row. Keep the contract date and details fallback until a scheduled time exists. A separately known place can accompany the fallback.

## Verification

- The exact C13 account and checklist suites passed 34 tests across two files. TypeScript and diff check passed. The C13 overlay with actual C09 completed a production Webpack build.
- Compared the desktop and 390-pixel portal renders with the supplied `agent portal.pdf` and `client portal .pdf` and used the written handoff for behavior. The agent overview, status and search controls, file-and-sidebar structure, and client closing, timeline, documents and team sections follow the supplied hierarchy.
- The browser ran the agent, HTO, authenticated buyer, authenticated seller, and bearer cases against local APIs. It exercised keyboard tabs, scoped documents and new uploads, a closed-file ZIP, copied links without rotation, profile phone and password, actual C09 Weatherly terms and HTO gift-only data, client fallback and approved people, bearer view and download headers, and document, link and authenticated-grant withdrawal. Desktop and 390-pixel layouts fit. The final coordinator-navigation step in that combined run encountered the synthetic Better Auth IP rate bucket after a preceding extra sign-in. The separate appointment probe authenticated the coordinator and successfully exercised the real edit.
- The C06 privacy correction and final legacy bearer/authenticated parity still need the composed recheck. All data and provider settings in this review were synthetic and local.

## Reproduction artifacts

The preserved independent probes are `/private/tmp/weatherly-r13-review/upcoming-probe.mjs` and `/private/tmp/weatherly-r13-review/appointment-probe.mjs`. The disposable API fixture, browser script, logs and rendered captures are under `/private/tmp/weatherly-r13-review`.

## Independent recheck of `6eb7ebe129137f124c63dd59c250c53519c657a7`

**Accepted for both C13 findings.** The exact worktree stayed clean. TypeScript, the revision diff check, and all 37 focused account and checklist tests passed. A production Webpack build of the exact tree with accepted C09 billing through `5f4715613d6342a822268e5fa109f24d8634244d` passed. The browser ran that build with real Better Auth cookies and the actual C03 and C09 routers on loopback, using a fresh 19-migration synthetic database and test-mode billing with blank provider credentials.

- A real C09 read returned an empty obligations page and the file summary returned 404 after reassignment. Focus removed the withdrawn address and $45 quote from the open Account. The next bounded poll restored the item after the grant was restored. An injected HTTP 503 and a failing manual retry cleared both fields. A successful manual retry reloaded the authorized result. Hiding the document cleared the rendered obligation, and showing it triggered a fresh read.
- While one obligations scan was held across five focus events and a full poll interval, Chrome started only one scan. The next poll succeeded after it finished. The exact suite also covers traversing empty result pages, aborting partial scans and rejecting repeated cursors.
- Persisting a synthetic pending gift order linked to the quote caused the real C09 obligations endpoint to omit it and the payments endpoint to return it. The already-open Account removed the quote and refreshed its existing history to show the new payment alongside a prior order, without a reload. The fixture exercised persistence and projection of the order with provider access disabled.
- The synthetic owner used the actual C03 task PATCH to save a Closing place with no appointment time. The authenticated seller’s timeline and next-step card both displayed the November 22 contract date, “Details to come” and the place. A second actual PATCH restored the time. Both views then displayed 11:00 AM and the office. The fixture started with the preceding Walkthrough complete so Closing appeared in the next-step card.

The remaining composed check uses the final independently accepted C06 revisions. Verify authenticated and bearer client parity for explicitly published legacy documents and people, continued exclusion of direct-only documents and prior versions, immediate publication and grant withdrawal, audience-safe closed-date fallback, and sender-only saved receipt data in the agent portal. The targeted results above exercise the pre-final C06 baseline.

The successful independent logs are `/private/tmp/weatherly-r13-review/fix/artifacts/targeted-confirmed.log`, `/private/tmp/weatherly-r13-review/fix/artifacts/appointment-confirmed.log`, and `/private/tmp/weatherly-r13-review/fix/artifacts/exact-suite.log`.

## Final composed C13 review

**Accepted.** The production Webpack build and TypeScript check passed. All 43 focused account, sharing and billing tests passed. The composed checkout matched the changed file blobs from C13 `6eb7ebe129137f124c63dd59c250c53519c657a7`, C09 `5f4715613d6342a822268e5fa109f24d8634244d`, and C06 `f1f4d504dd580e0b693133658e77578477794a95`. The real routers ran on loopback after all 20 migrations on isolated synthetic PostgreSQL databases.

- The full Chrome journey passed with Better Auth sessions for the Weatherly agent, HTO agent, buyer, seller and coordinator, plus a cookie-free bearer session. It exercised desktop and mobile layouts, keyboard tabs, scoped documents, upload, closed ZIP, link copying without rotation, profile and password edits, actual C09 fee projections, published appointments and approved people, and separate document, link and authenticated-grant withdrawal.
- The legacy authenticated and bearer portals showed the same explicitly published document and team member. The agent retained its approved legacy note and could find the file by the authorized buyer name. The client DOM omitted private, retired and agent-only material. Both client download controls returned version 2, and direct requests for the published version 1 were denied. An independent authenticated direct grant retained version 1 after agent-only and generic visibility changes and remained absent from both client portals.
- Actual coordinator API changes removed a document from both open client screens and denied bytes. Explicit republication restored both screens. Link revocation removed the bearer view while the authenticated grant remained usable. Revoking the separate participant grant then removed authenticated access and denied direct document bytes.
- Actual task and close-out commands produced the recorded close-out date in the signed and bearer client browsers when the Closing step was coordinator-only or marked not needed. The agent detail and list used the recorded date for the hidden step. The agent retained the audience-approved date for the not-needed step.
- The pending agent browser responses kept the immutable original snapshot after an actual coordinator edit. A second authorized agent received the pending file status without the submitter’s snapshot. The client was denied. Pending agent views omitted the timeline and private coordinator content.

The independently identified terminal legacy upload and category-write guard belongs to C06. The C13 browser checks exercised terminal reads and sharing. All test identities, documents, orders and storage were local synthetic fixtures. No account-specific service was connected.

The successful browser and suite logs are `/private/tmp/weatherly-r13-review/composed/artifacts/role-journey.log`, `/private/tmp/weatherly-r13-review/composed/artifacts/legacy-privacy-confirmed.log`, and `/private/tmp/weatherly-r13-review/composed/artifacts/suite.log`.
