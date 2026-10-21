# Independent review probes

Run these manually against a disposable local review/test database and isolated API/web servers. They mutate synthetic records, and some leave synthetic fixtures for inspection. They are evidence scripts, not the CI acceptance suite or application code. Reports record the exact source commits that were actually executed; running a script against newer source creates a new result and does not retroactively change those reports.

From the repository root:

```sh
export CHECKER_DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:PORT/weatherly_independent_review'
node --import tsx docs/reviews/implementation/probes/weatherly-independent-billing.mts
node --import tsx docs/reviews/implementation/probes/weatherly-independent-email-ai.mts
```

Imports resolve relative to this checkout. `_review-safety.mjs` requires an explicit database URL, permits only a local host and a review/test database name, rejects NODE_ENV=production, and sets DATABASE_URL before product imports initialize. Every probe imports this module for its side effect even when its exported values are unused.

HTTP probes assume a migrated and synthetically seeded database with owner-local, agent-local and client-local accounts and the documented local demo password. They default to a separate API4100 and Next proxy3100; override CHECKER_API_URL and CHECKER_WEB_URL for other local ports. Those servers must use the same isolated database, APP_ENV=local and disabled/unconfigured real providers. The core probe creates two additional unrelated synthetic users. Some standalone probes depend on those users; run core before documents. Account login rate limits remain enabled: allow at least a minute between login-heavy batches.

For the recovery probe, install compatible local pg_dump/pg_restore or set PG_TOOLS_CONTAINER to a local PostgreSQL container. Its source/target databases are freshly created and removed, its object stores/archives are temporary, and no live storage is touched. Bootstrap likewise creates a fresh disposable database and uses reserved.invalid addresses only. These scripts need permission to create/drop local disposable databases. They do not bootstrap or mutate an actual owner account.

The billing/Dotloop/email-AI probes inject in-process providers/generators. No external account or model call is part of those probes. Historical AI extraction probes replace global fetch with a synthetic OpenRouter response, and must only be run in their own process. API/MCP probes require the exact synthetic deployment manifest/evidence described in the review report; never approve an actual downstream client on that synthetic proof.
