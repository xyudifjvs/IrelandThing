# IrelandThing

Weatherly Transaction Co. — the website and transaction-coordination system for Ireland's business.

## Project planning

- [Project scope](PROJECT_SCOPE.md): inspected mockups, full product requirements, conflicts, and owner decisions.
- [Technical plan](TECHNICAL_PLAN.md): persistent records, API/MCP, Gmail, Stripe, Dotloop, Railway, and OpenRouter ZDR.
- [Implementation plan](IMPLEMENTATION_PLAN.md): 14 exclusive builder packages, independent check-team assignments, dependencies, acceptance criteria, and GitHub workflow.
- [Planning review](docs/reviews/planning-review.md): independent review of the planning artifacts; not application test results.

The original HTML mockups and supplied JPEG assets are preserved in the repository root. A working local application now implements the website, onboarding, intake, coordinator workspace, agent/client portals, private versioned documents, reviewed deadlines, email templates, billing workflows, and a saved-record assistant/API/MCP layer. Live providers remain disabled until their account and privacy requirements are verified.

## Run locally

Requires Node 22 and PostgreSQL 17. `infra/compose.local.yml` can start a new disposable PostgreSQL instance on loopback port 55442. The existing preview uses its separate container on 55432; do not replace its volume.

1. Copy `.env.example` to `.env` and set the local database URL plus independent authentication/encryption secrets.
2. Run `npm ci`, `npm run db:generate`, and `npm run db:deploy`.
3. For synthetic local data only, set `APP_ENV=local` and run `npm run db:seed`.
4. Run `npm run dev`. Open `http://127.0.0.1:3000/workspace`. The local demo button signs into the synthetic owner. It is absent from production builds.

Tests require a separate database whose name ends in `_test`. Copy `.env.test.example` to `.env.test`, create that disposable database, migrate it, and run `npm test`. The test runner refuses the preview/production database. `npm run typecheck` and `npm run build` check the application. The isolated acceptance runner and encrypted recovery rehearsal are documented in [validation](docs/release/validation.md).

## Deployment and ownership

Production uses **PostgreSQL on Railway**, a private Railway document bucket, separate API/worker processes, and the web application. A staging environment is now hosted at [Weatherly staging](https://web-staging-be4e.up.railway.app). It builds from the GitHub repository with production authentication settings and disabled live integrations. See the [staging deployment record](docs/release/railway-staging.md), [deployment instructions](docs/runbooks/deployment.md) and [environment mapping](docs/runbooks/environment.md). Hosting does not complete the remaining production acceptance work.

Ireland must create her **own Stripe account**. The adapter requires her configured account ID and checks the credential's actual Stripe account before creating a checkout/refund. Service prices are approved at **$375 / $475 / $625 USD**. Service payment requests are explicit coordinator actions; gifts require an individually approved description, total and fulfillment/refund policy before checkout, then verified payment before ordering. No gift catalog or automatic fee timing has been invented.

The first owner is created with the one-time `npm run db:bootstrap` command. Supply the approved `BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_NAME` (defaults to Ireland), a strong `BOOTSTRAP_OWNER_PASSWORD`, and `BOOTSTRAP_OWNER_CONFIRMED` matching the exact owner email through private process environment inputs. It refuses a placeholder email or an existing coordinator, creates no sample matters, and allows email/password sign-in. Authenticator enrollment is optional. Remove any persisted bootstrap password afterward. Never run the synthetic seed in production.

All inference uses the single OpenRouter gateway with ZDR required, an explicit model/provider allowlist, no fallback and content-forwarding plugins disabled. Account privacy controls also require verification. Email/document content is untrusted evidence and cannot authorize actions. External MCP is read-only and closed to clients absent from the approved deployment manifest. See [assistant access](API_AND_MCP.md).

## What still requires launch evidence

The real Gmail address is unknown; `ireland@ireland.com` is blocked as a source and recipient. Gmail authorization/history scope, Ireland's Stripe sandbox, Dotloop developer access and binary-download capability, OpenRouter privacy settings, system-mail sender, domain, private Railway storage and production recovery must be validated with the actual accounts. Scanned PDFs currently report that readable text/transcription is needed; there is no external OCR bypass. Representative real-contract accuracy, final brokerage rules, legal copy, retention policy, operational monitoring and the launch decision remain explicit release gates.

Independent checks and exact reviewed commits are recorded under [implementation reviews](docs/reviews/implementation/) and [release evidence](docs/release/). Passing synthetic tests does not establish live-provider readiness.

## Delivery model

Build and check teams use GPT-6.1 sol. Builders own separate code areas; reviewers independently validate the exact implementation commit and send defects back to its owner. Agent work uses separate branches/worktrees and is pushed at reviewable checkpoints.

All product AI must use OpenRouter with enforced zero data retention. Authorized matter records must be available through the shared API and MCP services. Production data and credentials belong in secured application storage, never in this repository.
