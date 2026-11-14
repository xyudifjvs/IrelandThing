# Weatherly intake-to-transaction release record

Independent integrated acceptance passed for local candidate `8325b5f0e157f919fe9795279f7cdc62a3f34f3b` on `codex/intake-to-transaction`. All 16 chunks passed independent review. The [R15 review](../reviews/intake-to-transaction/C15/review.md), [implementation checkpoint](../handovers/intake-to-transaction/CHECKPOINT.md), and [Ireland laptop handoff](../runbooks/intake-to-transaction-ireland-laptop.md) record the evidence and account verification steps.

## Verified local milestones

- The full suite passed 456 tests across 69 files. TypeScript and the Webpack production build passed. The three trailing blank lines found during the branch-wide diff check were removed. The final diff check, typecheck, and all 49 focused intake tests passed afterward.
- A fresh PostgreSQL database applied all 20 migrations. An independent populated rehearsal applied migrations 19 and 20 to data at migration 18 and verified retained records across eight tables, audience flags, and migration replay. A custom-format backup restored into a second isolated database with matching rows and migration history.
- Real-cookie HTTP checks covered canonical intake confirmation and replay, older pending and processed receipt compatibility, scoped routes, HTO reassignment, termination, reopen, and deletion. The concurrent same-revision test allowed one write and rejected the competing action with a revision conflict.
- Real desktop and mobile Chrome covered coordinator tabs, agent and client views, and cookie-free bearer publication and withdrawal after close-out. Independent review also verified workspace history across a session change and the absence of stale private data.
- The local worker drained both older intake notification job formats with outbound delivery disabled. The email placeholder setup inserted seven rows on its first synthetic run and zero on replay.

## Ireland’s handoff

All account connections and live provider checks remain for Ireland’s laptop. Final buyer and seller email wording, client copy, the compliance item list, and `og-1-cream.png` are still pending. The [decision register](../handovers/intake-to-transaction/C00/contracts.md#decisions-for-ireland-to-confirm) records the choices for Ireland to confirm. Hosted migration, deployment, and verification require the separate release handoff.
