# Optional intake details and upload feedback

Implemented and validated locally on November 1, 2026. The user authorized committing all pending work, pushing it and updating the live site. Hosted release verification is recorded separately after deployment.

Agents can continue through every intake step and submit without a property address, clients, title/lender contacts, broker contacts, contract upload, Dotloop loop ID, or gift selection. The existing service and representation selections remain, and entered email addresses, branch consistency, document ownership, file limits, draft revisions and submission idempotency are still validated. Blank addresses create an **Untitled transaction**; missing information creates follow-up tasks instead of blocking submission.

Uploads still accept PDF and DOCX files up to 20 MB each. Older `.doc` files show conversion instructions. Interrupted multipart uploads and unexpected storage failures return specific retry messages; browser connection failures also explain how to retry. Existing batch upload and retry behavior is preserved.

Validation:

- Full regression suite: 221 tests across 32 files passed against a new disposable local PostgreSQL database. The final additional malformed multipart assertions also passed in the nine-test document suite.
- TypeScript and the production Next build passed.
- Chrome with a real synthetic agent session through the web proxy: blank Essentials, Complete and Full Listing submissions created accessible transactions; the 390-pixel mobile flow fit the viewport.
- Browser file selection: legacy Word rejection with conversion instructions; readable PDF/DOCX batch upload, completed text extraction for both formats, draft association, submission, document persistence and downloads.
- Local evidence and reproducible browser script: `.local/intake-optional-check/` (ignored). Test databases and app processes are temporary; no hosted records were created.

Ireland's original failed file and error are unavailable, and hosted logs did not identify that failure. These checks establish the current local flow and improved failure feedback, not a confirmed diagnosis of her original upload. The hosted application was observed still serving `341f9179dda7aaf07d77182cf1cb3b8c840a6b4c`. This checkout also contains earlier uncommitted batch-upload and other work; preserve those changes and their migration dependencies when preparing a release.
