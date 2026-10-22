# Independent core implementation review

Status: in progress; no full-product approval. Review checkout is isolated from the builder checkout and uses a separate synthetic PostgreSQL database (`weatherly_independent_review`), API port4100 and web port3100. No live customer data or provider credentials are used. Reviewer authored scratch probes only, not the product source or builder tests.

## Exact revisions and observed evidence

- `b853921`: clean locked dependency installation; Prisma client generation; both committed migrations applied to an empty reviewer database; synthetic seed; API health200; browser synthetic coordinator login and dashboard render.
- `b853921`: independently authored HTTP probes:15/17 passed. Reproduced approved-agreement-without-evidence incorrectly201 and concurrent same-key intake returning409/200. One submission effect still persisted. These were reported to the owner.
- `b853921`: browser private-to-do checkbox produced visible422 because UI sent `complete` while service accepts `completed`; completed earnest-money task also remained in Needs attention. Reported to frontend owner. Date editing, external recipient contacts and broker status interactions were separately identified as source-behavior gaps.
- `75e6ed8`: clean schema reset restricted to reviewer database, migrations reapplied, seed rerun, candidate restarted. All17 independent HTTP checks passed, including both previously failing service cases. Frontend fix is not included in this revision and awaits its own browser verification.

## Independently exercised HTTP checks at75e6ed8

1. Unauthenticated matter list401.
2. Coordinator receives three seeded matters on clean database.
3. Unrelated second agent receives empty list.
4. Unrelated agent direct seeded matter404.
5. Client receives narrow own-matter projection without intake details/participants/private notes or non-client tasks.
6. Client unrelated seeded matter404.
7. Agent private coordinator activity403.
8. Client intake creation403.
9. Profile role escalation422.
10. Coordinator creates a seller Full Listing in listing stage.
11. Simultaneous expectedRevision1 updates yield one200 and one409.
12. Listing moves to under_contract retaining matter ID.
13. Approved agreement without signed evidence422.
14. Concurrent identical intake submissions both200 with same matter receipt.
15. Database contains exactly one submission for that draft.
16. Different idempotency key cannot resubmit immutable draft409.
17. Own-session revocation immediately makes subsequent API read401.

The probe is `/tmp/weatherly-independent-core.mjs`; its initial hardcoded candidate display string was not updated for the rerun, so the exact checked revision is recorded here from the isolated checkout HEAD. Tests executed against the actual candidate Express/BetterAuth/Prisma/PostgreSQL stack, not mocked service responses.

## Required follow-up

Rerun corrected UI interactions on the integrated frontend commit; test document permission/version handling and onboarding/invitation/auth flows; examine all intake conditions and remaining source scope. Provider modules, full API/MCP parity, ZDR runtime behavior, queue/recovery, production storage, deployment and external integration behavior are not approved by these core checks.

User-approved catalog is Essentials375USD, Complete475USD, FullListing625USD. Gmail `ireland@ireland.com` is a placeholder and must remain disconnected. Stripe must use Ireland's own future configured account; Carson's Stripe account is not permitted. Payment review uses local test stubs only.

## Document fix recheck at639caf4

Twenty independent HTTP checks pass: real PDF text and page extraction; storage-key omission; unrelated agent metadata/download404; unshared client metadata/download404; byte-exact authorized download; new version2; original version retained byte-for-byte; latest version download; coordinator sharing using returned revision200; explicitly shared client download200; draft upload; unrelated-agent/client draft404; draft absent from unrelated list; spoofedPDF415; legacyDOC415 with conversion code; client upload403; cross-document version substitution404. The stale version-response revision finding is resolved.

Supplemental checks at75e6ed8: TypeScript check passed; supplied service suite passed7/7 when DATABASE_URL explicitly pointed at the isolated reviewer database. Running it with no database configuration fails closed rather than silently selecting an in-memory store. This is supplemental builder-test evidence, separate from the independent HTTP checks.

A subsequent integration defect was identified at75e6ed8: frontend used singular `/api/v1/intake` but API mounted only plural `/api/v1/intakes`. Coordinator reports the singular alias was added by639caf4; executable alias/browser recheck remains pending. Material intake review fields and external contacts have also received frontend fixes that require integrated verification.
