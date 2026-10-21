# B04 communications contract v1

Mount `createCommunicationsRouter(service?)` at `/api/v1/communications` after session middleware. Exported `createCommunicationsService({config?,provider?,fetch?})` supports independent provider tests; normal runtime uses official Google OAuth2Client and Gmail REST, never a fake success fallback. B08 can call exported `listMessages(actor,matterId?)`, `listThreads(actor,matterId?)`, `connectionStatus(actor)` and `sendSystemEmail(input)`.

All business mutations require a current coordinator Principal. Agents/clients see only explicitly shared messages on authorized matters. Associating a Gmail thread with a matter does not share its content. Inbound body/headers are untrusted evidence and never authorize task changes, sends or model instructions. Candidate matching is literal property-text matching, held for coordinator review. No sender automatically completes work.

## Setup and status

- GET `/status` → safe configuration/connection/freshness/watch/import fields; no credentials.
- GET/POST `/connect` → `{url}` using offline consent, readonly+send scopes, state hash, encrypted PKCE verifier, ten-minute expiry.
- GET `/callback?state=&code=`: signed-in same coordinator required, atomically consumes one-use state, exchanges code, verifies both granted scopes and exact configured mailbox, requires refresh token, encrypts credentials, queues sync/renew.
- POST `/disconnect`: clears local credentials and cancels pending owner mailbox jobs; attempts provider revocation. If provider revocation fails, local access is still removed; account-side revocation may be needed.
- POST `/sync` queues a durable job.
- POST `/push`: verified Google ID token, exact configured audience/service-account identity, configured mailbox, deduplicated Pub/Sub message ID; queues sync only. No business Principal is taken from push content.

Required configuration: GMAIL_ENABLED=true, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REDIRECT_URI, GMAIL_MAILBOX, CREDENTIAL_ENCRYPTION_KEY (32 bytes base64). `ireland@ireland.com` is always rejected as a real connection/send mailbox. Sending additionally requires OUTBOUND_EMAIL_ENABLED=true. Historical import additionally requires explicit GMAIL_IMPORT_QUERY (approved Gmail query, or `all` only when whole-mailbox import is approved). Optional watch: GMAIL_PUBSUB_TOPIC, GMAIL_PUBSUB_AUDIENCE, GMAIL_PUBSUB_SERVICE_ACCOUNT. No account provisioning or provider calls occurred during this build.

## Messages and reviewed association

- GET `/threads?matterId=` and GET `/messages?matterId=` return raw arrays. Coordinator sees mailbox records; agent/client query filters authorized matter IDs and message visibility. Client projections exclude internal metadata and HTML.
- PATCH `/threads/:id` `{expectedRevision,matterId:string|null}`: reviewed association, revision CAS, attachment association through document service, audit. It cannot move previously associated evidence silently to another matter.
- PATCH `/messages/:id` `{expectedRevision,visibility:coordinator|agent|client}`: explicit sharing, matter association required for nonprivate visibility, CAS/audit. Imported/sent messages default coordinator-only.

## Drafts and sending

- GET `/drafts?matterId=`.
- POST `/drafts` `{matterId,to:string[],cc?:[],subject,body,attachmentIds?:[],templateId?,templateRevision?,replyToMessageId?}`.
- PATCH `/drafts/:id` `{expectedRevision,to?,cc?,subject?,body?,attachmentIds?}`. Omitted fields remain unchanged. Queued/sent drafts immutable.
- DELETE `/drafts/:id` `{expectedRevision}` cancels a saved unsent draft.
- POST `/drafts/:id/send` `{revision,confirmed:true}`: explicit coordinator approval, durable approved snapshot of recipients/body/attachment versions/checksums, CAS+outbox in one transaction. Same-key duplicate approval returns existing queued/sent state. It performs no synchronous send.
- POST `/drafts/:id/reconcile` `{expectedRevision,confirmed:true}`: for sending/delivery_unknown only, searches SENT by deterministic RFC Message-ID and validates exact metadata before marking sent. No automatic resend is authorized when evidence is absent/ambiguous.

Recipients must already be saved intake clients, assigned agent, or matter.details.contacts (name/email/role). Through-agent policy blocks client addresses in To and CC. Copy-agent policy inserts the assigned agent into the saved preview. Policy is revalidated both at approval and immediately before dispatch. Unknown recipients require adding a reviewed contact first. Contacts never grant portal access. Header injection, unresolved merge fields and cross-matter attachments/replies are rejected.

Sending job claims queued→sending before provider dispatch. Success persists provider message, immutable approved history and audit. A crash/ambiguous timeout after dispatch becomes delivery_unknown; retries cannot send again. Provider acceptance is not proof of delivery to the recipient inbox. The reconciliation endpoint resolves provider-side evidence without a second send.

## Templates and recovery

- GET `/templates?includeInactive=true`; POST `/templates` `{name,side:buyer|seller|both,phase,subject,body}`.
- PATCH `/templates/:id`: complete template fields plus expectedRevision; creates a new immutable row/revision and deactivates prior version. Existing drafts/sent snapshots stay unchanged.
- POST `/templates/:id/render` `{matterId,values?:{recipientName?:...}}` → `{subject,body,templateId,templateRevision}`. Known keys propertyAddress, agentName, agentEmail, clientNames, closingDate, packageName, recipientName, coordinatorName. Contract-derived closingDate requires a confirmed saved deadline; unresolved/unknown fields fail validation.
- `sendSystemEmail({to,subject,text,purpose:'password_reset'})` queues idempotent `system.email`. Requires configured outbound flag, RESEND_API_KEY and SYSTEM_EMAIL_FROM. Root injects this function into createAuth. Recovery delivery uses Resend only when explicitly configured.
- GET `/notifications`: coordinator job status projection, excludes notification text/reset URLs and credentials.

## Worker registration

`createCommunicationJobHandlers(service,{store?})` returns mapping topic→async(payload):

- gmail.sync `{ownerId}`: bounded/paginated full import, history updates, expired-history404 full-resync recovery, idempotent provider message IDs, preserved source/deletion metadata. One expiring owner sync lease prevents duplicate attachment ingestion; heartbeats during processing. Periodic polling queued at five minutes, even when watch is available.
- gmail.send `{ownerId,draftId,sendKey}`: approved snapshots, source versions, MIME via Nodemailer with file/URL access disabled, deterministic Message-ID, safe uncertain-delivery state.
- gmail.renew `{ownerId}`: renews configured watch daily using expiration returned by Gmail. Without topic, reports polling mode.
- system.email `{to,subject,text,purpose}`: Resend delivery with idempotency header.

Attachments use canonical document upload/association/read services. PDF/DOCX and safe PNG/JPEG/TXT/CSV originals are retained privately. Images report needs_ocr; no OCR/AI provider is called. Unsupported or oversized attachment types retain actionable failed-import metadata and Gmail source identity; they are not falsely reported saved.

## Validation and limits

`npm run typecheck` passes. `DATABASE_URL=<synthetic-local-db> npm test -- packages/communications/test/communications.test.ts packages/identity/test/services.test.ts` passes13/13 scenarios across two suites. B04 six scenarios use real PostgreSQL and entirely fake provider boundaries; no email/account/network operation is performed. Tests cover placeholder/config failure, scope/state identity/reuse and encryption, recipient isolation/copy policy, concurrent approval single job/send, immutable drafts, uncertain send no retry, policy changes before dispatch, paginated MIME/real attachment import, concurrent sync lease, no instruction-triggered workflow changes, reviewed sharing, expired cursor recovery, template versioning/missing values, watch renewal and idempotent mocked recovery delivery.

Live Google consent/restricted-scope verification, historical import approval, actual Gmail account, Pub/Sub IAM/JWT issuer, real watch renewal, S3 and real Resend DNS/delivery remain unverified external prerequisites. Readonly Gmail scope is restricted and server storage may require Google's verification/security assessment. No provider approval or live deployment is claimed. Independent R04 review remains required.

Primary references consulted: https://developers.google.com/workspace/gmail/api/guides/sync ; https://developers.google.com/workspace/gmail/api/auth/scopes ; https://developers.google.com/workspace/gmail/api/guides/push ; https://developers.google.com/identity/protocols/oauth2/web-server ; https://developers.google.com/workspace/gmail/api/guides/sending . Security workflow applied from agent-email-inbox and email-best-practices skills, with existing user instruction prohibiting account connection/email sends taking precedence over optional skill setup questions.

## Dynamic dates and draft refresh (v1.1)

GET `/merge-fields?matterId=` lists safe `{key,label,value,status,sourceIds}` including all named milestone aliases, `deadline_<normalized_label>`, `date_<workflow_key>`, and `task_<normalized_title>`. Unknown/proposed dates remain unknown; conflicting confirmed dates are ambiguous and cannot render. Custom template fields become available from saved workflow snapshots/task dates. The server does not invent or accept client-supplied overrides of business facts through merge values.

When saving a template-bound draft, pass `templateValues` matching render values. Generated subject/body snapshots are saved. `refreshTemplateDrafts(tx,actor,matterId)` is exported for the parent to inject with `registerMatterChangeHook(refreshTemplateDrafts)` in API and worker runtimes. All changes happen in the same matter/deadline transaction. Unchanged generated fields refresh; human-edited fields remain intact and get `reviewNeeded`/override flags. Queued/sent messages stay immutable. POST `/drafts/:id/reset-template` `{expectedRevision,values?}` restores generated fields. Approved template drafts snapshot source deadline/task revisions; dispatch refuses dates changed after approval.

Combined real PostgreSQL suites now pass16/16, including confirmed custom workflow dates, unknown/ambiguous values, automatic draft updates, hand-edit preservation, reset-to-template and queued-date invalidation. Independent rematch privacy regression also passes. Deadline mutation increments matter revision so stale AI proposals cannot overwrite a changed contractual timeline. Parent owns rules.ts and must register the callback in both application entrypoints.
