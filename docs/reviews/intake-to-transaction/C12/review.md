# C12 independent review

Changes requested for `2f7eb9cdbe0bf1dcc24e8951082852d9e3470a82` in the C12 worktree.

## Findings

1. **P2. The digest can permanently miss a receipt committed across a cutoff.** The digest reads a repeatable-read snapshot with a strict lower time bound. Acceptance advances `DigestCursor.highWaterAt` to the full cutoff, even for a receipt whose `createdAt` falls before the cutoff but whose transaction has yet to commit. The real intake writer uses the database's transaction-start timestamp default. In isolated PostgreSQL, a receipt dated one millisecond before Monday's 8 a.m. Eastern cutoff stayed uncommitted through Monday's accepted digest. It committed before Tuesday and appeared in neither accepted digest. Use a cutoff and committed-read protocol shared with the intake writer, or durable per-receipt delivery tracking, so a late commit enters a subsequent digest exactly once. Add a two-transaction regression that holds the writer open while the digest runs. [Window and cursor](/private/tmp/weatherly-handoff-c12/packages/communications/src/private-reminder/intake-window.ts:130) · [Intake write](/private/tmp/weatherly-handoff-c12/packages/intake/src/submission.ts:365)

2. **P2. Calendar history drops dated work on terminated and archived files.** The new historical Calendar query includes active and closed stages only. The previous Calendar requested all accessible matters and filtered pending review. The handoff explicitly preserves Calendar behavior. In the same range, the previous data source supplied dated closing tasks for the terminated and archived fixtures. The new Calendar returned neither. Retain both stages in the coordinator's Calendar history while keeping their work out of Due this week and To send. [Calendar query](/private/tmp/weatherly-handoff-c12/packages/matters/src/portfolio/calendar.ts:34) · [Handoff](</Users/carson/Repos/IrelandThing/Handoffs/Weatherly — Intake-to-Transaction Build Spec.md:9>)

## Independent checks

- Exact candidate typecheck, diff check, and 16 tests passed across the portfolio and reminders suites. All 19 migrations applied to the disposable PostgreSQL database.
- A separate HTTP fixture verified coordinator-only access, no-store responses, pending intake projection and exclusions, 207 matching files across three pages, combined search and business filters, correct serving-agent/client search, and actual closed date precedence. The integrated C07 list used the same email work IDs as the file. Undated Later remained in To send while completed, terminated, and undated work stayed out of Due this week.
- The Calendar converted a UTC appointment across midnight to the intended Eastern date. Active and closed entries appeared, as did a completed historical task. The two lost historical stages are recorded above.
- A mocked provider accepted the intake-only digest containing a processed Friday receipt and Sunday receipt across the DST change. The test verified the exact private recipient, inclusive lower cutoff, exclusive upper cutoff, deletion exclusion, disabled mail gate, encrypted dispatch storage, byte-identical retry after service restart, replay redaction and refusal to start a new window after an aged ambiguous dispatch. Completing a task and terminating a file during first preparation invalidated the old snapshot and avoided sending a stale digest.
- An isolated call to C00's current draft job registry acknowledged both historical intake-notification job shapes while passing password recovery to its original handler. This check used a synthetic delegate. The final worker composition and Ireland's provider acceptance remain separate.
- Local Chromium passed the Overview, Transactions and Calendar journey at desktop and mobile widths using intercepted synthetic API responses. The independent HTTP checks exercised the real portfolio router separately.

Independent reproductions and browser output are under `/private/tmp/weatherly-r12-review/`. No provider was connected.

## Accepted recheck

Accepted exact `eee792bc1c1ccb84799d1e28eece58ff244d24bd` for local integration. Both findings are resolved.

- The sole production intake writer acquires the shared receipt lock before reading the database wall clock. The digest waits on the exclusive lock, then reads committed receipts. The independent PostgreSQL probe observed the digest blocked on that lock and confirmed the mock transport had received nothing while the writer remained open. After commit, Monday's accepted digest included the receipt and Tuesday's accepted digest omitted it.
- The real Calendar router returned archived and terminated closing tasks in range while Due continued to exclude both stages. Pending intake records stayed excluded. The independent fixture also repeated the 207-result pagination, C07 work ID parity, private recipient, DST, stale work invalidation, and unknown delivery checks.
- All 66 focused tests across nine suites passed after the 19 migrations. Typecheck and diff check passed and the exact worktree was clean. The updated independent probe is `/private/tmp/weatherly-r12-review/recheck.mts`. Final application composition and Ireland's provider verification are separate.
