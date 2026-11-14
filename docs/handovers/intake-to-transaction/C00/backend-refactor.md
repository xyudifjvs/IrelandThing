# C00 matters backend refactor

Baseline `2177674877bc97c3371f94b331aa5e18a2e69e07`. Builder worktree `/private/tmp/weatherly-handoff-c00-matters` on `codex/handoff-c00-matters`. Scope is `packages/matters/src/**` and this handoff. R00 independently reviews the candidate before ownership transfer.

The package entry now re-exports the original public surface. It delegates to smaller modules for matter access, change hooks, queries, commands, validation, and Express routes. Workflow and checklist share modules import the access and field modules directly.

| Owner after C00 acceptance | Matters files |
| --- | --- |
| C00 | `index.ts`, `task-fields.ts`, `deadline-fields.ts`, `access.ts`, `change-hook.ts`, `routes/router.ts`, `commands/notes.ts` for existing note CRUD |
| C03 | `rules.ts`, `validation/**`, `commands/tasks.ts`, `commands/deadlines.ts`, `commands/update-child.ts`, `commands/date-followup.ts`, `routes/children.ts` |
| C05 | `file-review.ts`, `commands/lifecycle.ts`, `commands/lifecycle-input.ts`, `commands/file-review.ts`, `commands/extraction-approval.ts`, `routes/file-review.ts`, `routes/lifecycle.ts` |
| C06 | `projections/**`, `checklist-sharing.ts`, `routes/queries.ts`, `routes/participants.ts` |

The shared child command retains revision-guarded task, deadline, and legacy note mutations. C03 owns that command and the existing child routes after the split. C10 implements new private notes in its separate feature directory. C05 owns lifecycle validation alongside lifecycle commands and consumes the common validation guards.

## Builder verification

- `npm run typecheck` passed in the isolated worktree with workspace links targeting the candidate packages.
- The independent route inventory probe matched 44 runtime exports, 27 routes, and both privacy middleware registrations in baseline order.
- The preservation probe matched the package's 45 type and runtime exports and both original field-module export sets. It found 59 matching declarations across its combined backend and baseline UI sample. Only the router factory differed because its handler implementations moved to their own modules.
- The existing matters, intake, AI, and communications regression suites passed 132 tests across 19 files. The isolated runner applied all 18 existing migrations to its disposable local PostgreSQL database.
