# Independent launch platform and UI review

Date: October 21, 2026. Reviewer: independent check-team agent; no production source or builder tests authored by this reviewer.

## Reviewed revisions and result

- UI source: `179a2a0c58ea08dcd37fbb658244148a446b26d9`, integrated by root as `0e0f191`.
- Root platform: `fb7de6745e9d1a13bad6aeba82637368fababfc8`.
- Permission/configuration fixes and integrated HTTP snapshot: `ec82009`.
- Final root indexing helper/configuration recheck: `236b190200ed6e765a2d21d7ce348319c8782fb4`.

**Pass for the bounded independent source, HTTP, database and configuration checks described below. Browser interaction acceptance remains separate.** No provider account was inspected or connected; no external email, payment, model or storage call was made. This does not approve real-client use, provider activation or deployment.

## Isolation and executed evidence

Created an isolated Git source archive of `ec82009` at `/tmp/weatherly-launch-checker-ec82009`, a new local database `checker_launch_ec82009_test`, synthetic seed identities and a private temporary document directory. All migrations applied to that disposable database. Started separate API4100 and Next3100 with external providers disabled; the user's API4000/web3000/worker5000 and preview database were not changed. Package workspace links resolve to the isolated source; installed dependency artifacts are reused. No worker was started, so an `unseen` operations status is expected.

Independent scratch probes:

| Probe                                 | Result                    | What it establishes                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/tmp/weatherly-launch-http.mjs`      | 27/27 passed at `ec82009` | Actual cookie sign-in; operations 401/403/coordinator projection; original uploader's client-shared version denial; owner version append; exact PDF v1/v2 bytes and no-store headers; client self-sharing denial; stale permission revision conflict; agent/client metadata and both historical download URLs denied after revocation; unrelated client matter denial; concurrent public inquiry deduplication/minimal receipt; changed retry conflict and honeypot rejection |
| `/tmp/weatherly-launch-db.mts`        | 9/9 passed at `ec82009`   | Forty-five concurrent increments across three independent PostgreSQL limiter stores produce one exact sequence; hashed identifiers, expired-window reset and safe decrement; operation failures strip synthetic provider text/payload; agent/client denial; absent worker reported honestly                                                                                                                                                                                   |
| `/tmp/weatherly-launch-root-pure.mts` | 63/63 passed at `236b190` | Production/indexing-flag matrix; invalid/local/internal/Railway/reserved-example origins; seven public canonicals/sitemap; no invented organization address; private path noindex rules; global staging noindex; trusted proxy input rejection; socket-peer/X-Forwarded-For boundary and overwritten private client-IP header through temporary loopback HTTP servers                                                                                                         |

The initial loopback bind was denied by the sandbox; the explicitly approved loopback-only rerun succeeded. Scratch probes are independent review scripts, not product tests or additions to CI. Their source paths are temporary; fixture/setup instructions and results here delimit the evidence. No claim is made that these checks exercised Railway's actual proxy chain or a production web build.

## Findings and disposition

1. **Resolved: agent uploader could append to a client-shared file.** UI correctly hid that action but the original server authorization still allowed it using requested `visibility=agent`, while the existing document retained client visibility. Root assumed B03 ownership and added server denial before object writes. The integrated HTTP check now receives 403, confirms no additional version, then confirms the coordinator can append. Later permission revocation denies both historical download URLs to agent and client.
2. **Resolved: reserved example domains accepted as canonical production origins.** Initial `fb7de67` checks accepted `example.com`, `www.example.org` and `sub.example.net`. Root added rejection; the same negative cases pass at `236b190`.
3. **Root-reported build finding, source-inspected only:** `236b190` moves social-image rendering from an automatic metadata image file to a normal GET route, avoiding implicit localhost image metadata before domain approval. The reviewer inspected this diff; root's production-build/render evidence is separate from the independent configuration probe.

## UI source checks

The UI owner changed only its account/portal/workspace paths and handover. Static inspection confirms:

- Mobile account menu appears at the same breakpoint that hides desktop settings/support/sign-out; menu links, Escape focus restoration, disabled sign-out and visible retry errors exist.
- One owned main landmark per route group, route focus, and selected-state/arrow/Home/End transaction tab handling are present. Global skip-link ownership remains with root.
- Sharing explicitly applies to all historical versions, requires an acknowledgement when changing scope, and provides explicit portal revocation. Version links include immutable version IDs. Stale revision errors have a reload path.
- Document and account selectors paginate; portal/calendar complete their authorized matter scan or show an error instead of presenting a silently partial empty list.
- Intake marks edits/pending uploads unsaved, exposes failed draft retrieval and explicit separate-new-intake choice, retains inputs on failed save/resume, and adds step/error focus plus navigation warnings. The pending-upload check is in the save path. Browser Back/Forward and actual focus/keyboard behavior require interaction evidence.

## Browser limitation and remaining gates

The reviewer's CUA session returned `Browser is not available: iab`; its surface inventory contained `browsers: []`. In accordance with the CUA-only instruction, the reviewer did not switch to Chrome or headless automation. Root was supplied the isolated3100 URL, synthetic account details and document fixture for its own CUA journey. Root's observations must be attributed to root and must not be represented as this reviewer's independent browser certification.

Provider account journeys, actual Railway proxy configuration, continuous alert delivery, scheduled backup operation/hosted recovery, approved business policies, broad browser/accessibility/performance acceptance and Ireland's observed pilot remain open launch gates. Assistant/payment service fixes have their own exact-commit review; this report does not certify those pending changes.

After root closed the isolated review tab, the reviewer stopped only the validated checker listeners on3100/4100, confirmed both ports had no listeners, dropped only `checker_launch_ec82009_test`, and removed its temporary process configuration. Root preview services and PostgreSQL container were left running. The final service review is recorded separately in `launch-services.md`.
