# Local implementation validation

This is a locally implemented release candidate with live synthetic preview data. It is not a production deployment or proof of access to any real provider account.

## Integrated candidate

The final product-code checkpoint is `f3b1338467337b33cd0973ed74eb097b88c6b0ef`. Subsequent release/evidence commits do not change product code.

- Root TypeScript and all **67 tests across 12 files passed** against a separate local PostgreSQL test database. Tests refuse the preview database; temporary files use the platform's temporary directory.
- [Linux GitHub Actions run 39537685610](https://github.com/xyudifjvs/IrelandThing/actions/runs/39537685610) passed npm installation, Prisma generation, all migrations against a fresh PostgreSQL 17 database, TypeScript, all 67 tests, the Next production build, HTTP acceptance and deployment source safeguards.
- Root Next/Turbopack production build also passed locally at `00f99f0`, before the later backend-only refund correction and portable test fixtures.
- Independent billing review at `f3b1338` passes **37/37** assertions, including the mixed Dashboard/local refund regression, incomplete/inconsistent reconciliation evidence, exact remaining balance, uncertain requests and cancellation races. See the final targeted review report under `docs/reviews/implementation/`.
- Earlier independent exact-checkpoint evidence remains scoped to its recorded commit: core 17/17, documents 20/20, OAuth/MCP 30/30, dates/drafts 6/6 and Dotloop doubles 15/15 at `2859d65`; email AI 18/18, recovery 12/12 and AI routing 4/4 at `f014c1a`; production-owner bootstrap 8/8 at `b8c33dd`. These are targeted probes, not a claim that every historical probe was rerun on the final checkpoint.

The root agent inspected the actual browser preview: public homepage, loaded workspace records, transaction detail sections, payment prices and disabled Stripe actions, plus Full Listing intake selection, saved draft progression and required-address validation. A temporary 390px viewport showed no document-width overflow; this is a bounded responsive check, not complete mobile/browser certification. The normal viewport was restored. Full browser traversal of every intake branch and separate agent/client journeys remain staging acceptance work; server-side role isolation is covered by the test/probe evidence.

The preview stays running at `http://127.0.0.1:3000/workspace` using synthetic local records. Production is planned for **Railway PostgreSQL** and private object storage. No production service or provider account is connected.

Known limitations remain explicit: scanned/image-only documents need readable text; no external OCR bypass exists. Email AI generation persists a processing record but is synchronous, so an interrupted request may require operator review of that record. Refund amounts remain conservatively reserved until complete, consistent provider evidence proves overlap; missing evidence never releases a hold. Three moderate dependency audit entries through Mammoth's CLI-only argparse/sprintf-js path remain tracked in the B01 handover; the application uses Mammoth's library text extraction, not that CLI.

## Earlier build-team evidence

| Check                                              | Result                             | Scope and limitation                                                                                                                                                                                                                                              |
| -------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend TypeScript                                | Passed                             | All 28 application page outputs checked during the frontend handover                                                                                                                                                                                              |
| Frontend production Webpack build                  | Passed                             | Worktree dependency symlink prevented Turbopack resolution; no configuration was weakened                                                                                                                                                                         |
| Repository TypeScript after operations integration | Passed                             | Includes acceptance harness imports and recovery utility types                                                                                                                                                                                                    |
| Isolated domain and acceptance suite               | 50 tests passed across 9 files     | Fresh uniquely named PostgreSQL database; no shared preview queue or real provider calls                                                                                                                                                                          |
| Encrypted recovery                                 | 6 tests passed                     | Migrated isolated PostgreSQL plus a synthetic PDF; exact table counts, document-version linkage, size and hashes restored; wrong key/tampered manifest/source DB/populated target refused                                                                         |
| End-to-end HTTP acceptance                         | 10 groups passed                   | Real cookie auth, unauthorized denial, full-listing intake/idempotency, invalid branch, stale revision, agent/client privacy, deadline correction, public meeting persistence, prices, unavailable mail/payment gates, eight public pages and sign-in HTTP render |
| Deployment source safeguards                       | Passed                             | Private internal services, non-root runtimes, health probes, no automatic seed, no secrets in copied npm configuration or build context                                                                                                                           |
| Docker API/web/worker/recovery artifact validation | All four images built successfully | See `container-validation.md` for digests and scope. Production web build and actual non-networked recovery CLI startup passed. Intermediate-source images do not certify the final integrated candidate or production deployment                                 |
| Browser interaction/visual/role review             | Independent review required        | HTTP rendering is not a substitute for client interaction, mobile visual checks or actual account-role journeys                                                                                                                                                   |
| Live provider/production validation                | Not performed                      | Gmail/Dotloop/Stripe/OpenRouter credentials/access and production recovery rehearsal remain launch gates                                                                                                                                                          |

## Reproduce safely

Use a local PostgreSQL server with permission to create disposable databases. The following runners create/drop uniquely named test databases and never seed the source connection's database. `PG_TOOLS_CONTAINER` must refer to that same local PostgreSQL container when host pg_dump/pg_restore are unavailable.

```sh
PG_TOOLS_CONTAINER=weatherly-local-db node --import tsx tests/acceptance/run-suite.ts
node --import tsx tests/acceptance/contract-smoke.ts
node infra/ops/check-deployment.mjs
```

Supply `DATABASE_URL` explicitly or through the approved test environment. `ACCEPTANCE_WEB_URL` optionally adds read-only public-page HTTP checks against an existing local preview. Domain provider adapters are injected test doubles; the acceptance server explicitly clears external provider credentials. It is not a simulated sign-in: the cookie/session flow and persisted domain services are real.

An initial full-suite run pointed at the shared local preview database encountered one communication-fixture/idempotency collision; rerunning through the isolated runner passed all 50 tests at the final local handover. Do not treat a shared active database as an isolated test environment.

## Final release gates

Recheck the exact integrated candidate after all module changes, migrate a fresh database, run all tests/builds and record independent browser findings. Demonstrate private Railway bucket access and a recovery rehearsal using the approved account. Confirm the real mailbox, Ireland-owned Stripe account, Dotloop permissions, OpenRouter privacy/ZDR route, approved legal language/brokerage rules, fee timing and gift catalog. Preserve truthful unavailable states until those gates are complete. Deployment requires a separate explicit owner decision.
