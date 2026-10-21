# Weatherly implementation and independent review plan

**Status:** Implementation authorized by the user on October 20, 2026. Local preview and GitHub synchronization are included. Production activation, real payments, and external sending remain subject to configured credentials and release checks. Read with `PROJECT_SCOPE.md` (product requirements) and `TECHNICAL_PLAN.md` (system design). The three supplied HTML files are design and behavior references, not a working backend. Weatherly is one business run by Ireland, a person, in the Ohio/US context; this is not an Ireland-country or multi-tenant SaaS specification.

The references disagree: website package prices are $400/$495/$550, workspace prices are $375/$475/$625, and intake offers only two packages. The website gift offer and intake gift tiers also differ. Service prices are now approved at the workspace amounts: $375 Essentials, $475 Complete, $625 Full Listing. Gift catalog and fee timing remain unresolved. The current intake disables required-field enforcement, and linked agent/client workspace files are absent; implement validation and real portals explicitly.

## 1. Two teams and delivery authority

The build team implements fourteen exclusive work packages, **B00–B13**. The independent check team reviews the corresponding packages, **R00–R13**. Both teams use **GPT-6.1 sol**. These IDs describe responsibilities, not twenty-eight simultaneously running agents. With four available concurrency slots, use the coordinating parent plus **two builders and one reviewer** per batch. Reuse agents for later packages and preserve assignments in handovers. A reviewer must never review code or tests they authored, including work from an earlier assignment. If reuse would violate that rule, change the assignment.

Builders own implementation and repair. Checkers own independent verification and defect reports. Checkers cannot modify builder-owned production code, tests, migrations, infrastructure, or configuration. Each Rxx writes only `docs/reviews/Rxx/**`; it may perform isolated scratch/worktree validation without committing production changes. Report a defect to its builder, wait for a fix, then review the revised **exact commit**. An older approval does not cover later edits.

Implementation assignment record: the `build_services` agent owns B01–B04 and B10 domain services plus the later B07 email/worker hardening transfer; `build_team_plan` owns B01/B09/B10 account/public/portal UI, B11 workspace UI, and B12–B13 operations/acceptance. The parent integrates shared files and owns B05–B08 services and B02 `rules.ts` until an explicit transfer. The independent `check_team_review` agent writes reports/probes under the approved common review boundary `docs/reviews/implementation/**`. These transfers preserve one writer per file; they replace the original per-Rxx report-directory convention for this implementation run. All three agents use GPT-6.1 sol. Current evidence and external launch gates are linked from `README.md`.

The coordinator settles interface conflicts, sequences shared changes, records owner decisions, and accepts the final evidence. Review approval is technical evidence, not authority to deploy, purchase services, send real messages, or accept business terms. Implementation completion and deployment approval are separate gates.

## 2. Exclusive ownership and contracts

After bootstrap, the only shared-file writer is B00. Each builder also exclusively owns `docs/handovers/Bxx/**`. No work package may casually edit another package to unblock itself. Submit a contract or change request to the owner instead.

| Builder / checker | Exclusive implementation boundary |
| --- | --- |
| B00 / R00 | Root manifests, lockfiles and configuration; app-level manifests/configuration; `apps/api/src/main.ts`; `apps/worker/src/main.ts`; web root layout/global styles/error pages; `apps/web/public/**`; `packages/platform/**`; `packages/db/**`; `packages/ui/**`; root planning documents |
| B01 / R01 | `packages/identity/**`; `apps/web/app/(account)/**` |
| B02 / R02 | `packages/matters/**` |
| B03 / R03 | `packages/documents/**` |
| B04 / R04 | `packages/communications/**` |
| B05 / R05 | `packages/billing/**` |
| B06 / R06 | `packages/dotloop/**` |
| B07 / R07 | `packages/ai/**` |
| B08 / R08 | `packages/assistant/**`; `packages/assistant-ui/**` |
| B09 / R09 | `packages/onboarding/**`; `apps/web/app/(marketing)/**` |
| B10 / R10 | `packages/intake/**`; `apps/web/app/(portal)/**` |
| B11 / R11 | `apps/web/app/(workspace)/**` |
| B12 / R12 | `infra/**`; `.github/workflows/**`; `docs/runbooks/**` |
| B13 / R13 | `tests/acceptance/**`; `docs/release/**` |

B00 may initially create feature-package manifests and app scaffolds, then records their transfer and stops editing transferred directories. B00 retains app-level configuration and shared assets, including `apps/web/app/layout.tsx`, `globals.css`, `error.tsx`, `not-found.tsx`, and `loading.tsx`. B12 keeps Dockerfiles and Railway deployment configuration under `infra/**` and configures builds to use those paths; there is no root deployment-file exception. Package-specific test fixtures stay inside their owned package; cross-package acceptance fixtures and configuration stay under `tests/acceptance/**`. B00 owns the root test-runner wiring. New paths require an ownership entry before edits; they are not shared by default.

Domain modules export `contracts.ts`, `service.ts`, `http.ts`, and `jobs.ts`, with deliberate empty exports where a surface is unnecessary. They own module-local tests. B08 owns MCP protocol handling and the assistant tool definitions that call domain services. B00 alone mounts exported HTTP/MCP registrations and worker-job registries in the application entrypoints. Next.js renders the web app; Express serves the API and remote MCP; the worker executes durable jobs; Prisma/Postgres holds application state and job records; a Railway private bucket holds documents. B09 owns public page URLs, B01 account URLs, B10 `/portal/**`, and B11 `/workspace/**`; route groups must not produce duplicate URLs.

The owning domain service contains business rules and performs every write to its domain records. HTTP, MCP, jobs, UI, and assistants call that service; no frontend database access or duplicate workflow implementation. All authorized business reads must be reachable through API/MCP surfaces using these same services. Product mutations use authenticated write APIs; external MCP grants are read-only for this release. Any later external write tools require a separately approved scope. Cross-domain actions call the other owner's service. B00 owns **all Prisma schemas and migrations**; feature builders submit proposed entities, constraints, indexes, retention behavior, and migration concerns under their own handovers.

Before feature work, freeze the first contract set: principal/role/resource authorization; identifiers and timestamps; error/pagination formats; matter states; event/outbox and idempotency envelopes; document references; money/currency representation; job lease/retry semantics; audit fields; provider interfaces; MCP authentication and tool schemas; and UI tokens/accessibility conventions. Version contracts and record consumers. Changes require producer and consumer acknowledgment before integration.

## 3. Work packages and acceptance evidence

Each package hands over its contract version, changed commit, schema/registry requests, test commands and results, fixtures, known limitations, and a requirement-to-evidence checklist. Rxx checks the stated outcomes independently, including negative authorization cases and failure paths.

### B00 / R00 — Integration, shared foundation and database

**Inputs:** approved architecture, source inventory, business decision register, module contracts. **Outputs:** runnable TypeScript monorepo; shared UI/platform libraries; database migrations; durable job/outbox primitives; typed registry wiring; local setup and package commands. Use the existing GitHub repository and preserve its original mockup baseline. Establish logging with sensitive-field redaction, correlation IDs, audit conventions, health checks and API/MCP authentication hooks.

**Acceptance:** clean installation/build/typecheck; database initialization and migration from a representative previous state; duplicate job delivery does not duplicate effects; interrupted jobs recover; one persisted sample resource is readable through an authenticated API. No private documents or secrets enter logs. R00 checks migration ownership, contract test harnesses and dependency cycles. Initial foundation approval uses contract fixtures; live API/MCP parity is a later integration gate under R08/R13, not a circular prerequisite to starting B08. B00 integrates throughout later stages and requests focused re-review after shared changes.

### B01 / R01 — Identity and account experience

**Inputs:** role matrix and approved authentication/mailbox boundaries. **Outputs:** sign-in, invite acceptance, recovery/session behavior, account/profile screens, role and resource access enforcement. Model coordinator, agent, and client access with explicit matter participation and revocation.

**Acceptance:** coordinator MFA, invitation expiry/reuse rules, session revocation, direct URL and API denial, cross-agent/client isolation, and coordinator-only operations. Client contact permission is not equivalent to portal access. Check account recovery and rate limits without assuming a chosen external identity vendor. MCP denial is checked against the same access service during B08 integration.

### B02 / R02 — Matter lifecycle and coordination rules

**Inputs:** intake and workflow contracts, approved templates and brokerage rules. **Outputs:** matter CRUD/state transitions; participants; tasks/checklists; milestones/deadlines; notes/activity; assignments; validated domain queries and mutations.

**Acceptance:** state transitions and deadline changes remain consistent under concurrent edits; Full Listing converts to under-contract work with the same matter ID and history; cash versus financed and buyer versus seller cases generate correct work; dual representation uses separate linked intakes where required; contact restrictions propagate to downstream actions. Amendment handling preserves reviewed dates and manual overrides. Audit all material changes. Rule uncertainty appears for owner resolution rather than invented legal conclusions.

### B03 / R03 — Documents and controlled access

**Inputs:** matter authorization, bucket adapter, permitted file/retention rules. **Outputs:** upload/download, metadata/versioning, signed access, document categories, safe preview handling, exports, and local text/page extraction. Preserve source provenance and extraction linkage. B03 performs deterministic file processing; B07 alone performs AI extraction through the gateway.

**Acceptance:** ownership checks before signing; private access expiry; malicious/oversized/unsupported files handled safely; upload interruption recovery; version history and authorized API/MCP discoverability. PDF and Word inputs yield usable text/pages or an actionable processing error. Exported documents receive output checks. Scanning or parsing dependencies must not introduce an external OCR or AI provider bypass.

### B04 / R04 — Gmail and notifications

**Inputs:** confirmed Google mailbox and permissions, communications policy, document references. **Outputs:** OAuth connection, inbox/thread/message query APIs, incremental sync, attachment ingestion, draft/send/reply services, durable dispatch, delivery/sync status and transactional notifications. B10/B11 own the actual portal/workspace screens. B04 owns communication-template versions and merge validation; B07 supplies AI draft/suggestion generation through its gateway.

**Acceptance:** expired/revoked tokens, pagination/history expiration, duplicate events, restart recovery, attachment permissions and provider rate limits. Message-to-matter association is reviewable; client-contact restrictions and copy-agent rules are enforced server-side. Test sends go only to explicit test recipients. Inbound email is untrusted content and cannot authorize actions or alter system policy. R04 checks whether uncertain Gmail watch/renewal and consent requirements were verified rather than assumed.

### B05 / R05 — Services, gifts and payments

**Inputs:** owner-approved package prices, fee timing, gift catalog, fulfillment/refund policy. **Outputs:** versioned catalog and quotes; Stripe checkout/payment records; verified webhook handling; service/gift order lifecycle; receipts/status; authorized API/MCP views and actions.

**Acceptance:** server-calculated totals, stale-price handling, webhook signature and duplicate/out-of-order protection, cancellations/refunds and reconciliation. Gift ordering requires confirmed payment, as the intake specifies. Never silently choose when service fees become due. Use test mode until launch gates permit live money. Secret API keys remain server-side; clients receive only the checkout/session information intended for the public flow.

### B06 / R06 — Dotloop integration

**Inputs:** actual API access/approval, account permissions and owner-approved mapping. **Outputs:** connect/disconnect, loop lookup/linking, document retrieval, synchronization status and retryable jobs; supported write operations only when confirmed in scope and available.

**Acceptance:** proof of accessible endpoints early; realistic sandbox/account fixtures; permission failures, missing/deleted files, duplicates, expired access and reconnect behavior. Intake's “already uploaded in Dotloop” path must create actionable retrieval/status rather than pretending the file exists. Record provider limits and an explicit fallback when access is unavailable; do not claim a complete integration from mocks.

### B07 / R07 — OpenRouter ZDR gateway and document AI

**Inputs:** verified OpenRouter account/endpoint ZDR capabilities, approved document rules and evaluation fixtures. **Outputs:** the single AI gateway; contract extraction, inbox classification and draft-generation handlers; structured proposals with source citations, uncertainty, review state and durable processing history. B08 owns question-answer orchestration; B11 owns coordinator review screens; B02/B04 apply accepted changes through their domain services.

**Acceptance:** all AI traffic uses this gateway; routing fails closed when approved ZDR conditions cannot be verified; no external OCR, plugin or provider bypass. Evaluate field accuracy and abstention against representative contracts, poor scans and conflicting amendments. Dates, contacts and obligations retain source/page evidence and human correction history. Retrieved document instructions cannot change policies or trigger writes. R07 inspects actual network/config boundaries and failure behavior, not only mocked SDK assertions.

### B08 / R08 — Assistant and remote MCP experience

**Inputs:** stable authorized domain APIs, AI gateway, tool/action policies. **Outputs:** assistant orchestration, reusable assistant UI, remote MCP tools/resources and discoverable authorized data coverage. B00 mounts exported registrations; B11/B10 compose the shared UI in their routes.

**Acceptance:** coordinator/agent/client permission parity at the data boundary; cited answers; restricted search visibility; read-only external tool grants; query/access audit; injection resistance. The coordinator assistant is the initial in-app surface; agent/client portal chat is not required merely to test their restricted data access. All AI uses B07. External MCP clients are permitted only when their own AI usage conforms to OpenRouter/ZDR; document and enforce the actual admission mechanism and its limits. If client compliance cannot be verified, access remains disabled. No claim that a server can silently control arbitrary client-side inference.

### B09 / R09 — Eight public pages and onboarding

**Inputs:** eight-page inventory/designs in scope, approved copy/prices, identity/intake contracts. **Outputs:** About Me, Service Levels, A Simple Process, New Agent Onboarding, Testimonials, FAQ, Agent Portal and Contact routes; responsive navigation/footer; service/gift information; contact entry points; and onboarding/profile workflow. The public Agent Portal page is the entry point; B10 owns the authenticated agent/client application.

**Acceptance:** reconcile every public page and call to action against the source inventory; mobile/desktop visual checks; keyboard navigation; correct forms and authentication handoff; clear loading/error/empty states. Onboarding persists required profile and brokerage information and resumes safely. No invented prices, guarantees, testimonials, or consent claims.

### B10 / R10 — Adaptive intake and real agent/client portals

**Inputs:** onboarding/profile, matters, documents, billing and Dotloop contracts. **Outputs:** resumable intake, validation/review/submit, idempotent matter creation and portals for agents and clients, with appropriate status, tasks, files, messages, payments and profile actions.

**Acceptance:** enumerate every source branch: package; buyer/seller; cash/financed; upload/Dotloop; multiple clients and contact permission; all title/lender choices; buyer/seller-specific HOA options; prior-policy/reissue paths; compliance/broker/pre-1978/checklist fields; notes; gifts/personalization/payment. Conditional values remain coherent when answers change. Submission creates real records and downstream work. Separate dual-side submissions, permission isolation and portal completeness require explicit scenarios; a coordinator dashboard does not satisfy this package.

### B11 / R11 — Coordinator workspace

**Inputs:** stable domain query/action contracts, source workspace inventory and shared UI. **Outputs:** dashboard, matter lists/detail views, task/deadline management, documents, inbox, billing/gifts, integration status, assistant placement and coordinator settings required by scope.

**Acceptance:** reconcile every source workspace area; realistic seeded data; working filters/search/actions; useful empty/failure states; conflict handling and responsive/accessibility checks. Display provenance and pending human review for AI fields. Every action reaches its owning service; no decorative buttons standing in for functionality. Preserve access boundaries during deep links and client navigation.

### B12 / R12 — Operations, deployment preparation and recovery

**Inputs:** confirmed provider requirements, runtime contracts, data retention/backup policy. **Outputs:** Railway configuration, CI workflows, environments/secrets instructions, health/monitoring setup, backup/restore procedures, scheduled-job operations and incident/runbooks.

**Acceptance:** CI invokes package test scripts without editing root scripts; request those changes from B00. Prove private storage, least-privilege credentials, environment separation, job recovery and secret redaction. Restore database **and document objects** into an isolated environment and validate linkage. Check OAuth/watch renewal, webhook retries, rollback and migration order. Prepare deployment artifacts; actual deployment requires the release gate and user authorization.

### B13 / R13 — End-to-end acceptance and release evidence

**Inputs:** integrated candidate, requirement ledger, provider test access and owner decisions. **Outputs:** cross-package acceptance scenarios, deterministic fixtures, release checklist, visual evidence, accessibility/performance results and known-issues ledger.

**Acceptance:** execute realistic complete journeys from public page/onboarding to intake, coordination, Gmail, Dotloop retrieval, AI review, payment/gift and closeout; test both successful and interrupted flows for all roles. Trace every scope requirement to evidence, including all eight pages and missing-in-prototype portals. B13 belongs to the build team and cannot certify its own tests as independent review. R13 independently compares observed behavior and coverage to requirements, challenges fixtures/assertions and reruns selected scenarios at the exact candidate commit.

## 4. Sequencing, gates and critical path

**Stage A — Decisions and access spikes.** Coordinator records owner decisions on package prices, gift catalog, fee timing, Google mailbox, approved contracts and brokerage rules. B00 freezes scaffold/contracts. B04, B05, B06 and B07 perform time-boxed capability/access spikes early, using their own paths and handovers; B12 verifies hosting/storage requirements. Check actual OAuth approval, Dotloop eligibility, Stripe testing and OpenRouter ZDR routing. These are unknown access gates, not assumed waiting periods. Continue independent local work while a provider gate is unresolved, but label simulation honestly.

**Stage B — Durable foundation.** Deliver B00 and B01, then B02 and B03; schedule reviewer work as each stable commit arrives. R00/R01 approval of authorization and shared primitives is required before storing live customer data. Schema requests queue through B00 with backward-compatible contract sequencing.

**Stage C — Domain capabilities.** Run B04/B05, then B06/B07, with the third execution slot reviewing earlier deliverables. Work may overlap only after required contracts are accepted. Build B08 once service authorization/tool shapes and B07 gateway are stable. B12 can proceed on infrastructure contracts between review batches.

**Stage D — Complete experiences.** B09 can begin its static page shell after UI/identity contracts; B10 and B11 use approved domain contracts and seeded fixtures before live provider integration is ready. Integrate real services before acceptance. Review both portals explicitly. Review source-to-product visual and interaction coverage, not screenshots alone.

**Stage E — Integrated acceptance.** B13 exercises the integrated candidate; builders repair their own defects. R13 and applicable domain checkers recheck fixes at a frozen release commit. B12 performs recovery rehearsal. Coordinator closes requirement coverage, records remaining risks and requests any launch decision only when concrete evidence is ready.

The critical path is **contracts/schema/identity → matters/documents → provider and AI services → intake/portals/workspace/assistant → integrated acceptance and recovery**. Public design work can run alongside it. Provider failures may block only dependent capabilities; they cannot be hidden behind mock success. No launch while a promised core capability lacks working evidence or an explicitly approved scope change.

## 5. Reusable assignment prompts

**Builder prompt:** “Act as build-team agent Bxx using GPT-6.1 sol. Read the scope, technical plan, this plan and applicable repository instructions. Implement only Bxx's listed paths plus `docs/handovers/Bxx/**`; do not edit other owners' files. Confirm frozen input contracts first. Put schema/registry/shared changes in a request for B00 and cross-domain changes in requests to their owners. Implement authorized behavior through domain services, with module tests and failure/authorization checks. Use only the OpenRouter ZDR gateway for AI. Hand over the exact commit, contracts, tests/evidence, decisions and limitations to Rxx. Repair reported defects and identify the new exact commit. Do not deploy or expand scope.”

**Checker prompt:** “Act as independent check-team agent Rxx using GPT-6.1 sol. Confirm you authored none of the submitted implementation or tests. Review Bxx's exact commit against scope, technical plan, contracts and acceptance criteria. Independently exercise representative positive, negative, permission and recovery behavior; inspect source and evidence for hidden mocks and missing branches. Write only `docs/reviews/Rxx/**` and isolated validation scratch. Never repair builder-owned files. Report reproducible defects with requirement, severity, steps and observed/expected result to Bxx. Recheck revised exact commits, recording commands and results. State pass, fail or blocked with limits; do not grant deployment approval.”

## 6. Definition of done

A package is done only when outputs and API/MCP coverage exist, all named branches are accounted for, appropriate tests and visual checks pass, schema/registries are integrated, secrets/privacy/authorization checks pass, the handover is current, and its independent reviewer approves the same commit being accepted. Blocked provider checks remain blocked, not passed. Business decisions have an explicit owner and resolution; placeholders cannot masquerade as final policy.

The product candidate is done when all fourteen packages meet that definition, cross-package journeys and restore rehearsal pass, every scope requirement has evidence, and no unresolved critical/high defect remains. Report residual limitations and exact tested commit. The resulting state is **implementation accepted and ready for a business launch decision**, not automatically deployed.

## 7. GitHub synchronization and handoffs

The shared repository is [xyudifjvs/IrelandThing](https://github.com/xyudifjvs/IrelandThing), with remote `origin` and default branch `main`. The local folder is now attached to its existing history. Preserve the supplied HTML and brand assets; maintain production source separately once implementation starts.

During implementation, give each active builder an isolated worktree/branch named for its package, such as `build/B04-gmail`. The checker reviews the pushed exact commit in an isolated checkout and records evidence under its Rxx directory. Review artifacts are committed and synced too, through the coordinator, without changing the implementation under review. Keep the mapping between evidence and the reviewed source commit explicit.

Push each completed reviewable checkpoint and fix, and sync handovers before an agent exits. The coordinator integrates reviewed packages through pull requests, resolves shared-contract changes in B00, and runs the integrated checks before promoting a candidate. Never force-push over another agent's work or let two agents switch branches in the same checkout. If network/authentication prevents a push, retain the commit locally and report the unsynced SHA and branch; do not claim synchronization succeeded.

Source code, tests, plans, approved synthetic fixtures, and review records belong in Git. Credentials, `.env` secrets, live customer records, original client documents, mailbox exports, database backups, build caches, and operating-system metadata do not. Product data belongs in the approved application storage described in the technical plan. A handover includes local HEAD, remote branch SHA, clean/dirty state, and any unpushed commits.
