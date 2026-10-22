# Independent checklist-sharing review

This directory belongs to the independent check team. Its probes and reports are review evidence, not application implementation or CI tests. Checkers do not modify production code, migrations, application tests, configuration, or the builders' handovers.

## Review contract

Review the exact integrated candidate, and re-review fixes at their new exact commit. The application must keep a single PostgreSQL checklist and serve only current authorized projections. Public checklist tokens grant read access only; tokens must be high entropy, hash-only at rest, revocable/rotatable and expiry-aware. No token or client URL belongs in audit events, normal request URLs, operational logs, referrers or indexing surfaces.

## Independent checks

- Create synthetic owner, assigned agent, participating agent/client, unrelated users and unrelated matters in a disposable local PostgreSQL database. Exercise real cookie authentication and public token requests through the running API.
- Confirm authorized coordinator/agent share management; deny clients, unrelated/revoked participants and unauthenticated sessions. Exercise ordinary matter/task mutations with a token and no session, and public endpoint write methods.
- Verify hash persistence, token shape, no token recovery in share listings, bounded/default expiry, expired/revoked/rotated link denial and concurrent lifecycle behavior. Confirm no tokens or confidential projections in audit output.
- Seed uniquely marked coordinator-only/agent-only/client-visible tasks, custom task kinds, private/client notes, contacts, documents, unconfirmed deadlines and a second matter. The current portal intentionally renders every task as a checklist item, so explicit client visibility governs sharing across free-form task kinds. Assert the exact public response field allowlist and narrow client projection, including after visibility changes.
- Open simultaneous coordinator, agent and mobile public-client pages. Change title/status/order/date, add/remove tasks and withdraw visibility; confirm the open pages update within the declared bound. Revoke the share and participants, confirming withdrawn content clears without reload.
- Induce offline/errors and delayed responses. Verify visible stale/error state, prompt clearing of private content, successful reconnect/focus refresh and no out-of-order response restoring old data. Confirm polling remains bounded.
- Inspect generated/copy/rotation/revocation UX, clipboard/manual fallback, expiry messaging, mobile overflow, interactive target labels, response cache/referrer/robot headers, fragment handling and server logs.
- Verify API/MCP parity through the same authorized domain services and run focused/full automated checks appropriate to the final change.

## Execution safety

Use only loopback hosts and a new database whose name starts with `checker_` or ends in `_test`. Disable all external providers. Never send messages or links. Do not change provider, DNS, account or hosted deployment state. Root's 3000/4000 preview and its seeded records are outside the independent probes unless explicitly agreed.

The dependency install may be shared, but workspace package symlinks must resolve into this review checkout. This avoids accidentally reviewing source from a sibling working tree. Record the candidate commit and report any generated-client/dependency limitation in the final evidence.

## Run

After checking out the exact candidate and generating its own Prisma client:

```sh
node --import tsx docs/reviews/implementation/checklist-sharing/independent-api.mts
node --import tsx docs/reviews/implementation/checklist-sharing/independent-mcp.mts
node --import tsx docs/reviews/implementation/checklist-sharing/independent-browser.mts
```

The harness creates and removes a new `checker_checklist_*` database for each invocation. It starts provider-disabled child servers on free loopback ports, captures their logs only for secret-leak assertions, then stops the servers and drops the database. `CHECKER_DATABASE_URL` can select a local PostgreSQL administrative connection. `CHECKER_CHROMIUM_PATH` can select an already-installed headless browser. Browser evidence is taken at a 390 × 844 mobile viewport.

The MCP probe enables the protocol only inside its isolated child server with a synthetic approved-client manifest and fixture read grant. It calls no model or external service and does not approve a real deployment. The normal API and browser probes keep external MCP disabled.
