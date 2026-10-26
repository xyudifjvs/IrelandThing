# B01 services contract v1

All API responses contain raw JSON. Validation errors are handled by the application error handler; authorization errors use HttpError with stable codes. List endpoints cap results at 100 or 200. Every overwrite requires `expectedRevision` (positive integer). A stale revision yields 409. Contract dates are real YYYY-MM-DD strings; appointments are ISO timestamps with offset and IANA timezone.

## Mounting

- `createAuth({sendSystemEmail?})`, `authHandler(auth)`: mount Better Auth at `/api/auth/*splat` **before** Express body parsing. Password reset delivery requires injected `sendSystemEmail({to,subject,text,purpose:'password_reset'})`; no direct email provider is used.
- `sessionMiddleware(auth)`: mount after parsing and before domain routers. Reads real Better Auth sessions, reloads user role, and checks account revocation. Authenticator enrollment is optional. Enrolled accounts still complete Better Auth second-factor verification at sign-in. Agent agreement enforcement bypasses only when APP_ENV=local and NODE_ENV is not production. Production requires a strong BETTER_AUTH_SECRET and private S3 storage. No fabricated session/JWT path exists.
- `createIdentityRouter(auth)` at `/api/v1`; `createMattersRouter()` at `/api/v1/matters`; `createDocumentsRouter(store?)` at `/api/v1/documents`; `createIntakeRouter()` at `/api/v1/intake`; `createOnboardingRouter()` at `/api/v1/onboarding`.
- All routers require session-derived Principal for business records. The only unauthenticated writes are inquiries and invitation-token account registration; raw public signup is disabled. Application owner must rate-limit public inquiries; registration has its own limiter.

## Identity

Better Auth owns `/api/auth/sign-in/email`, `/sign-out`, `/request-password-reset`, `/reset-password`, `/two-factor/enable`, `/two-factor/verify-totp`, `/two-factor/disable`, session cookies, challenge cookies and recovery tokens. Password policy is 12–128 characters. Enabling TOTP returns `totpURI` and backup codes; verification rotates the session cookie. A sign-in challenge supplies `twoFactorRedirect` and cannot access business data before verification.

- GET `/session`: `{user:{id,name,email,role,brokerage,twoFactorEnabled},session:{id,expiresAt},mfaRequired:false}`.
- GET/PATCH `/profile`: patch `{name?,brokerage?}`; cannot set role/email/MFA flags.
- GET `/users`: coordinator only, profile projections without credentials.
- POST `/invitations`: coordinator `{email,role:'agent'|'client',matterId?,agreementId?,approvalOverrideReason?,expiresInHours?:72}`. Agent requires an approved agreement with signed document evidence or an explicit exception reason of at least 10 characters. Returns one manual-delivery acceptanceToken; no email is sent.
- POST `/invitations/register`: public `{token,name,password}`. Atomically consumes valid token, registers a credential account using Better Auth's password hashing, applies agreement approval, optionally grants matter access, and returns `{registered:true,email}`. It creates no homegrown session: user signs in through Better Auth.
- POST `/invitations/accept`: signed-in matching account `{token}`. Tokens expire, are single-use, and cannot downgrade a coordinator.
- POST `/users/:id/access`: coordinator `{enabled:boolean,reason}`. Durable revocation/restoration audit, all current sessions invalidated; revocation checked again on future access. Self-revocation rejected.
- POST `/sessions/revoke`: `{sessionId}` only caller's session.

Agreement may initially use the invited normalized email as `userId`, before the account exists. Accepted invitation remaps it to the new stable user ID. An explicit exception creates `agent.access_override` audit evidence. Signed approval or exception is checked for agent business access outside local preview. Existing unapproved agent accounts can still view session/profile to complete onboarding.

## Matters and workflow

`Matter`: id/title/propertyAddress/side/packageCode/stage/agentId/revision/details/timestamps. Package codes essentials, complete, full_listing. Stages listing → under_contract → closing → closed → archived; termination/archive branches allowed by service. Listing conversion preserves matter ID/history. No dates are invented.

- GET `/matters?q=&stage=`: base rows plus permitted tasks/deadlines; coordinator all, assigned agent or active participant only. Client projection excludes intake details/assignment/package and internal task/deadline details.
- POST `/matters`: coordinator `{title,propertyAddress,side:'buyer'|'seller',packageCode,agentId?,details?}`. Full Listing seller-only. Agent assignment must reference an agent user.
- GET `/matters/:id`: permitted tasks, deadlines, notes, document metadata and participants. Clients receive only explicitly shared task/note/document data, confirmed deadline timeline and narrow matter fields. Coordinator notes never leak to agents/clients.
- PATCH `/matters/:id`: `{expectedRevision,title?,propertyAddress?,stage?,agentId?,details?}`. Coordinator only, revision CAS/audit.
- POST `/:id/tasks`: `{title,kind?:'checklist',status?:'pending',visibility?:'agent',dueDate?,details?}`. Status pending/received/proposed/completed/signed/not_applicable; visibility coordinator/agent/client.
- POST `/:id/deadlines`: `{label,date?:YYYY-MM-DD|null,status?:'unknown',sourceDocumentId?,details?}`. Status unknown/proposed/confirmed/rejected. Source document must belong to matter.
- POST `/:id/notes`: `{body,visibility?:'coordinator'}`.
- PATCH/DELETE `/:id/tasks|deadlines|notes/:childId`: `{expectedRevision,...supplied fields}` (DELETE expectedRevision only). All coordinator-only. Partial updates preserve omitted status/privacy/details. Deadline manual corrections mark manualOverride; full before values persist in audit.
- POST `/:id/participants`: coordinator `{userId,role:'agent'|'client'}`; existing grant can be restored. DELETE `/:id/participants/:participantId` revokes grant. Every subsequent read rechecks grant.
- GET `/:id/activity`: coordinator audit history.

Shared exports: matterScope, requireMatter, listMatters, getMatter, createMatter, updateMatter, addTask/addDeadline/addNote, updateTask/updateDeadline/updateNote, deleteTask/deleteDeadline/deleteNote, audit, dateOnly, revision.

`applyReviewedFacts(actor,matterId,{expectedRevision,deadlines:[{label,date,sourceDocumentId,sourceQuote,overrideManual?:false}],facts?,reason?})`: coordinator only, one transaction and matter revision CAS. Every quote must match normalized text in the latest stored document version on this matter. Confirmed dates retain source version/quote/reviewer/reason and full prior audit history. Existing manual override requires explicit overrideManual true. Any evidence/revision failure rolls back the entire proposal. Other modules call this service rather than writing deadline tables.

## Documents

- GET `/documents?matterId=`; GET `/documents/:id`: authorized metadata/version history, extracted text/pages on individual detail. Object storage keys are never returned.
- POST `/documents` multipart `{file,matterId?,visibility?:'agent',category?:'contract'}`. Draft upload can omit matterId and is visible only to its uploader/coordinator. Clients cannot upload. Only coordinator may choose client/private visibility.
- POST `/:id/versions` multipart `{file,...optional same metadata}`: uploader or coordinator; same file format only. Immutable original bytes, SHA256 checksum and monotonically increasing version. Concurrent revision collision yields409.
- GET `/:id/download?versionId=`: authorization before object read, matching document/version, checksum validation, private no-store attachment and nosniff.
- PATCH `/:id`: coordinator `{expectedRevision,visibility?,category?}`.

PDF/DOCX max20MiB; DOCX archive <=2000 entries and <=60MiB expanded; PDFs <=250pages for extraction. Invalid formats rejected; `.doc` returns415 CONVERSION_REQUIRED with save-as instructions. PDF extraction returns physical page numbers. DOCX raw text has document-level anchors and explicitly no fabricated physical pagination. Scans retain original file and `needs_ocr` with actionable message. Parse errors persist as failed, never claimed complete. No AI/OCR provider is called. Local object store uses private permissions under ignored .local/objects; production fails closed without S3. Railway bucket controls at-rest encryption; no unsupported SSE request header is sent.

Shared exports: ObjectStore, createObjectStore, listDocuments, getDocument, uploadDocument, extractDocument.

## Intake

- GET/POST `/intake/drafts`: POST `{payload:{...partial draft}}`; GET caller's drafts (coordinator all).
- GET/PATCH `/drafts/:id`: patch `{expectedRevision,payload}` complete draft snapshot. Submitted drafts immutable.
- POST `/drafts/:id/submit`: `{expectedRevision,idempotencyKey}` (8–150 characters) → `{submission,matter}`. Same-key concurrent/repeated delivery returns same receipt/matter. Different key on submitted draft409. All records/tasks/deadlines/document assignment/submission/audit/outbox event commit atomically.

Payload shape is exported as `intakePayload` Zod schema and `IntakePayload` type. Fields:

- packageCode, side, propertyAddress, purchaseType cash/financed, contractSource upload/dotloop/not_yet_executed, documentIds[], dotloopLoopId?
- clients:[{name,email,phone,relationship?}], relationship?, directContact copy_agent/through_agent
- title:{choice:have/listing_agent/mls,name?,email?,phone?}; lender?:{choice:have/dotloop/buyers_agent,name?,email?,phone?}
- hoa:none/received_sent/mls_dotloop_send/request_listing_agent/agent_will_email/sent_buyers_agent/seller_will_email; priorPolicy?:not_applicable/dotloop_send/request_sellers/agent_will_email
- broker?:{name,email,pre1978,ownChecklist,checklistDocumentId?}; required for Complete/Full Listing, optional Essentials
- notes, gift:{requested,tier?:classic/signature/luxury,choice?,personalization?,deliveryAddress?}, linkedMatterId?

Server rejects incoherent branches: cash+lender; buyer Full Listing; contractless Essentials/Complete; Essentials Dotloop; wrong-side HOA/title/lender/prior-policy; stale gift/contact/contract-source fields. Uploads must belong to submitting user and be unassigned. Separate opposite-side linked matters require same property. Title/lender/HOA/prior-policy/compliance/financed evidence answers generate follow-up tasks. Draft snapshot preserves contact restrictions and gift personalization without inventing gift prices.

Transactional outbox event topic `intake.submitted`, key `intake-submitted:<submissionId>`, payload `{matterId,submissionId}`. Integration owner must register consumer(s) for gift request and Dotloop retrieval if using it. Task generation is real; saving a Dotloop choice alone is not proof of an imported contract or a gift ordered.

Shared exports: intakePayload, saveIntakeDraft, submitIntake.

## Onboarding

- POST `/onboarding/inquiries`: public `{name,email,kind:contact|meeting|information,payload:{phone?,brokerage?,message?,meetingTime?,timezone?}}`; meeting requires offset ISO timestamp plus IANA timezone. Saves a request, not a booked appointment.
- GET `/inquiries` and PATCH `/inquiries/:id`: coordinator `{expectedRevision,status:new|contacted|meeting_requested|meeting_confirmed|agreement_sent|approved|closed}`.
- GET `/agreements`: coordinator all, others own only.
- POST `/agreements`: coordinator `{userId,version,status?:draft|sent|received|approved,documentId?}`. userId may known user ID or normalized invited email. Received/approved requires an existing signed evidence document reference.
- PATCH `/agreements/:id`: coordinator `{expectedRevision,status,documentId?}`; same evidence rules and audit.

Shared export createInquiry.
