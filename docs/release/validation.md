# Local implementation validation

This is a locally implemented release candidate with live synthetic preview data. It is not a production deployment or proof of access to any real provider account. Parent/B00 records the frozen integrated release commit; R13 independently verifies that exact commit and the evidence below.

## Build-team evidence

| Check                                              | Result                         | Scope and limitation                                                                                                                                                                                                                                              |
| -------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend TypeScript                                | Passed                         | All 28 application page outputs checked during the frontend handover                                                                                                                                                                                              |
| Frontend production Webpack build                  | Passed                         | Worktree dependency symlink prevented Turbopack resolution; no configuration was weakened                                                                                                                                                                         |
| Repository TypeScript after operations integration | Passed                         | Includes acceptance harness imports and recovery utility types                                                                                                                                                                                                    |
| Isolated domain and acceptance suite               | 43 tests passed across 7 files | Fresh uniquely named PostgreSQL database; no shared preview queue or real provider calls                                                                                                                                                                          |
| Encrypted recovery                                 | 6 tests passed                 | Migrated isolated PostgreSQL plus a synthetic PDF; exact table counts, document-version linkage, size and hashes restored; wrong key/tampered manifest/source DB/populated target refused                                                                         |
| End-to-end HTTP acceptance                         | 10 groups passed               | Real cookie auth, unauthorized denial, full-listing intake/idempotency, invalid branch, stale revision, agent/client privacy, deadline correction, public meeting persistence, prices, unavailable mail/payment gates, eight public pages and sign-in HTTP render |
| Deployment source safeguards                       | Passed                         | Private internal services, non-root runtimes, health probes, no automatic seed, no secrets in copied npm configuration or build context                                                                                                                           |
| Docker API/web artifact validation                 | In progress                    | Record the exact successful image/build result before treating container deployment as verified                                                                                                                                                                   |
| Browser interaction/visual/role review             | Independent review required    | HTTP rendering is not a substitute for client interaction, mobile visual checks or actual account-role journeys                                                                                                                                                   |
| Live provider/production validation                | Not performed                  | Gmail/Dotloop/Stripe/OpenRouter credentials/access and production recovery rehearsal remain launch gates                                                                                                                                                          |

## Reproduce safely

Use a local PostgreSQL server with permission to create disposable databases. The following runners create/drop uniquely named test databases and never seed the source connection's database. `PG_TOOLS_CONTAINER` must refer to that same local PostgreSQL container when host pg_dump/pg_restore are unavailable.

```sh
PG_TOOLS_CONTAINER=weatherly-local-db node --import tsx tests/acceptance/run-suite.ts
node --import tsx tests/acceptance/contract-smoke.ts
node infra/ops/check-deployment.mjs
```

Supply `DATABASE_URL` explicitly or through the approved test environment. `ACCEPTANCE_WEB_URL` optionally adds read-only public-page HTTP checks against an existing local preview. Domain provider adapters are injected test doubles; the acceptance server explicitly clears external provider credentials. It is not a simulated sign-in: the cookie/session flow and persisted domain services are real.

An initial full-suite run pointed at the shared local preview database encountered one communication-fixture/idempotency collision; rerunning through the isolated runner passed all 43 tests. Do not treat a shared active database as an isolated test environment.

## Final release gates

Recheck the exact integrated candidate after all module changes, migrate a fresh database, run all tests/builds and record independent browser findings. Demonstrate private Railway bucket access and a recovery rehearsal using the approved account. Confirm the real mailbox, Ireland-owned Stripe account, Dotloop permissions, OpenRouter privacy/ZDR route, approved legal language/brokerage rules, fee timing and gift catalog. Preserve truthful unavailable states until those gates are complete. Deployment requires a separate explicit owner decision.
