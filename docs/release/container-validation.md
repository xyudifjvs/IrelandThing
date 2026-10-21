# Local container validation

All images were built locally from intermediate integration sources before the final release freeze. They have not been pushed or deployed and do not certify the final integrated commit or Railway/provider readiness. The coordinator records the final tested source revision separately.

| Local tag                 | Successful image manifest digest                                          | Checks                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `weatherly-api:review`    | `sha256:1ab2da4d0076230c45d0002227337320a9e5fe835ad465c416420eb70a6afe24` | npm dependency installation and Prisma generation; image configuration uses non-root `node`, tini, and HTTP health probe                                 |
| `weatherly-web:review`    | `sha256:1d9eccbc13f3c1fe4ff5512a36a8cb60b52e676b7431fc13f4b63295240c8303` | Normal production Turbopack build, TypeScript, static generation and image export; image configuration uses non-root `node`, tini, and HTTP health probe |
| `weatherly-worker:review` | `sha256:4b660286a05056c2e27a4da5b207eab676e6bd503c5c4ff7b7ede82cefbc5652` | npm dependency installation, Prisma generation and export; image configuration uses non-root `node`, tini, and heartbeat/DB HTTP health probe            |
| `weatherly-ops:review`    | `sha256:4b0b80138b3cede0367dcbbbc04f99e6c794b56054efaa44b3bd87364428bdbe` | Full image build and actual CLI startup with `--network none`; missing operation/target correctly returns usage and exit 1                               |

The recovery image copies the root ESM package metadata so its TypeScript CLI can use `import.meta` and top-level asynchronous operations. An isolated temporary runtime and the actual container startup both verified this correction. The container runs as `postgres`; it does not start a PostgreSQL server or perform an unspecified backup/restore.

Encrypted snapshot/restore behavior was independently exercised through six build-team tests against disposable migrated PostgreSQL databases and synthetic document objects: wrong key, tampered manifest, source-target collision and populated-target guards, plus exact restored record counts, object linkage, size and hashes. The final local build-team suite passed 50 tests across 9 files before subsequent coordinator/service changes. Independent review and CI must use the final integrated revision.

The container package installation reported three moderate npm audit entries. No dependency upgrade or automatic force fix was performed; the coordinator has this result for release assessment.
