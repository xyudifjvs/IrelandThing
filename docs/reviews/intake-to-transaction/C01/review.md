# C01 independent schema review

Accepted commit `78157ce446801d20151d23e845f1f3e50634cd74` as the additive persistence foundation. The review covered the migration, Prisma model, compatibility with the preceding generated client, and storage contracts for the following workstreams.

## Independent verification

- Applied all 19 migrations to a new synthetic database. Applied the original 18 migrations to a second database, loaded legacy records and an independent nested JSON marker, then applied the foundation. Compared every original column across 42 legacy tables and verified all 40 original rows matched.
- Verified that legacy business, checklist and audience fields kept their null markers. The migration created ten empty tables and did not infer classifications or recover old share secrets.
- Compared both databases with the Prisma schema and repeated migration deployment. Each database matched and reported zero pending migrations.
- Ran existing file, task, document and intake read paths against the migrated population with the preceding generated client and the regenerated C01 client. Both preserved the visible task due date, suppressed the private note, retained both document versions and the pending intake link, and denied the client access to the intake.
- Raced distinct start requests for the same intake. One review succeeded and the other hit the unique intake constraint. Verified that an incomplete confirmation cannot bind a file and deleting the confirmed file preserves its terminal confirmation receipt.
- Verified the audience-pair check accepts independent client-only access and rejects a half-set pair. Verified exact storage through `9007199254740991` cents and rejection one cent above that boundary. TypeScript and the diff whitespace check passed.

The reviewer created and removed two dedicated databases on the synthetic loopback PostgreSQL instance. The builder's full existing suite result was 328 passing tests.

## Integration conditions

Deploy the additive schema before any code writes the new records. The current rollback target can still read legacy records against the additive schema. After unlinked receipts exist, rollback requires a version with the C05 null guards. A confirmation replay must check its terminal receipt even if the file link has since been cleared.

C06 must filter and serialize new fields before enabling the new audience and canonical date writers. Old readers rely on legacy visibility, so every narrowed audience written by the new service needs a compatible visibility value during the rollback window. C06 must check the current share generation and decrypted token hash before copying an encrypted link. These are service activation conditions and do not block the foundation migration.
