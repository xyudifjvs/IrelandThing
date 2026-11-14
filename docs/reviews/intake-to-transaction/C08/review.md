# C08 independent roster review

**Accepted for local integration at `ebdbf5abbdf693d6b7155425034bd0c55107c57a`.** All three prior findings passed independent recheck.

- I imported multiple valid legacy invitations for the same recipient and resent the invitation for one file using a real coordinator session. Resend kept that invitation's original approval and file, and retired both older tokens for that file. The already imported invitation for the other file kept its original expiration and stayed usable. Accepting the replacement gave access only to its original file. The other file became accessible when the recipient separately accepted its own invitation. Both tokens rejected replay.
- The recipient received 403 when attempting to resend, both as a client before acceptance and as an agent afterward. The website inquiry path also passed again, including preservation of unrelated file, role, email and roster invitations. Active and progressed archive protection, agreement-only import and registration, and coordinator-only download passed on the same commit.
- All 33 identity, onboarding and Calendly checker tests passed on disposable PostgreSQL after all 19 migrations. TypeScript and `git diff --check` passed. The verified membership checkpoint `6a0206d5ac5f261e8f0b45a6850280c89e74c8db` remains available to C05 and C06.

Independent evidence is in `/private/tmp/weatherly-r08-probe/accepted.mts`, `accepted.log`, `accepted-suite.log`, and `accepted-typecheck.log`. The checks used synthetic accounts and loopback services. Live provider setup and verification remain on Ireland's laptop.

## Previous recheck on `c6c15ec`

The same-email website inquiry supported resend at `c6c15ecabb584f3693e90c57b2200b72b49972e5`. The distinct-file finding below is resolved at `ebdbf5a`.

## Finding on `c6c15ec`

1. **P2. Resending an imported invitation cancels a separate pending invitation for another file.** Using a coordinator's Better Auth cookie, I issued two valid legacy agent invitations to the same recipient for different files. Importing the latest invitation linked both invitations to the roster, which is how `packages/onboarding/src/roster-write.ts:251` collects legacy records. The roster resend retained the latest invitation's approval and file. It also expired the earlier invitation to the other file because `packages/identity/src/invitation-routes.ts:165` retires every token linked to the roster even when the file target differs. Match the selected invitation's file when expiring tokens, in addition to the existing recipient, role and roster checks.

## Independent recheck of `c6c15ec`

- A same-email website inquiry can now resend the matching unbound legacy invitation. The replacement kept the original audited exception and original file. The old token and a duplicate for the same file were rejected. The intended recipient accepted the replacement once with a real session and could read only its original file. A separate unbound legacy invitation for a different file stayed valid and granted that file only when separately accepted. Invitations issued to a client role, another email, or a different roster stayed open.
- The active and progressed inquiry archive controls, agreement-only import and registration, ordinary invite-only resend, and coordinator-only agreement download all passed again. The independent suite passed 33 tests on disposable PostgreSQL after all 19 migrations. TypeScript and `git diff --check` passed.
- **Membership checkpoint `6a0206d5ac5f261e8f0b45a6850280c89e74c8db` remains verified for C05 and C06.** The membership module is byte-identical to the reviewed checkpoint in C08 and in the C05 and C06 worktrees. Synthetic role, HTO access, revocation, and Weatherly agreement tests passed against the current C08 candidate. The invitation retirement finding is outside that membership module.

Evidence is in `/private/tmp/weatherly-r08-probe/final.mts`, `final.log`, `final-suite.log`, and `final-typecheck.log`. All checks used synthetic fixtures on loopback.

## Previous recheck on `6563a63`

Both original findings passed the independent recheck at `6563a63405c96865949a4115b13de88b75fb6f8d`. The finding below is resolved at `c6c15ec`.

## Finding on `6563a63`

1. **P2. A matching website inquiry prevents the roster from resending a legacy invite with audited approval.** I used a coordinator's Better Auth cookie to create a legacy agent invitation with a documented approval exception and an original file. A later website inquiry with the same normalized email created a roster entry. The coordinator read returned the entry as `invited`, with `source: null` and no import action, but the normal roster resend returned 422 `AGREEMENT_REQUIRED`. The legacy token remained unbound. `packages/onboarding/src/roster-read.ts:261` recognizes an unbound invitation by matching email; `packages/identity/src/invitation-routes.ts:91` considers only invitations already linked to the roster when recovering prior approval. Under the normalized email lock, recognize same-email unbound agent invitations as well as those bound to the selected roster, retain their original authorized file scope, and retire the replaced token. Do not select a prior invitation bound to a different roster or issued to another role.

## Recheck of original findings

- The coordinator's archive request returned 409 `INQUIRY_ARCHIVE_ONLY` for the unlinked same-email Active legacy agent, which retained its existing login and roster entry. An inquiry advanced through the old agreement-sent endpoint returned the same conflict even with an unchanged roster revision. An unadvanced inquiry could still be archived.
- An uppercase legacy agreement-only recipient appeared as Agreement signed. The coordinator could read the original document reference, import it twice to the same roster ID, issue an invite, and register. Password sign-in worked, the existing agreement attached to the new account, and the original document ID, version and approval status remained unchanged.
- A legacy invite-only recipient appeared as Invited. The coordinator imported the invitation, replayed the import safely, and resent it. The prior token failed, a different signed-in recipient could not claim the new token, and the intended existing account accepted the replacement once. The original audited override reason and file were preserved. Supplying a different file on resend was rejected. The accepted account could read only the original file and gained no access to the other one.
- Agent and client cookies could not read roster records or agreements, import evidence, or download the signed file directly. The coordinator could download it with `private, no-store` through an injected synthetic object store. An anonymous download was denied.
- All 32 identity, onboarding and Calendly checker tests passed against a new PostgreSQL database with all 19 migrations. TypeScript, `git diff --check`, and a fresh Webpack production build passed. Chrome against the exact build and real synthetic API rendered the legacy agreement and download link, imported the entry, hid archive controls for a progressed inquiry, fit a 390-pixel viewport, and kept the workspace private after sign-out and browser Back. A direct client visit reached the portal gate.

Recheck evidence: `/private/tmp/weatherly-r08-probe/recheck.mts`, `recheck.log`, `recheck-suite.log`, `recheck-typecheck.log`, and `recheck-build.log`. All checks ran on loopback; no live accounts or providers were used.

## Previous candidate

Reviewed membership checkpoint `6a0206d5ac5f261e8f0b45a6850280c89e74c8db` and candidate `f6214949999d6bd0b886d1846c132e707543bf54` in `/private/tmp/weatherly-handoff-c08`. The two findings below are resolved at `6563a63`.

## Findings

1. **P2. An active legacy agent can be archived as an inquiry.** The archive command in `packages/onboarding/src/roster-write.ts:270` checks the stored roster user ID and agreement email. The read model in `packages/onboarding/src/roster-read.ts:220` also resolves existing Weatherly logins by normalized email and their agreements by user ID. I signed in as a synthetic legacy agent with an approved agreement stored against that user ID, then submitted a website inquiry using the same email. The inquiry created an unlinked roster row, which correctly appeared as Active. A coordinator's direct archive request returned 200, the agent disappeared from the roster, and the original account still accessed protected routes with status 200. Resolve archive eligibility under the transaction using the same current account and progression evidence as the read model, including legacy sent-inquiry history. A stale coordinator action must receive a conflict after the signup has advanced.
2. **P2. Existing agreement-only signups disappear from the replacement roster.** The candidate generator in `packages/onboarding/src/roster-read.ts:180` starts from saved roster entries, agent users, inquiries, and bookings. The previous Onboarding page listed signed agreements recorded directly against a recipient email. I recorded an approved legacy agreement for an email with no account, inquiry, or booking. The coordinator's agreements API retained the signed evidence, but the roster API returned no row for the recipient. Include the existing signed-agreement and unaccepted agent-invite evidence when reconstructing legacy signups. Provide an import path so the coordinator can open the evidence and send or resend an invitation from the roster.

## Verified locally

- TypeScript and `git diff --check 7d39a92..f621494` passed. The independent Webpack production build passed.
- All 29 identity, onboarding, Calendly webhook, and scheduling checker tests passed on a new disposable PostgreSQL database with all 19 migrations. The fixture signatures and provider configuration were synthetic.
- A separate HTTP harness used real Better Auth credentials and cookies. Coordinator roster and agreement reads succeeded. Agent and client attempts at coordinator-only reads returned 403. A mismatched roster role and another signed-in recipient's attempt to claim the invite were rejected. Resending retired the previous token. Reclassifying the invited HTO lead as Weatherly prevented acceptance without approved evidence and rolled back account creation. Changing it back allowed the same unconsumed token to register exactly once.
- The HTO account signed in with MFA off, passed the protected route, and persisted its phone. Revocation invalidated its prior session and denied a fresh session. A role change to client removed HTO membership. A legacy Weatherly account retained password-only access through its approved agreement.
- Headless Chrome checked the exact production build against the real synthetic API. The previous route reached the roster, the direct roster response carried no-store, and a coordinator created a name-only HTO entry. The detail omitted service agreements for that entry. The page fit a 390-pixel viewport. After sign-out and Back, the old roster content was absent, with back-forward cache enabled in Chrome. A client cookie received the portal gate on a direct roster visit.

Synthetic harness and test evidence are in `/private/tmp/weatherly-r08-probe/`. All browser and API checks used loopback and synthetic records. Live account setup and verification remain on Ireland's laptop. The navigation mount and real invitation delivery adapter remain integration work.
