# Optional intake details and upload feedback

Released to https://www.weatherlytc.com on November 1, 2026. All pending project changes were committed, integrated with current main and pushed. API, worker and web serve application commit `84ee3ef867e2a44637a4b084a392d6b8bd9b1b6f`; the deployment receipt is in `infra/railway/staging.json`.

Agents can continue through every intake step and submit without a property address, clients, title/lender contacts, broker contacts, contract upload, Dotloop loop ID, or gift selection. The existing service and representation selections remain, and entered email addresses, branch consistency, document ownership, file limits, draft revisions and submission idempotency are still validated. Blank addresses create an **Untitled transaction**; missing information creates follow-up tasks instead of blocking submission.

Uploads still accept PDF and DOCX files up to 20 MB each. Older `.doc` files show conversion instructions. Interrupted multipart uploads and unexpected storage failures return specific retry messages; browser connection failures also explain how to retry. Existing batch upload and retry behavior is preserved.

Validation:

- Final combined regression suite after integrating main: 225 tests across 33 files passed against a new disposable local PostgreSQL database, including interrupted-upload assertions. Nine real-session API acceptance groups passed. [GitHub CI](https://github.com/xyudifjvs/IrelandThing/actions/runs/41372786153) passed on the exact application release commit.
- TypeScript and the production Next build passed.
- Chrome with a real synthetic agent session through the web proxy: blank Essentials, Complete and Full Listing submissions created accessible transactions; the 390-pixel mobile flow fit the viewport.
- Browser file selection: legacy Word rejection with conversion instructions; readable PDF/DOCX batch upload, completed text extraction for both formats, draft association, submission, document persistence and downloads.
- Local evidence and reproducible browser script: `.local/intake-optional-check/` (ignored). Local test databases, containers and app processes were removed. Hosted synthetic verification records were also removed as described below.

Hosted acceptance confirmed a blank intake submission and its agent transaction page, then a PDF/DOCX batch with completed text extraction, submission and successful downloads. A private storage round trip passed. All 13 migrations finished, all four Railway services were online with no crashed replicas or pending work, and password-only owner sign-in/sign-out and foreign-origin denial passed. Exactly two temporary drafts, two test transactions and two uploaded test documents were removed; their audit trail was retained. No email, payment or provider account was activated.

Ireland's original failed file and error remain unavailable, so its precise cause is unconfirmed. The current upload flow is verified live. This release includes the earlier pending batch-upload work and additive migration dependencies; the latest main branch's optional-authenticator behavior was preserved during integration.
