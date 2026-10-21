# Weatherly technical plan

Use a single durable system of record, shared business services, and thin web/API/MCP interfaces. A coordinator action and an assistant query must operate on the same authorized records. This is the architecture baseline for the [scope](PROJECT_SCOPE.md) and [agent work packages](IMPLEMENTATION_PLAN.md); the application has not yet been implemented.

## Recommended application structure

| Component | Responsibility | Proposed technology |
| --- | --- | --- |
| Web | Public pages, account screens, coordinator workspace, agent/client portals | Next.js and TypeScript with shared UI components |
| API | Versioned HTTP endpoints, webhook ingress, remote MCP | Node.js, Express, schema-validated contracts |
| Worker | File processing, synchronization, reminders, AI jobs, reconciliation | Separate Node.js process with a durable Postgres-backed queue |
| Database | Business records, access, audit, jobs, provider cursors | PostgreSQL and Prisma |
| Object storage | Originals, document versions, attachments, approved exports | Private Railway S3-compatible bucket |
| AI gateway | The only application path to model inference | OpenRouter with enforced ZDR |

Deploy web, API, worker, and database on Railway with separate staging and production environments. Start with one modular backend and one worker. Feature packages are code ownership boundaries, not independently deployed microservices. A Redis service is unnecessary unless measured queue or performance requirements justify it.

The firm dashboard currently demonstrates a useful pattern in [matterService.ts](</Users/carson/Repos/FF dashboard/server/src/lib/matterService.ts:7>) and [agent/tools.ts](</Users/carson/Repos/FF dashboard/server/src/lib/agent/tools.ts:10>): shared operations and a tool registry with authenticated identity supplied outside model input. Reuse the pattern. Its provider client and legacy machine authentication are not the Weatherly design. The inspected files establish an in-app tool architecture; they do not establish a ready-made remote MCP server for this project.

## Module boundaries

Each domain package exports validated contracts, authorized service methods, HTTP adapters, and job handlers as needed. Only the integration owner wires exports into application entrypoints. Frontends call the API; assistants call the same service methods through the tool registry. Business logic does not live in page components or get reimplemented in MCP handlers.

Only the database owner edits Prisma schema and migrations. Each domain owner controls its entities’ semantics and writes; other modules use its services. Cross-module changes use agreed transactions or durable events, not direct writes to another package’s tables.

Every contract defines stable IDs, actor/access context, validation, error codes, pagination where relevant, and source/freshness fields. Writes carry an idempotency key when retried and an expected revision when overwriting a record. Audit and outbound events commit with the business mutation. Provider delivery uses retryable jobs from that durable record.

## Data that must persist

| Record group | Required content |
| --- | --- |
| Identity and access | Users, sessions, invitations, roles, matter grants, revocation, assistant grants, access history |
| Business relationships | Agents, brokerages, clients, contacts, matter participants, contact restrictions |
| Onboarding | Inquiries, meeting requests, agreement versions, signature evidence, approval state |
| Intake | Saved drafts, validated submitted snapshots, package/side choices, every conditional answer, uploaded-file references |
| Matter | Property, represented side, lifecycle, linked matter, package snapshot, assigned parties, archive/termination history |
| Workflow | Checklist instances, template versions, deadlines, anchors, applicability, overrides, completion evidence, private tasks and notes |
| Documents | Original objects, immutable versions, checksum, origin, visibility, extracted text, page anchors, processing status |
| Communications | Threads, messages, participants, bodies, attachments, matter associations, drafts, sent snapshots, templates, delivery state |
| Money and gifts | Catalog and price versions, order line snapshots, Stripe references, payment/refund events, manual payment evidence, gift fulfillment |
| AI work | Task type, permitted source references, model/provider identifiers, prompt/schema version, proposal, review decision, accepted output, usage and cost |
| Reliability | Integration connections, encrypted tokens, sync cursors, webhook receipts, queued jobs, retries, dead letters, audit events |
| Assistant records | Authorized conversation history if retained, tool calls, answer citations, source revisions, access scope; no model reasoning traces |

Store actual original evidence and structured facts. A generated summary alone is not a substitute for an email, a contract, or an authoritative payment record. Search indexes are derived and rebuildable. Use PostgreSQL full-text search first; add embeddings only if the selected embedding path also meets the OpenRouter/ZDR requirement.

Use date-only fields for dates and explicit timezones for appointments and possession times. Preserve contractual wording, the anchor, and calculation rule for derived dates. Business-day and holiday rules need approved regional/brokerage configuration. Unknown dates remain unknown; amendments create reviewable revisions and do not erase manual overrides without an explicit decision.

## Identity and permissions

Use an established authentication library with secure cookies, session revocation, account recovery, rate limits, and MFA for Ireland. Google mailbox OAuth is separate from portal authentication: agents and clients do not need to grant access to their Gmail to use Weatherly.

| Caller | Access |
| --- | --- |
| Ireland | All Weatherly matters, private notes, business settings, integrations, payments, and audit |
| Agent | Assigned matters and explicitly permitted documents, timeline, messages, submissions, payments |
| Client | Narrow matter projection and explicitly shared files; authenticated or securely exchanged expiring invitation |
| Assistant | Intersection of its explicit scopes and the authorizing user’s current permissions |
| Worker | Narrow service identity and job-specific authorization; no arbitrary caller-supplied identity |

Enforce access before queries, search, snippet generation, exports, file URLs, and tool results. Recheck on each request after revocation. Clients never inherit full Gmail threads or coordinator notes merely because they are attached to a matter. Export and archive must preserve these boundaries.

## AI through OpenRouter only

ZDR eligibility is an endpoint policy, not a property inferred from a model name. Enable account/guardrail ZDR enforcement across all model groups, turn off prompt/completion logging and data-sharing opt-ins, and enforce request-level filtering. OpenRouter’s ZDR setting covers inference routing; it does not automatically cover plugins and tools. [OpenRouter ZDR documentation](https://openrouter.ai/docs/guides/features/zdr).

The gateway applies these provider settings server-side; callers cannot weaken them:

    provider: {
      zdr: true,
      data_collection: "deny",
      require_parameters: true,
      only: APPROVED_ENDPOINT_SLUGS,
      allow_fallbacks: false
    }

Model and endpoint selection are configured per task after capability and quality checks. An explicit retry may try another approved model/endpoint with the same restrictions. There is no direct-provider fallback and no automatic downgrade when compliant capacity is unavailable. OpenRouter documents these routing controls in its [provider selection reference](https://openrouter.ai/docs/guides/routing/provider-selection).

PDF handling needs particular care: OpenRouter may use a separate OCR engine when native PDF support is unavailable, and its old pdf-text engine redirects elsewhere. The proposed pipeline extracts text or renders pages inside Weatherly’s worker, then submits text/images through the approved gateway. Native PDF submission is allowed only after verifying the chosen endpoint and explicitly preventing a third-party parser fallback. [OpenRouter PDF documentation](https://openrouter.ai/docs/guides/overview/multimodal/pdfs).

Application controls:

- One gateway owns the OpenRouter key. Static and runtime tests reject alternate inference clients or endpoints.
- Disable server-side web search, file parsing, external tracing, and other content-forwarding plugins by default. Do not send matter content to a separate OCR, embedding, moderation, or reranking API to work around eligibility.
- Process original files privately; do not publish a document URL to make model access convenient. Remove temporary worker files after processing and cap input sizes and decompression.
- Retrieve only authorized, task-relevant evidence. Treat document/email instructions as untrusted content, never as permissions or system policy.
- Save business proposals and their evidence in Weatherly, but redact bodies, prompts, attachments, tokens, and secrets from operational logs and error reporting.
- Track cost, latency, model/provider, source IDs, and result status without duplicating confidential content into telemetry.
- If the approved endpoint is unavailable, preserve the queued work and show a clear retry/manual-review state. Do not silently claim extraction or analysis completed.

ZDR limits inference-provider retention. Weatherly intentionally retains authorized records for business use, so database, object storage, backups, access controls, and deletion still require their own policies. Build/check agents use synthetic or approved deidentified fixtures; selecting GPT-6.1 sol for coding does not authorize sending live client files to an uncontrolled assistant runtime.

### AI tasks and review

Contract extraction returns typed, nullable facts with document version, page/section, quote, and any ambiguity. The review screen shows the source beside the proposal. Acceptance calls the matter service with the reviewed revision; a newer amendment makes an older proposal stale.

Inbox analysis returns a suggested matter match and proposed changes, linked to message evidence. Only explicit approval applies consequential changes or sends correspondence. A suspicious instruction embedded in a contract or email cannot invoke a payment, disclose another matter, or send a message.

Answers use current database values for live status, deadlines, and payments and evidence retrieval for narrative questions. They cite the underlying file/message/record and expose sync age, unresolved conflicts, and missing facts. Do not let an old summary override a later signed amendment or confirmed record.

## API and MCP

Publish a versioned HTTP API and a remote MCP interface over the shared services. Domain owners implement their HTTP contracts; the assistant owner maps those same authorized operations to tools. Use a standards-compatible authorization implementation and validate the intended clients against current [MCP authorization requirements](https://modelcontextprotocol.io/specification/latest/basic/authorization).

| Read capability | Example API family | MCP tool examples |
| --- | --- | --- |
| Discover matters | /api/v1/matters | search_matters, get_matter |
| Workflow and private work | /api/v1/matters/:id/workflow | list_deadlines, list_checklist_items, list_tasks, list_notes |
| Evidence | /api/v1/matters/:id/documents | list_documents, search_documents, get_document_excerpt |
| Communications | /api/v1/matters/:id/communications | list_messages, get_thread, get_message |
| Payments and gifts | /api/v1/matters/:id/billing | get_payment_status, get_gift_status |
| Change history and freshness | /api/v1/matters/:id/history | get_matter_history, get_sync_status |
| Intake and onboarding | /api/v1/intakes and /api/v1/onboarding | get_intake, get_onboarding_status |
| Catalog and agreements | /api/v1/catalog and /api/v1/agreements | get_service_catalog, get_agreement_status |

This is a capability map, not a frozen endpoint specification. The foundation contract gate must define request/response schemas and enumerations before concurrent implementation. Provide paginated list and permission-filtered detail routes for business records, including drafts, AI proposals, and their review history. Protected credentials are never part of this read surface.

Tool results include record ID, matter ID, confirmed/proposed status, source references, revision, updated time, and integration freshness where relevant. Search resolves ambiguous names instead of guessing. “All matters” means all matters the caller is allowed to access. API/MCP parity tests compare records visible to the same actor.

Start external assistant grants read-only, because the stated requirement is questions and answers. App mutations still use authenticated write APIs. Future external writes need separate scopes, explicit action review, idempotency, and audit; they are not implied by a read grant.

**External assistant boundary:** after MCP returns content, Weatherly cannot control which model that external client uses. Only approve assistant deployments that also route client information through OpenRouter with enforced ZDR. A generic consumer assistant connection is not automatically compliant. Register approved clients, restrict scopes and audiences, revoke grants, and audit access; do not represent these controls as remote enforcement of the client’s model settings.

## Gmail and transactional email

Use OAuth for Ireland’s mailbox. Prefer gmail.readonly plus gmail.send when drafts live in Weatherly; request modify/compose only if the actual feature needs mailbox mutation or Gmail drafts. Reading/storing mailbox content invokes Google’s restricted-scope rules; verify the applicable private/internal exception or verification and assessment path for this deployment. Do not assume one operator automatically qualifies. [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

Use Google Cloud Pub/Sub notifications, persisted history cursors, and history/message fetches. Renew the watch daily; Google requires renewal at least every seven days. Run periodic reconciliation for dropped notifications and recover expired cursors with a bounded resync. Deduplicate events and messages, verify incoming notification identity, and record reconnect-needed states. [Gmail push guide](https://developers.google.com/workspace/gmail/api/guides/push).

Import only the agreed mailbox history, labels, or matter-associated set; do not indiscriminately expose unrelated mail to matter search. Preserve message/thread IDs, headers needed for reply threading, participant addresses, bodies, timestamps, attachments, association decisions, and freshness. Match using thread and transaction evidence, not sender alone. Reject/rematch must undo mistaken association safely.

Persist outgoing recipient/body/attachment snapshots and a send intent before delivery. Gmail does not become exactly-once merely because a queue retries: after an ambiguous timeout, reconcile the sent message before retrying. Block unresolved merge fields and show the actual recipients and client-contact policy before send.

Recommend Resend for account invitations, recovery, and system notifications, with Ireland’s Gmail used for transaction correspondence. Keep provider credentials separate and disable tracking of confidential links. Verify the sending domain and its DNS; Resend requires a verified domain owned by the sender. [Resend domain documentation](https://resend.com/docs/dashboard/domains/introduction).

## Stripe and Dotloop

Use Stripe-hosted Checkout for one-time Weatherly service/gift charges. The server creates orders from an approved catalog and freezes line amounts, currency, quantity, and applicable tax treatment. Stripe Connect is unnecessary for the proposed single-business flow.

Verify webhook signatures against the raw request body, store event IDs, and make order transitions idempotent. Handle completed checkout, delayed success/failure, expiry, refunds, and disputes as appropriate to enabled methods. A browser redirect is not proof of payment; payment state and reconciliation drive fulfillment. Use a separate sandbox with deterministic webhook-replay tests. [Stripe fulfillment documentation](https://docs.stripe.com/checkout/fulfillment.md?payment-ui=stripe-hosted).

Dotloop needs developer credentials, OAuth, account authorization, and capability testing against Ireland’s accessible loops/documents. Implement connection, browsing, matter linkage, authorized import, refresh, origin tracking, and deduplication. Use the document service for every imported file. Confirm binary-document and signature/status access rather than assuming every UI feature is exposed by the API. The published API describes OAuth and loop/document resources, but access to Ireland’s account remains a launch dependency. [Dotloop developer guide](https://dotloop.github.io/public-api/).

## Railway and operations

Use private database networking, TLS public endpoints, scoped secrets, environment-specific OAuth callbacks and webhook endpoints, health checks, restart/retry policies, migration-before-release procedures, and a rollback plan. Keep staging on synthetic data with sandbox payments and test mailbox connections.

Railway buckets are private S3-compatible storage. Its documentation does not provide automatic bucket backups or object versioning, so use immutable version keys and a separate, access-controlled backup process. Database backups alone do not restore attachments. Test restoration of both and reconstruction of search indexes. [Railway storage documentation](https://docs.railway.com/storage-buckets).

Operational visibility should include failed jobs, oldest queued job, last Gmail/Dotloop sync, watch expiration, AI policy failures, payment reconciliation differences, failed delivery, storage failures, backup age, and cost. Alerts contain record links and identifiers rather than confidential bodies. Track retention and deletion across primary files, derived text, search indexes, exports, and backup expiry.

Adopt a recovery objective before launch; a reasonable starting proposal is at most 24 hours of data loss and restoration within one business day, then tighten if Ireland’s workflow requires it. Demonstrate the selected objective with a restore exercise rather than treating a scheduled backup as proof.

## Costs and sequencing risks

Budget separately for Railway compute/database/storage/egress, independent backups, OpenRouter tokens/pages, transactional email, domain/mailbox, Stripe fees, and any Dotloop or verification costs. Railway Pro currently has a $20 monthly minimum including $20 resource usage; that is a platform floor, not the full app bill. [Railway pricing](https://docs.railway.com/pricing/plans).

Estimate actual monthly costs after representative contracts, message volume, document retention, and model selection are measured. Set spending limits and alerts before the pilot. Do not select a model based solely on advertised token cost; document quality and extraction failures affect total cost.

Begin Google eligibility, Dotloop access, OpenRouter endpoint tests, Stripe sandbox events, and Railway storage/recovery checks during foundation work. These can affect the critical path independently of agent coding throughput. Final dates should follow these probes and a measured first package rather than multiplying a single-agent estimate by the number of agents.
