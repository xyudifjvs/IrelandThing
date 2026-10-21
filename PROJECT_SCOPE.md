# Weatherly project scope

Build a complete operating system for **Ireland’s Weatherly Transaction Co.**: public website, agent onboarding, transaction intake, coordinator workspace, agent and client portals, communications, documents, payments, and an assistant that can answer questions from saved matter records.

Ireland is the founder named in the mockup. This scope is for her business; the service territory still needs confirmation. It does not assume the country of Ireland or a product sold to other transaction coordinators.

The delivery covers the full product. Work packages are a dependency sequence, not a proposal to leave the integrations for an unspecified later release. See [technical architecture](TECHNICAL_PLAN.md) and the [two-team implementation plan](IMPLEMENTATION_PLAN.md).

## Confirmed requirements

- One Weatherly business, with Ireland as administrator, invited agents, and clients with limited access.
- Gmail integration, AI integration, Railway hosting, and Stripe payments.
- All relevant business records persist and are accessible through authenticated APIs and MCP, according to the caller’s permissions.
- Every production AI operation uses OpenRouter with enforced zero data retention. This includes extraction, summaries, answers, draft generation, and any AI search or classification.
- Separate build and check teams using GPT-6.1 sol. Each package has one code owner and an independent reviewer.

## What the HTML files contain

| Source | What is present | What still needs production implementation |
| --- | --- | --- |
| [Website design](Weatherly%20Transaction%20Co.%20Website%20Design.html) | Eight embedded designs: About Me, Service Levels, A Simple Process, New Agent Onboarding, Testimonials, FAQ, Agent Portal, Contact | Real routes, approved content, working forms, account flows, responsive rendering, accessibility, search metadata |
| [Platform design](Weatherly%20Transaction%20Co.%20Platform%20%28v2%29%20%E2%80%93%20Your%20workspace%20%28v2%29.html) | Coordinator dashboard, sample matter, deadline review, checklist, email templates, broker file, notes, listing pipeline, inbox, settings | Database, backend, permissions, real uploads, real extraction, email delivery, payments, integration state, reliable jobs |
| [Transaction intake](New%20Transaction%20Intake.html) | Six steps with conditional buyer/seller, cash/finance, client, title/lender, HOA, compliance, notes, and gift fields | Server validation, saved drafts, file storage, submission records, pricing, payments, Full Listing intake |

The platform’s extraction runs timers over sample values. Its send/invite actions change browser state or display a message. The intake explicitly says nothing was sent and has required-field enforcement disabled. Agent.dc.html and Client.dc.html, linked from the platform, are absent. The directory has no application scaffold or backend.

Source inspection covered all eight embedded website pages. The platform and intake were also opened interactively; the website export’s embedded board did not render reliably in the preview. These files are design references, not an existing production system to deploy unchanged.

## Conflicts to resolve before implementation hardens them

| Decision | Evidence in mockups | Required resolution |
| --- | --- | --- |
| Service prices | Website and workspace originally disagreed | Approved by the user: Essentials $375, Complete $475, Full Listing $625 USD; Full Listing is seller-only |
| Gift catalog | Website: $65 add-on and three choices. Intake: Classic, Signature, Luxury with blank prices and generic choices | Define actual gifts, prices, personalization, ordering responsibility, delivery, and refund policy |
| Package coverage | Intake offers two packages; platform and website offer three | Add Full Listing intake before an executed contract exists |
| Billing timing | Gift requires prepayment; service fee timing is not settled | Decide when service fees are due and what happens on cancellation, termination, upgrades, and refunds |
| Communication permission | Intake allows direct client contact or contact through agent | Persist and enforce the selected policy in recipients, templates, and assistant proposals |
| Brokerage rules | Platform contains Home Team Ohio and person/vendor-specific instructions | Convert these into configurable, versioned brokerage templates approved by Ireland |
| Business identity and copy | Contact contains ireland@weatherytc.com; other forms have placeholder addresses. FAQ/testimonials remain placeholders | Confirm exact domain/mailbox, service area, biography claims, real testimonials, and final copy |

The workspace service prices are the approved initial catalog. Gift pricing and automatic service-fee timing remain unresolved: the implemented workflow uses explicit coordinator payment requests and individually approved gift quotes. Ireland must use her own Stripe account. The unknown Gmail mailbox remains a blocked placeholder, and production PostgreSQL belongs on Railway.

## Product scope

### Public website and onboarding

Deliver all eight page purposes with Weatherly’s warm neutral palette, serif typography, supplied brand assets, mobile layouts, working navigation, and accessible forms. Replace placeholders and broken local links. Services read the same approved catalog used by intake and billing.

Save inquiries and onboarding requests, including requested meeting time, timezone, status, and follow-up. The existing design requests a meeting; it does not establish live calendar availability. Support coordinator confirmation and a calendar invitation. Automated Google Calendar availability or booking can be added to this package if Ireland chooses it explicitly.

Track service-agreement version, sent/received status, and signed document. Agent access follows Ireland’s approval. Use the established signing process or a verified integration; a custom signature engine is not required to meet the mockup. Preserve the alternate “email me information” onboarding path.

### Intake and portals

Implement save/resume, validation on the server, review before submission, upload progress, duplicate-submission protection, and a durable receipt. Preserve multiple clients, relationship, contact preference, cash/finance, title and lender handling, HOA requests, seller title-policy request, broker details, pre-1978 flag, brokerage-checklist selection, notes, and gift personalization. Review must show every material submitted field.

Support Essentials and Complete for buyer or seller, and Full Listing for sellers. Following the intake’s stated approach, separate represented sides have separate matters, optionally linked by property. Full Listing starts before contract and converts to under-contract work without losing its matter ID, documents, communications, notes, or payment history. Title, lender, HOA, and prior-policy handling selections must create the corresponding follow-up tasks; saving the answer alone does not complete the workflow.

Agents see their own submissions, matter progress, requested information, authorized files, payments, and gifts. Clients see a simple timeline and explicitly shared information through secure, revocable access. Portal visibility is enforced by the backend; hiding a tab is insufficient.

### Coordinator workspace

Build persistent dashboard counts, search, filters, stage views, attention items, listing pipeline, matter details, contacts, deadlines, checklist, broker file, communications, private notes, personal to-dos, settings, archive, and export.

Carry forward the sample’s milestone coverage: preapproval/funds evidence, loan application, earnest money, attorney review, inspections and remedies, warranty, HOA, appraisal, commitment, title, walkthrough, closing, and possession. Make applicability and dates configurable. Missing evidence, proposed completion, and confirmed completion are different states.

Broker file items need appropriate received/completed/signed/not-applicable states. They cannot all be reduced to signature status. Preserve template versions on existing matters; edits affect new matters unless Ireland explicitly applies an update.

### Documents and deadlines

Store original contracts, amendments, disclosures, broker documents, email attachments, and signed agreements privately. Keep versions, origin, checksum, upload/import time, permission, extracted text, and page references. Support PDF and the Word formats accepted by intake with explicit conversion or actionable unsupported-file errors.

AI proposes extracted facts and dates with source evidence. Ireland can confirm, correct, reject, or leave unknown. Confirmed dates drive workflows; an unreviewed model output does not silently become a deadline. Changes from amendments preserve prior values, reasons, manual overrides, and source history.

### Gmail and notifications

Connect Ireland’s authorized mailbox; import relevant historical messages and attachments and keep them synchronized. Match threads to matters, expose ambiguous matches for review, support manual association, and allow one contact to participate in multiple transactions.

Provide matter email history, versioned templates, merge-field validation, drafts, attachments, recipient preview, approved sending, delivery state, and duplicate-send protection. Preserve recipient/body/attachment overrides and reset-to-template behavior, with sent snapshots unaffected by later edits. Existing incomplete template wording needs completion. A known sender is not sufficient evidence to mark a task done or select the right matter.

Persist email-derived proposals and their disposition. System invitations, login emails, and reminders need a transactional delivery channel and status monitoring. Notification preferences and client-contact restrictions apply across all send paths.

### Payments and gifts

Use Stripe for Weatherly’s service fees and gift orders. Include server-controlled pricing, checkout, payment status, receipts, refunds, reconciliation, and a coordinator view of unpaid and failed payments. Preserve price snapshots when catalog prices change.

Track gifts from selection and personalization through paid, ordered, delivered, cancelled, or refunded. Ordering is an Ireland-operated workflow unless a particular supplier integration is separately selected. Release a gift for ordering only after the payment policy is satisfied. Record off-platform payments explicitly if Ireland keeps that option.

Earnest-money milestones record evidence and status; this app’s Stripe checkout is not a system for holding real-estate deposits or escrow.

### Dotloop and other sources

Make the mockup’s “already in Dotloop” path real: connection, loop selection, authorized document import, linkage, duplicate detection, refresh status, and actionable errors. Validate the actual account’s API and document permissions early. A manual upload remains a usable recovery path, but does not count as completion of the planned Dotloop integration.

References to MLS in the intake describe coordination requests. They do not establish an MLS license or API connection. MLS automation and Dotloop write-back require separate capability and business decisions.

### Saved records and assistant access

Persist operational facts, original evidence, emails, documents, history, permissions, drafts, proposals, confirmed changes, payments, and integration freshness. Authorized users and assistants must be able to find the same answer from the same records.

Example questions to support: “What is holding up this closing?”, “When was the deadline changed and why?”, “What did the lender last say?”, “Which files are still missing?”, “Has the service fee been paid?”, and “Which of my matters need attention this week?” Answers include sources and distinguish missing information, stale sync, proposed facts, and confirmed facts.

“Everything saved” means business records governed by an approved retention policy. It does not mean storing passwords, raw payment-card data, model reasoning traces, or unrestricted debug copies of client documents.

## Owner decisions and launch dependencies

Ireland supplies or approves the final catalog; payment and gift policies; domain and mailbox; service territory and timezone; brokerage rules and representative contracts; agreement and public copy; historical import scope; portal sharing policy; retention and deletion policy; and the external assistant clients allowed access.

Technical access needed includes the repository, Railway project, domain DNS, Google Cloud OAuth/Pub/Sub setup, Ireland’s Gmail authorization, Stripe sandbox and production configuration, OpenRouter account privacy controls, transactional email domain, and Dotloop developer/account access. Provider verification or permission lead times belong on the schedule immediately.

The release is complete when a real authorized transaction can move from onboarding/intake through documents, reviewed dates, communication, payment, closing, archive, and assistant retrieval—with cross-account privacy, recovery, and independent review demonstrated. Visual similarity alone is not the acceptance criterion.
