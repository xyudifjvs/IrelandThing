# Client checklist sharing services

Implemented in the services builder worktree; hosted rollout is not asserted. No provider, mailbox, Stripe, AI, Railway or production database was accessed.

## Routes and domain services

- `GET /api/v1/matters/:id/checklist-share` → `{active,id?,createdAt?,expiresAt?}` via `getChecklistShare(actor,matterId)`.
- `POST` same path, `{}` or `{expiresAt:ISO timestamp}` → `{active:true,id,createdAt,expiresAt,url}` via `createChecklistShare`. Each creation atomically replaces the prior secret and changes the metadata ID, allowing open controls to discard an old URL even when rotations share a timestamp. Default lifetime is 30 days; explicit expiry must be future and within one year.
- `DELETE` same path → `{active:false,revoked:true}` via `revokeChecklistShare`, idempotently.
- `GET /api/public/checklist`, `Authorization: Bearer <token>` → `{matter:{id,title,propertyAddress,stage},tasks:[{id,title,status,dueDate,position}],deadlines:[{id,label,date}]}` via `getPublicChecklist`.
- `POST /api/v1/matters/:id/tasks/reorder`, `{taskIds:[complete canonical task set],expectedRevision:matter.revision}` → `{id,revision}`. Coordinator only; exact-set validation and revision conflict protection. PATCH task `position` also moves a task to a zero-based canonical index, shifts siblings and increments affected task revisions.

`createPublicChecklistRouter` is exported for root API mounting. `checklistPrivacyHeaders` must be mounted before the public rate limiter/authentication boundary so all failures, including 429, retain no-store/noindex/no-referrer headers. The authenticated matters router itself applies those headers. Root owns API mount, public abuse limits, web proxy, UI polling, API/MCP record integration and their acceptance checks.

## Persistence and authorization

Migration `20261022014500_client_checklist_sharing` adds `Task.position`, with deterministic `(createdAt,id)` backfill per matter, and `ChecklistShare`. A unique `matterId` ensures one canonical link row per matter. Schema fields are `id,matterId,tokenHash,issuedById,createdAt,expiresAt,revokedAt`; only a SHA-256 hash of a random 32-byte base64url secret is stored. The only returned bearer value is the generated URL, with the secret in its fragment (`WEB_ORIGIN/checklist#token`). Production origins require HTTPS; loopback HTTP is accepted for local preview. Link audits contain only action, IDs and expiry, never token, hash or URL.

Current coordinators and authorized matter agents may manage links. Clients and unrelated agents are denied. Every public read uses one repeatable-read PostgreSQL snapshot, checks expiry/revocation, reloads the issuer's current role and latest account access-revocation event, checks current `requireMatter` membership/assignment, and matches existing session access gates: outside nonproduction local development, agents need an approved signed agreement or the existing explicit access override, and coordinators need MFA enabled. No anonymous mutation route exists. Invalid, malformed, revoked, expired and no-longer-authorized links return the same generic 404. Public and authenticated noncoordinator task positions are dense zero-based positions among visible tasks only; SQL still sorts by canonical position, but hidden task counts and movement are not encoded in the public metadata. Explicit `visibility='client'` is the sharing boundary, including custom task kinds; task kind/details, every note/document/contact and proposed/unknown dates are absent. Confirmed dates without a calendar date are omitted.

All task mutations now advance matter revision, preserving concurrency safety for full reorder. Fresh task order is explicit in coordinator, agent, authenticated client and public queries. New workflow tasks have explicit positions; new manual tasks append.

## Builder verification

- Prisma generation succeeds with the changed schema.
- All ten migrations apply successfully to new disposable local PostgreSQL `weatherly_checklist_services_test`.
- TypeScript passes using isolated local workspace package links and a locally generated Prisma client. Shared root dependency generation caused transient schema collisions during development; the final builder check uses its own generated client and does not change the root client. Integration must generate from the combined root schema, preserving concurrent document-upload fields.
- Focused sharing tests: 12/12 pass. They exercise hash-only persistence/audit, role and matter privacy, current projections after coordinator changes, revoked visibility, rotation/expiry, concurrent rotation, account/role/membership withdrawal, agreement/override/MFA withdrawal and the bounded local bypass, stable order and stale-write rejection, read-only HTTP, generic errors and privacy headers.
- Matter + identity regression run: 23/24 pass. The remaining existing identity test hardcodes matter revision 1 after task creation/title editing and later hardcodes revision 3. With intentional matter revision advancement on task mutations those values are stale; root must update the test to fetch the current matter revision, then use the accepted revision plus the following deadline change. The observed service response is a correct 409 revision conflict.

These are builder checks, not independent review. Root/check team owns simultaneous browser-view/reconnect acceptance and exact integrated commit verification. Migration deploy, HTTPS `WEB_ORIGIN`, matching public web proxy/security headers, and the approved Railway rollout remain necessary before external client links are usable.
