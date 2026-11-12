# Independent review of HTO closing-date corrections

**Accepted for local integration at `bde66abc20916cb8010157c0b6f63ab80266f6ca`**, based on `e85b7bc`. The review covers the C03 date adapter. The C11 review and combined acceptance still cover final router composition and the browser workflow.

- All 76 selected checklist, date approval, reminders and billing termination tests passed on a fresh synthetic PostgreSQL database after applying all 19 migrations. The exact candidate passed typecheck and `git diff --check`.
- An independent HTTP probe mounted the candidate’s ordinary File router and the current C11 Operations router with the two C03 adapters injected. Using synthetic principals, the probe confirmed anonymous requests returned 401, agent and client requests returned 403, and Operations rejected standalone and Weatherly rows. Ordinary File preview and apply returned `CHECKLIST_READ_ONLY` for the linked terminated file.
- A terminal date preview showed the open Possession move and preserved the completed walkthrough. Changing the proposed date or applying the preview to another row returned `PREVIEW_CONFLICT`. A downstream exception rolled back dates, revisions and audit history. Concurrent identical confirmations produced one successful commit and one `REVISION_CONFLICT`.
- The successful correction preserved the signed Closing status, its recorded actual date and instant, the completed walkthrough record and the file’s terminated stage. **Only this date** fixed the Possession due date through the next Closing change, even when the next edit used **Update all**. The audit identified the coordinator, Operations source, selected mode and pinned date. The Operations list then showed the corrected Closing date and kept the row marked Fell through.

Confirm with Ireland during handoff whether Operations should allow due-date corrections on linked closed and terminated files. This local implementation preserves recorded completion and actual dates.
