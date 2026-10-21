# Deployment preparation and release

Status: prepared, not deployed. No Railway resource, account connection, paid service or production seed is created by these files. Use the reviewed exact commit, independent release evidence and the owner's launch authorization before deploying.

## Service layout

`infra/railway/services.json` is an explicit review matrix, not an executable Railway configuration schema. It specifies Railway PostgreSQL, a private document bucket, private API/worker services and a public Next.js web service. Dockerfiles live under `infra/docker/`; use the repository root as build context. Each Dockerfile has a matching ignore file excluding secrets, dependencies and local data.

Railway's current project configuration system is IaC; new services cannot use legacy `railway.json`/`railway.toml`. Translate this matrix into the linked environment's current IaC or settings during the separately approved provisioning step. Review a plan before applying it. [Current Railway IaC documentation](https://docs.railway.com/infrastructure-as-code).

The application images install the lockfile and retain `tsx` because workspace exports are TypeScript. Do not prune development dependencies from these images without moving `tsx` into runtime dependencies or supplying a separately tested compiled API/worker build. All runtimes run without root; API owns the one migration pre-deploy command, `npm run db:deploy`.

## Environment order

1. Establish separate staging/production databases, buckets, secrets and OAuth applications. PostgreSQL 17 is the tested database/tool major version. Keep API, worker and web in the same project environment.
2. Configure the variables in `environment.md`. Set production `APP_ENV=production`, `NODE_ENV=production`, and build web with `NEXT_PUBLIC_APP_ENV=production`. Never run `db:seed` outside an isolated local synthetic environment.
3. Build API and worker images. Set API `PORT=4000`, worker `WORKER_PORT=5000` and `PORT=5000`. They need no public domains.
4. Build web with `API_INTERNAL_URL=http://<api-private-domain>:4000`; repeat this at runtime. Set public `WEB_ORIGIN` and `BETTER_AUTH_URL` to the same final HTTPS origin. Next rewrites/public environment values are compiled: changing them requires a new web build.
5. Run the API migration pre-deploy once. Start API, worker and web against the migrated database. Configure `/health` for all three services; worker health includes its polling heartbeat. Do not treat a process that merely started as ready.
6. Check sign-in/MFA, role isolation, upload/download and an authorized API/MCP request in staging. Finish provider-specific gates before making their capabilities available.
7. Freeze the release commit, recovery evidence and owner decisions, then request the launch decision. Enable no automatic deployment in this preparation workflow.

Railway private service names resolve within their environment; requests must include the listening port. Bind services for dual-stack networking where required. [Private networking](https://docs.railway.com/networking/private-networking). Railway deployment health checks gate startup; they do not provide continuous monitoring. Add operational checks after launch through the approved operations process. [Health checks](https://docs.railway.com/deployments/healthchecks).

## Local development

`docker compose -f infra/compose.local.yml up -d` creates only a separate PostgreSQL dependency on loopback port 55442 by default. Set `DATABASE_URL` accordingly, run `npm ci`, generate/deploy migrations, and start `npm run dev`. Synthetic seeding requires both `APP_ENV=local` and a non-production runtime. This compose project never adopts the existing preview database container. Do not run `down -v` unless that disposable data is no longer needed.

## Rollback

Retain the prior tested image and a pre-migration encrypted backup. Prefer backward-compatible expand/contract migrations. Revert application images only while the current schema remains compatible; otherwise restore to isolated targets and verify before a separately reviewed cutover. Do not run an invented down migration or overwrite the original database/bucket. Recovery instructions are in `recovery.md`.
