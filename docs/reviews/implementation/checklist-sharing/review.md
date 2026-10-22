# Independent client-checklist sharing review

**Result: no unresolved checklist-sharing defect found in exact product candidate `4271dfea9d5fab4aaa8129ca4ed6527c6675737c`.** This is local technical acceptance, not hosted rollout or real-client launch approval.

## Scope and isolation

The check team authored only this directory's reports and standalone probes. Application implementation, migrations and automated application tests were authored by the build/integration team. Workspace packages and Prisma generation resolve inside the separate `/private/tmp/weatherly-checklist-review` checkout. Installed third-party dependencies are shared read-only. Each probe creates a unique local `checker_checklist_*` PostgreSQL database, disables real provider/AI/email credentials, starts servers on free loopback ports, and stops/removes them afterward. Root's normal preview and concurrent uncommitted upload/scheduling/live-hook changes are excluded. A final database inventory found **zero** leftover `checker_checklist_*` databases.

## Findings and repairs

- Fresh public reads originally omitted the issuer's account-revocation state. The service now checks current account events, role, matter participation, and applicable agreement/MFA gates.
- Rotation originally kept a stable share ID and could use the same millisecond timestamp, allowing another manager's open copy control to offer an obsolete link. Every rotation now changes the metadata ID; the UI invalidates stale generated links.
- Absolute task positions could disclose gaps caused by hidden tasks. Public and restricted role projections now report dense positions while PostgreSQL retains canonical ordering.
- Checklist title fields originally allowed 500 characters while the service allows 300. The UI now matches the service contract.
- The first new registry regression test used a non-MFA synthetic issuer outside local mode. Its fixture now satisfies the real access policy; the policy remains intact.
- The Docker preview exposed a baseline Next configuration import failure at root-directory startup even though builds passed. The build team changed the config to native ESM `.mts` with an explicit TypeScript source import and added typecheck coverage. The final candidate's local browser server starts successfully without a loader workaround. The coordinator separately operates/verifies the Docker preview.

These findings were sent to the builders and repaired there; the check team did not author the production fixes.

## Final verification

Exact product candidate `4271dfea9d5fab4aaa8129ca4ed6527c6675737c`, re-run after the configuration repair:

- TypeScript passes.
- Full isolated suite passes **139/139 tests in 20 files**, with all **10 migrations** applied. Recovery checks use the existing local `weatherly-local-db` container's PostgreSQL tools; the host has no `pg_dump` binary.
- Independent real HTTP/database suite passes **14/14 groups**: real cookie authentication; role/matter boundaries; safe API/MCP metadata; read-only bearer; hash-only storage; exact public allowlist; cache/robot/referrer headers; canonical updates and ordering; concurrent revisions/rotation; withdrawal/deletion; expiry; participant/account revocation; audit/log leakage.
- Independent actual MCP protocol suite passes **8/8 groups**: initialization and discovery; safe `checklist_shares` registry; canonical checklist mutation/date parity; distinct public/MCP credentials; share/grant revocation; no raw credential in logs/audit. The isolated synthetic approved client/read grant is only a protocol fixture; it asserts no approval of a real external deployment and makes no AI call.
- Independent simultaneous browser suite passes **11/11 groups** using real authenticated coordinator/agent pages and a separate anonymous 390 × 844 client context. It exercises actual generation/clipboard copy; narrow read-only mobile content and privacy headers; coordinator UI completion/title/status/date/add/order/delete/visibility changes reflected in open agent/client pages; offline clearing/reconnection; delayed pre-reconnect response suppression; HTTP 503 clearing/retry; stalled-request timeout; stale copy suppression after another manager rotates; and open-page rotation/revocation clearing. No browser runtime error or raw token in request URLs, referrers or server logs was observed.
- Visually inspected [mobile screenshot](./client-mobile.png): readable, no horizontal overflow, visible live status and confirmed dates. The small Next development indicator identifies this as the independent local development-server capture.

Polling is single-flight, every three seconds after a read, with a four-second request timeout. Failed/unauthorized reads and offline/hidden/pagehide events clear the displayed projection; online/focus/pageshow events reconnect. Generation checks reject a response from an aborted or older lifecycle. Browser assertions allow bounded scheduling/render overhead, including a ten-second ceiling for clearing a stalled request.

The API probes validate mutation conflicts and concurrent rotations directly against PostgreSQL: one same-revision update wins, and exactly one concurrently rotated token remains usable. Public/restricted order numbers cannot expose hidden-task gaps. Existing API and MCP projections read the same services and canonical PostgreSQL tasks; no client checklist copy is persisted.

## Rollout boundary

No hosted deployment, Railway account action, DNS/TLS change, real message/link delivery or provider activation was performed by the check team. The coordinator owns the persistent Docker preview and final GitHub synchronization. A hosted rollout still needs the reviewed build and migration deployed with the correct secure application origin, plus the already documented hosting/domain release gates. A loopback link is only a local demonstration. This feature uses no AI and requires no new paid service.
