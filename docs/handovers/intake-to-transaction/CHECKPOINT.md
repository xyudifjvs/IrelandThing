# Weatherly implementation checkpoint

Continue the [implementation plan](../../plans/INTAKE_TO_TRANSACTION_IMPLEMENTATION.md) from `codex/intake-to-transaction`. Checkpoint `88a8dc7` includes independently accepted schema, theme, checklist, extraction, creation, sharing, roster, billing, private notes, and HTO Operations. The combined run with the first C00 wiring passed 429 tests in 64 suites. The actual loopback API accepted a synthetic sign-in, canonical file confirmation and replay, HTO row creation, people edits, and private notes. The actual worker acknowledged both old intake notification job formats with outbound delivery disabled. C00 still owns final lifecycle, invitation, Portfolio, seed, navigation, and workspace browser history wiring.

## Work in progress

| Chunk | Local branch and worktree | Next step |
| --- | --- | --- |
| C05 Business changes | `/private/tmp/weatherly-handoff-c05-file-business` | Revisioned command preserves current payment terms and terminal locks. Latest pricing correction awaits independent recheck. |
| C06 Portal projections | `/private/tmp/weatherly-handoff-c06-portal-projection` | `e4a889f` passed 54 tests and entered independent review. |
| C07 File email | `/private/tmp/weatherly-handoff-c07` | Independent findings are being fixed, including stale recipients, legacy placeholders, delivery recovery, threaded history, role defaults, and autocomplete. |
| C09 Account billing summary | `/private/tmp/weatherly-handoff-c09-account-summary` | Follow-up aligns summary with persisted Checkout and uncertain recovery. The corrected billing suite passed 63 tests and awaits independent recheck. |
| C12 Portfolio | `/private/tmp/weatherly-handoff-c12` | R12 accepted `eee792b` with 66 tests and the independent cutoff contention probe. C00 mounts `createPortfolioRouter({ listEmailWork })` after C07. |
| C13 Agent/client portals | `/private/tmp/weatherly-handoff-c13` | `5b3a525` passed typecheck, production build, 34 tests and synthetic browser journeys. Independent review needs C06 and C09 projections. |
| C14 Coordinator file | `/private/tmp/weatherly-handoff-c14` | Building approved child module composition, including `?tab=emails` deep links from Overview. |
| C15 Integrated acceptance | Queued | Exercise the wired API, worker and browser flows and write the Ireland laptop runbook. |

Read the [C00 contracts](C00/contracts.md), the current branch and worktree status, and the [independent reviews](../../reviews/intake-to-transaction/) before resuming. The branch heads can advance after this checkpoint. Inspect each candidate's history for duplicate schema and contract prerequisites before integration. Preserve independent review for every chunk.

## Execution environment

Carson resumed on the laptop and canceled the Cloud transfer. The project has a ready IrelandThing Cloud environment for later. The working branches and uncommitted changes are on the laptop. The configured GitHub repository is public.

Use synthetic documents, test principals, and a disposable local Postgres service. Set `DOTENV_CONFIG_PATH=/dev/null` and point `DATABASE_URL` at that service for `npm run db:generate` and the isolated `npx tsx tests/acceptance/run-suite.ts` runner. Ireland handles all real credentials, provider configuration, and acceptance from her laptop.

The [decision register](C00/contracts.md#decisions-for-ireland-to-confirm) includes Carson's choices on signed contract dates and **Only this date**, along with HTO implementation choices for Ireland to confirm during the laptop handoff.
