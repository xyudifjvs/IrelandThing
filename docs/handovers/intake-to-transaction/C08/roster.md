# C08 roster and onboarding handoff

The workspace page is `/workspace/roster`. The previous onboarding route redirects there. C00 owns the navigation item. C12 can link to an entry at `/workspace/roster?agent=<id>`.

`createOnboardingRouter()` exposes coordinator-only roster commands under the existing `/api/v1/onboarding` mount. `listRoster(actor)` returns sorted summary records. For C11, use saved entries with `business === "hto"` and a nonnull `revision`. For C12, filter the Weatherly list to `inquiry`, `agreement_sent`, `agreement_signed`, or `invited` and use `phaseOn`. Existing users and older inquiry, booking, agreement, or unaccepted agent invitation records remain visible. A coordinator action materializes a legacy entry before editing it.

## Identity and history

`getAgentMembership(userId, tx?)` from `@weatherly/identity/membership` supplies current membership and a stable roster ID for new work. A linked, unarchived roster and a current agent account are required for HTO access. A roster lead, email match, or name-only team entry cannot bypass the agreement requirement. The same module exports `hasAgentAgreementAccess(userId, tx?)` for consumers that need the current agreement gate. Consumers still check current role, account revocation, and file access. `/session` and `/profile` include membership and phone for agents. Historical file business and prices remain separate from current roster membership.

Signup evidence comes from stored inquiries, signature and invitation records, verified Calendly bookings, and current account access. Distinct inquiries and bookings stay available even when they refer to the same person. Resend replaces the previous unaccepted roster token and acceptance rechecks current membership. Signed agreement replacement creates a new agreement row and a new private file. C08 locks all selected evidence Document rows before validating privacy and committing. C06 must lock the same rows before versioning, sharing, or association changes and preserve attached agreement files.

The archive command reuses roster eligibility under the roster and normalized email locks. Account lookup and prior signup evidence can disqualify an inquiry even when a legacy write has left the roster revision unchanged. An imported invite can be resent with its previously audited approval and file scope.

The written handoff provides the initial HTO names. Enter them as name-only HTO records through Add agent during setup. Use confirmed contact information when available. These names and the mockup’s contact examples are not test fixture data.

## Account connections

`createIdentityRouter(auth, { queueAgentInvitation })` can receive an optional in-transaction callback. It takes the transaction and an invitation with `id`, `email`, `expiresAt`, and `acceptanceToken`. Return true after recording a durable job or false if queueing is unavailable. C07 owns the system-mail adapter and worker. It must discard expired or superseded invite jobs and protect token contents. Keep the existing manual-link flow while system mail is unconfigured. The UI reports a queued invitation or a link ready to share.

`recordAgreement(actor, input)` is the same audited, idempotent command used by signed upload and available to a future verified signer adapter. Supply the authenticated coordinator and use a stable request UUID for a verified event. A concrete signer and its verification configuration are account-dependent. All real provider activation and verification remain on Ireland’s laptop.

## Local verification

TypeScript and the Next Webpack production build passed. All 32 identity, onboarding, and Calendly checker tests passed against PostgreSQL with all 19 migrations. The suite exercised actual synthetic login, HTO invite replay and concurrent acceptance, Weatherly agreement enforcement after reassignment, historical file business, contact phone storage, signed evidence replay, coordinator-only agreements, and signed Calendly delivery deduplication. It also verified that active or progressed legacy agents cannot be archived and that agreement-only and invite-only recipients can continue signup from the roster.

The headless Chrome roster smoke used mocked API responses with the production web build. It checked search, recorded sent date, file links, a name-only HTO entry, 390-pixel width, and private content after sign-out followed by browser Back. The authenticated API tests above exercised the server separately.
