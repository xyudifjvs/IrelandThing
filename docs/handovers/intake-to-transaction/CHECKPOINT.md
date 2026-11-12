# Weatherly implementation checkpoint

Continue the [implementation plan](../../plans/INTAKE_TO_TRANSACTION_IMPLEMENTATION.md) from `codex/intake-to-transaction`. Checkpoint `b83da2a` includes the independently accepted C00 foundation, C01 schema, C02 theme, C03 checklist, C04 extraction, C05 creation and lifecycle domain, and C10 private notes. C00 owns final API, worker, and navigation wiring. C00 also needs a workspace-level browser history privacy check when notes and to-dos are mounted on more routes.

## Work in progress

| Chunk | Local branch and worktree | Next step |
| --- | --- | --- |
| C05 Intake and file creation | `codex/handoff-c05-creation` at `/private/tmp/weatherly-handoff-c05` | C05 domain accepted at `ff86987` and integrated. Build the single review UI and membership-aware intake. Keep HTO, payment, sharing, and email side effects behind the C00 wiring. |
| C06 People, documents, and sharing | `codex/handoff-c06-sharing` at `/private/tmp/weatherly-handoff-c06` | Document service split, staged upload API, portal projections, and encrypted client link copy are in development. Complete people commands, file ZIPs, sharing UI and independent audience review before enabling canonical file creation. |
| C08 Agent roster | `codex/handoff-c08-roster` at `/private/tmp/weatherly-handoff-c08` | `6a0206d` defines the membership interface. Roster, onboarding, and independent review are in progress. |
| C09 Billing and payments | `codex/handoff-c09-billing` at `/private/tmp/weatherly-handoff-c09` | Build HTO fee exemption and explicit closing payment requests against synthetic transports. Ireland handles the real account. |

Read the [C00 contracts](C00/contracts.md), the current branch and worktree status, and the [independent reviews](../../reviews/intake-to-transaction/) before resuming. The branch heads can advance after this checkpoint. Inspect each candidate's history for duplicate schema and contract prerequisites before integration. Preserve independent review for every chunk.

## Execution environment

Carson resumed on the laptop and canceled the Cloud transfer. The project has a ready IrelandThing Cloud environment for later. The working branches and uncommitted changes are on the laptop. The configured GitHub repository is public.

Use synthetic documents, test principals, and a disposable local Postgres service. Set `DOTENV_CONFIG_PATH=/dev/null` and point `DATABASE_URL` at that service for `npm run db:generate` and the isolated `npx tsx tests/acceptance/run-suite.ts` runner. Ireland handles all real credentials, provider configuration, and acceptance from her laptop.

Ireland should confirm both of Carson’s decisions during the laptop handoff. Use the signed contract date when it differs from the default. **Only this date** keeps affected downstream dates fixed until Ireland edits them. Record any further Carson decisions for the same review.
