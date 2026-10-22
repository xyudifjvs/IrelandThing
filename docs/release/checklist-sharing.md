# Live checklist sharing: local release evidence

Verified October 21, 2026 (America/New_York). Reviewed product candidate: `4271dfea9d5fab4aaa8129ca4ed6527c6675737c`. This is a local Docker release, not a public deployment. Concurrent Calendly/document-upload development in the primary checkout was preserved and excluded from this checklist commit and isolated review.

## Implementation

Authorized coordinators and matter agents can generate/copy, replace and revoke a read-only client checklist link. PostgreSQL remains canonical. Coordinators can edit task title/status/completion/visibility/due date, add/delete steps and reorder them. Coordinator, authenticated portal and public pages poll current authorized data every three seconds after the prior request settles, with a four-second timeout and reconnect handling. Failed/offline/hidden public views clear content; revoked links and withdrawn visibility disappear without manual reload. Unsaved visible task/date drafts detect concurrent revision changes.

Only client-visible tasks and confirmed dated deadlines are returned publicly; no notes, documents, contacts, task details or private canonical position gaps are projected. Link secrets contain 256 random bits, live in URL fragments, and are sent only in Authorization headers to the public read endpoint. PostgreSQL stores hashes only. Each read enforces current expiry, revocation and issuer access (including account, membership, agreement and MFA gates). Safe sharing metadata is available through authenticated API/MCP records without recovering a bearer URL. No sends, charges or AI calls are required.

## Independent verification

The independent checker authored no submitted production code or application tests. At exact candidate `4271dfe`, with its own generated Prisma client and workspace dependencies:

- TypeScript passes; all **139 tests across 20 files** pass on a fresh disposable database with all ten candidate migrations, including encrypted recovery using the local PostgreSQL Docker tools.
- **14 API/privacy groups** pass: roles and unrelated matters, high-entropy/hash-only secrets, strict projections, live edits/order/deletion/visibility, expiry, concurrent rotation/revocation, issuer withdrawal, headers and audit/log secrecy.
- **8 actual MCP protocol groups** pass: discoverable safe sharing records, canonical state/date parity, read-only access, credential separation and revocation. Synthetic approved read grants use no external model/provider.
- **11 real simultaneous-browser groups** pass: actual agent generate/clipboard copy, mobile layout, coordinator editing/add/order/delete/visibility propagation, offline recovery, delayed response suppression, server errors, timeout, rotation and open-page revocation. No runtime error or token-in-URL/referrer/log leakage was observed.

The checker report and executable probes are in `../reviews/implementation/checklist-sharing/`. This bounded acceptance does not certify every browser/device, production load or hosted network configuration.

## Actual Docker preview

All four services are healthy: isolated PostgreSQL, API, worker and web. Only web is published to the host, at `127.0.0.1:3300`; the existing `3000` preview database/volume was not replaced. The database contains invented fixtures only and all ten candidate migrations. No account/provider credentials were mounted. Local secrets are generated into an ignored mode-0600 file.

Release Dockerfiles successfully built API/worker/web. After isolating the selected code from the concurrently changing checkout, final image layers replaced all application/package/infrastructure source from exact Git snapshots, regenerated Prisma and rebuilt the web app (32 outputs). The web configuration was changed to native ESM so a normal root-directory container start resolves its TypeScript import without loader flags. Image identities:

| Image | SHA-256 image identity | Application source |
| --- | --- | --- |
| `weatherly-checklist-api:local` | `d93d9a21af40532942ecd9321f7c4b805f2a4a6381d510e7087eb746a9ddd39c` | `4b4362e`; API/packages unchanged in `4271dfe` |
| `weatherly-checklist-worker:local` | `a571ff4e313febbc36cfd065520bcbcfea0a3474ae30ab8fd21d6e17b98397b6` | `4b4362e`; worker/packages unchanged in `4271dfe` |
| `weatherly-checklist-web:local` | `a70db53a8ca9dfa1ea8027b596dddd793d350468ff1ab3c1bc158119c653a98a` | `4271dfe` |

Root additionally exercised the running Docker app with real cookie sessions and three separate browser contexts: agent-created link, client-only projection, coordinator UI completion propagating to mobile, offline clearing/reconnect, revocation clearing and fresh link restoration, plus 390px overflow and saved deadline-prefill checks. Screenshots and fixture receipt remain in ignored `.local/preview/checklist-docker-*`; bearer values are not recorded in this release document. The demo matter is `cmviw29zy000007kgo7szacwo`. Reproduction commands are in `../runbooks/checklist-sharing.md`.

## Hosted requirements

No Railway deployment or DNS/account change was performed. Railway is unavailable per the user; public checklist links require the additive checklist migration, matching reviewed application release and HTTPS canonical `WEB_ORIGIN` on hosting. Pending DNS/TLS/application-origin steps remain in `../runbooks/custom-domain.md`. Ireland's Gmail, Stripe, Dotloop and system-mail accounts and client-facing AI privacy approval remain paused. Never use Carson's Stripe. Local links work only on this computer.
