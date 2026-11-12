# Weatherly implementation checkpoint

The [implementation plan](../../plans/INTAKE_TO_TRANSACTION_IMPLEMENTATION.md) is implemented on `codex/intake-to-transaction`. Product commit `d2ebea0625880a00afcb079d88b89ab6cc34b86d` contains the independently accepted C00–C14 changes. It matches the app, package and dependency files in the staged browser candidate `dbdfd4c`. The [release record](../../release/intake-to-transaction.md) tracks the final C15 acceptance and the [independent reviews](../../reviews/intake-to-transaction/) preserve each verdict.

## Execution environment

The branch and verification worktrees are local. The configured GitHub repository is public. The `Handoffs` folder contains the original supplied material.

Use synthetic documents, test principals, and a disposable local Postgres service. Set `DOTENV_CONFIG_PATH=/dev/null` and point `DATABASE_URL` at that service for `npm run db:generate` and the isolated `npx tsx tests/acceptance/run-suite.ts` runner. Ireland handles all real credentials, provider configuration, and acceptance from her laptop.

The [Ireland laptop handoff](../../runbooks/intake-to-transaction-ireland-laptop.md) includes account setup and the [decision register](C00/contracts.md#decisions-for-ireland-to-confirm).
