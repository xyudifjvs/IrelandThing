# Live client checklist links

Checklist tasks and dates remain canonical PostgreSQL records. Coordinators can edit, complete, add, remove and reorder steps in the transaction workspace. The coordinator and authorized matter agents can generate, copy, replace and revoke a client link. The shared page shows only client-visible steps and confirmed dated deadlines. Notes, document records, contacts, private/agent steps and unreviewed dates are excluded.

Links use a random 256-bit secret in a URL fragment, which browsers do not send in HTTP URLs or referrers. Only its SHA-256 hash is stored. The browser sends the secret in the public read endpoint's Authorization header. Do not configure proxies, analytics or error collectors to record Authorization headers, response bodies or browser fragments. Sharing responses and the page use no-store, noindex/noarchive and no-referrer. A generated link is shown once in memory; replacing it invalidates the old link. The default expiry is 30 days. The public endpoint never accepts mutations and reloads current issuer access, visibility, expiry and revocation on each read.

Visible coordinator, portal and public checklist views poll every three seconds after the previous request settles, with a four-second request timeout. Successful polls preserve the mounted editor and flag concurrent revision changes. Failed, timed-out, offline or hidden views clear their data; online, focus, visibility and pageshow events reconnect. Normal changes appear within the next poll. An unavailable connection hides the last result within at most seven seconds of its last successful refresh. Revoked links return the same generic error as invalid or expired links. Already copied information cannot be recalled.

## Isolated Docker preview

This setup is for invented local records only. It uses a separate Compose project, PostgreSQL database and volumes. It does not mount host credentials, contact providers, replace the existing port-3000 preview or change Railway. Only the web service publishes a host port, bound to loopback. API/worker runtime uses the existing explicit local-development auth behavior; `LOCAL_DOCKER=true` only changes the API listener inside a local development container. Release authentication remains unchanged.

```sh
node infra/ops/checklist-local.mjs
docker compose --env-file .local/checklist-docker.env -f infra/compose.checklist-local.yml build
docker compose --env-file .local/checklist-docker.env -f infra/compose.checklist-local.yml up -d postgres
docker compose --env-file .local/checklist-docker.env -f infra/compose.checklist-local.yml run --rm --no-deps api npm run db:deploy
docker compose --env-file .local/checklist-docker.env -f infra/compose.checklist-local.yml run --rm --no-deps api npm run db:seed
docker compose --env-file .local/checklist-docker.env -f infra/compose.checklist-local.yml up -d
```

Open `http://127.0.0.1:3300/workspace/transactions/demo-oak` and choose the local demo login. Synthetic agent login is `alex.agent@example.test`; synthetic client login is `avery.client@example.test`; seed password is `Weatherly-Local-2026!`. These are local fixtures only. Open the agent portal in another browser context, generate a client link, and open it in a third context. Change client-visible checklist steps in the coordinator view and observe both views update. Revoke the link and observe its content disappear. Hidden/offline views recover automatically when reopened/reconnected. Use `docker compose ... down` to stop while preserving this demo database; never remove existing preview volumes.

## Hosted rollout remains separate

Deploy the additive `20261022014500_client_checklist_sharing` migration with matching reviewed API/web/worker images. Set the exact HTTPS `WEB_ORIGIN` used by clients, retain the header protections through the reverse proxy and verify the same simultaneous-view/privacy/revoke flows on hosting. Railway build availability and the pending DNS/TLS/origin cutover in `custom-domain.md` are separate requirements. Local links resolve only on this computer; no public deployment is claimed. Gmail, Ireland-owned Stripe, Dotloop, system mail and AI privacy gates remain unchanged.
