# Frontend handover: B01 / B09 / B10 / B11 slices

This agent implemented only the four assigned Next.js route groups, their local components/CSS modules, and this handover. Parent owns shared UI, root configuration, API/worker registration, all schema and provider services. Branch: `build/B11-workspace` in the assigned isolated worktree. No pushes, deployments, external sends or real customer data were used.

## Delivered routes

- Eight public pages: `/`, `/services`, `/process`, `/onboarding`, `/testimonials`, `/faq`, `/agent-portal`, `/contact`. Source placeholder testimonials are replaced with an honest pending-publication state. Service prices are the owner's approved USD 375 / 475 / 625. Gift catalog/pricing and service fee timing remain explicit decisions.
- `/login`, `/invite`, `/account`, `/security`, `/forgot-password`, `/reset-password`, `/authorize-assistant`: actual BetterAuth sign-in, authenticator challenge/enrollment/backup codes, invitation register/accept, profile updates, recovery requests and token reset, and server-backed OAuth consent. Local demo entry is visible only when `NEXT_PUBLIC_APP_ENV=local`. No production automatic bypass.
- `/workspace`, `/workspace/transactions`, `/workspace/transactions/[id]`: live overview/pipeline/list; task/private-task edits; lifecycle and agent assignment; contract deadlines create/edit/confirm; explicit derived-date recalculation; document uploads/downloads; private notes; external contact CRUD; separate existing-account portal grants; broker-file status edits.
- `/workspace/calendar`: real authorized task/deadline month grid and mobile agenda, proposed-date indicators and transaction links.
- `/workspace/inbox`: configured mailbox state, message reading, revision-protected conversation association, per-message audience review, saved contact recipient suggestions, template rendering, draft create/edit/attachments and explicit reviewed-send action.
- `/workspace/settings`: profile, integration readiness, approved Gmail connect/sync/disconnect, communication template CRUD and conditional checklist/date-rule builder for new transactions.
- `/workspace/payments`: approved catalog and actual payment records, coordinator-only creation of a service payment link after timing confirmation. Ireland's own future Stripe account is required. The frontend does not connect Carson's account.
- `/workspace/review`: asynchronous AI request and queue, exact source quote/page and source download links, facts/warnings, selected editable valid dates, explicit manual-date override reason, revision-bound approval and rejection. No raw JSON product flow.
- `/workspace/new` and `/portal/intake`: shared six-step adaptive intake, actual draft resume/save, contract/checklist uploads, server validation and idempotent submit. Every material answer appears on review: side/package/cash/source, clients and relationship, contact permissions, full title/lender details, all side-specific HOA/prior-policy options, broker/pre-1978/checklist, notes and gift preference/personalization/delivery. Unsupported invented buyer-lender lookup removed.
- `/portal` and `/portal/transactions/[id]`: server-authorized agent/client projections, shared checklist/timeline/files/notes/reviewed messages. Clients have no intake or upload controls. Agents await Ireland-initiated payment instructions rather than creating checkout timing themselves. The parent's shared assistant UI remains the single assistant surface.

## Contracts and integration notes

All API responses are direct JSON through `@weatherly/ui`'s `api` helper. Files download as authenticated binary responses through an anchor, not an assumed signed-URL JSON envelope. Multipart uploads accept only PDF/DOCX. No localStorage stores business records.

Canonical package codes: `essentials`, `complete`, `full_listing`. Canonical task states: `pending`, `received`, `proposed`, `completed`, `signed`, `not_applicable`. The independent checker's initial checkbox/status defect is fixed across mutations, filtering and progress. Date-only values use local noon to prevent an Ohio/New York one-day display shift.

External contacts are revisioned `details.contacts` entries `{id,name,role,email,phone?}` through the owning matter service; saving them grants no portal access. Agent/client permissions use existing account IDs or invitation workflows. Note/checklist visibility stays explicit.

The data hook ignores stale responses after path changes and clears prior data on failure, preventing one transaction's response from replacing the newly selected file. Email composer clears recipients/content when changing transactions, sends immutable `matterId` only on draft creation, and uses `expectedRevision` for draft edits and conversation review.

The parent must mount the singular `/api/v1/intake` contract or retain an alias to its implementation. Workflow endpoints are `/api/v1/workflows/templates` and `/workflows/matters/:id/recalculate`. Email endpoints are `/api/v1/communications/*`. AI queue endpoints and assistant consent endpoints follow the latest parent-provided contracts. All registrations remain parent-owned.

## Validation

- `tsc -p apps/web/tsconfig.json --noEmit --incremental false`: passed after final frontend changes.
- `NEXT_PUBLIC_APP_ENV=local npm run build --workspace @weatherly/web -- --webpack`: passed, all 28 page outputs generated plus not-found.
- The default Turbopack build could not resolve Next through the shared `node_modules` symlink outside the isolated worktree; this is a worktree dependency-resolution limitation. The Webpack build succeeded without configuration edits. Parent/integration CI must run the normal build with a local installation.
- Independent R09–R11 review owns browser acceptance and exact integrated commit certification. Findings received so far were addressed: canonical task statuses; editable deadlines; broker state controls; external contacts; required client email/phone; relationship field; brokerage checklist upload; full review details; unsupported lender branch. Parent owns the singular intake mount correction.

## Remaining gates and limitations

Real Gmail, Dotloop, Stripe and OpenRouter/ZDR credentials/access are intentionally unconfigured; UI shows actionable readiness rather than fabricated success. No end-to-end provider delivery, charge, OAuth or model inference was claimed. The placeholder `ireland@ireland.com` is never treated as a usable mailbox. Production recovery delivery likewise requires the approved system mail provider.

Parent/services must validate and attach `broker.checklistDocumentId` to the submitted matter in addition to executed-contract `documentIds`; this integration requirement was reported. Owner decisions remain for gift catalog/prices, service fee timing, approved legal templates, brokerage rules and real service/contact details. Source placeholder testimonials are not published as real statements.

Run independent integrated browser checks after parent cherry-picks the final frontend commit. Neither this handover nor a successful compilation grants launch approval.
