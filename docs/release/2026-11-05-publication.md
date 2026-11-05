# November 5 publication preparation

The user authorized committing, pushing and publishing the redesign, and confirmed that Ireland's production Railway environment automatically deploys GitHub `main`. This supersedes the earlier pending push authorization and the historical staging manifest's manual-deploy setting. Publication uses the existing `xyudifjvs/IrelandThing` GitHub remote; Carson's Railway/provider connectors are not used.

The release preserves the reviewed implementation in `8b3ad3a` and Ireland's newer public-page PostHog integration in `fb9e3f5`. The branches merged cleanly at `97f57e3`. Analytics stays confined to the marketing layout with the upstream masking and private-page cleanup behavior. No provider credentials, delivery flags or account connections were changed here.

The fresh dependency audit identified request-handler advisories in the existing lockfile. The release updates only Multer to 2.5.0 and body-parser to 2.4.0, within their supported major versions. These are the patched versions in the [Multer advisory](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) and [body-parser advisory](https://github.com/advisories/GHSA-27r3-jxmh-p828). The resulting npm audit reports zero vulnerabilities.

The combined, patched source passed:

- 323 tests in 49 files, using a new disposable local PostgreSQL database with all 17 migrations.
- Global TypeScript and the optimized production web build.
- Real-session HTTP acceptance, with no external provider calls.
- Deployment safeguards for private internal services, non-root images, health checks, secret exclusion and no production demo seeding.

The merge commit's [GitHub quality run](https://github.com/xyudifjvs/IrelandThing/actions/runs/42046547887) also passed. The final patched commit must pass its own fresh GitHub run before `main` promotion. A successful push alone is not proof of a running release; public pages and `/health` are checked after promotion.

The application's earlier implementation, browser evidence, independent review boundaries and remaining account-dependent acceptance are described in [the redesign report](weatherly-redesign.md). Those limits are separate from publishing this application update. In particular, the Excel email library, gift ordering and provider activation are not enabled by this release.
