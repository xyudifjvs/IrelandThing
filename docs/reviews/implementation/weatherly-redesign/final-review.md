# Final independent web and catalog review

Reviewed November 4, 2026 on `codex/weatherly-reference-redesign`, before commit. No remaining blocker was found in the reviewed source after the corrections below. `final-source-sha256.json` identifies this snapshot; later source changes, final combined validation and deployment require their own evidence.

This reviewer did not author the intake controller, normalized records, client-request UI, calendar, approval services or billing/catalog implementation reviewed here. The reviewer did author the Process/shared marketing presentation and marketing catalog copy, so this is not an independent certification of those authored visual changes. Their measured comparison evidence is recorded separately.

## Superseded business assumptions

The last section of `independent-review.md` predates Ireland's subsequent decisions. Its unresolved mapping and unrestricted blank-final assumptions are superseded by the following approved behavior:

- Contract to Close is $425 and Contract to Close + Compliance is $515, both buyer/seller, retaining internal `essentials`/`complete` codes. Full Listing is Coming soon and cannot create a new intake submission, coordinator matter or payment request. Existing matters and payment/submission snapshots are preserved; existing drafts remain resumable.
- Draft saving remains possible at any point. Final submission requires an executed-contract upload or an explicit contract location. A Dotloop checkbox alone does not meet that minimum. Other field-by-field completion and location-specificity rules remain pending.
- Extracted/calculated dates require Ireland's confirmation before they populate authoritative dates in tasks, calendars or shared timelines. Client requests require explicit coordinator selection and client visibility; no automatic access grant or invitation follows.

The earlier review's fault-injection evidence remains useful for its named scenarios, but its old Full Listing selection expectations do not establish current availability. Gifts, provider activation, client-response interactions and other deferred policy inputs remain subject to the current release record.

## Rechecked implementation

- Real session identity, partial draft saves, resume, queued uploads/retry, revision protection, immutable/idempotent receipts and the contract minimum are wired through the existing authenticated API. Both the browser and submission service enforce the final minimum. All upload groups survive normalization and are available in exhaustive review and authorized saved-intake detail; clients do not receive that full record.
- Current catalog labels/prices reach new submissions and saved service snapshots. The catalog migration changes catalog rows rather than historical matters/orders. Historical payment replay remains separate from new-request pricing. Full Listing gates now cover intake submission, direct coordinator matter creation and new checkout.
- Public client checklists use live canonical task records. Only client-visible tasks with explicit `client_request` kind populate What we need from you; private details are stripped. Completion/visibility changes affect the same shared task. The browser remains read-only, and offline/failed/revoked reads conceal the public view.
- Calendars filter contract deadlines to `confirmed`; scheduled ordinary coordinator tasks remain visible. Read projections suppress unapproved rule-owned task dates. Recalculation now orders dependent rules by anchors and re-reads transactional changes, so a changed upstream approval cannot leave an authoritative downstream date merely because presentation order is reversed. Explicit approved source overrides remain preserved.
- Communication defaults initialize into the saved reference record. The normal review displays the effective policy with a Change control; Resume & preferences exposes the selector, and preference edits refresh review immediately.

## Findings corrected and rechecked

1. Services SEO/share metadata advertised old names/prices; it now states $425/$515 and Full Listing Coming soon. The homepage metadata no longer advertises available pre-listing support.
2. Dashboard's Add a listing CTA opened a standard seller intake despite promising the unavailable service; it is now noninteractive Coming soon text.
3. Calendar help said proposed dates were displayed; it now distinguishes confirmed dates/scheduled tasks from proposals reviewed within the transaction.
4. Coordinator `POST /matters` bypassed the Full Listing gate; `createMatter()` now returns `SERVICE_COMING_SOON`, with a real-session HTTP acceptance assertion added.
5. The effective communication default was hidden from review and the selector was only discoverable under Resume; the saved default, explicit preferences label and review/change control now address both issues.

TypeScript and `git diff --check` passed during this follow-up. The reviewer inspected current implementation and meaningful approval/client-request/catalog regression assertions; no application records or source were changed by this review. Separately, the independent records reviewer reported passing real-database normal-order and reversed-order date-chain checks, and the primary agent reviewed the source. Those reports are separate evidence, not tests rerun by this web reviewer.

The primary agent is completing the final combined production build, regression/HTTP acceptance and real authenticated browser/storage evidence. Source review and local rendering are not proof of a live deployment, provider readiness, complete business-policy approval or real-client acceptance. Whole-application exact visual parity is not claimed; Process and intake comparison scope/normalizations are disclosed in their evidence directories.
