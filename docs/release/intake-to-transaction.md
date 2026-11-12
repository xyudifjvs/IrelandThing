# Weatherly intake-to-transaction release record

Product commit `d2ebea0625880a00afcb079d88b89ab6cc34b86d` on `codex/intake-to-transaction` includes independently accepted C00–C14. Final integrated acceptance is in progress. The [implementation checkpoint](../handovers/intake-to-transaction/CHECKPOINT.md), [independent reviews](../reviews/intake-to-transaction/), and [Ireland laptop handoff](../runbooks/intake-to-transaction-ireland-laptop.md) record the local work and account verification steps.

## Verified local milestones

- The combined checkpoint after Portfolio integration passed 434 tests in 65 suites with a disposable PostgreSQL database. This run used synthetic records and disabled live provider connections.
- An actual loopback API accepted a synthetic coordinator session, canonical creation and replay, people edits, private notes, portfolio reads, explicit termination and reopen, HTO business reassignment, and permanent deletion. Linked HTO row identity survived business reassignment. Reopen preserved cancellation of obsolete email work.
- An actual local worker drained old `intake.received` and derived `system.email` intake notices. The latter completed with its stored content redacted. The email placeholder setup added seven rows on the first synthetic run and zero on replay.

## Final candidate checks

- Record the exact integrated commit and re-run typecheck, the full database suite, a production build, and both fresh and populated migrations.
- Exercise authenticated coordinator and agent flows, client and bearer sharing, direct URL access, file lifecycle and blob cleanup, invitation and recovery, payment projection and assistant scope.
- Verify desktop and mobile browser journeys, legacy uploads, backup and restore, and workspace history privacy with synthetic accounts.
- Record the final independent verdict and any content or provider checks reserved for Ireland’s laptop.
