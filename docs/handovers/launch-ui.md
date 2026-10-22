# Launch UI handover

Base: `e89a29f`, branch `build/launch-ui`. This batch changes only account, portal and workspace frontend paths plus this handover. It does not connect a provider, create customer data, deploy, or change server authorization. Ireland’s Gmail, Stripe, Dotloop and system email setup remains on hold.

## Delivered workflows

- Mobile coordinator Account menu includes Settings, profile, portal, support and sign-out. Sign-out errors are visible and retryable. Desktop navigation is preserved.
- Owned route groups expose one `main-content` main landmark, with route-change focus. Root owns the single global skip link and its styles. Account/portal inner wrappers were converted to divs to avoid nested or duplicate main landmarks.
- Transaction tabs expose selected state and the labelled panel. Left/right arrows, Home and End move focus and selection; only the current tab enters the normal tab sequence.
- Document lists paginate and can refresh. Coordinators choose agent/client/coordinator visibility, change it with the saved revision, or remove all portal access. Sharing/revocation explicitly covers **all versions** of the document. Existing authenticated download endpoints remain the only file links.
- File disclosures fetch complete version history and link the exact immutable version. Coordinators can upload a new matching-format version; authorized agent uploaders can revise their own agent-visible documents. Client-shared versions are managed by Ireland. Previous versions remain available under the document's current sharing policy. File validation preserves selected files and form entries after an error. API conflict errors remain visible, with explicit reload rather than silent overwrite.
- Intake shows dirty state immediately, distinguishes it from the last successful save, announces each step, focuses step headings and validation errors, and surfaces draft-list errors before allowing a separate new intake. Resume/reload fetches the latest saved draft and preserves current entries on retrieval failure. Save failure leaves fields intact. Pending uploads must be uploaded or cleared before saving. Native reload/close and ordinary in-app link navigation warn about unsaved entries; browser-specific Back/Forward behavior still needs independent browser validation.
- Calendar and portal enumerate every authorized matters page before presenting a complete list; a failed page does not become an empty calendar. Portal includes address/title filtering. No server date filtering or new data projection is invented.
- Existing-account permissions and agent assignment use searchable/paginated name/email selection. Invitation transaction access uses MatterPicker. New agent agreement evidence uses the agent's email; invitation agreement matching is performed by the server instead of exposing agreement IDs. Signed evidence has a download link.
- Settings has a compact read-only operations panel for worker check-in, failed/overdue/interrupted jobs, unreviewed inquiries, connection freshness and safe failure descriptions. Links lead to existing onboarding, inbox and connection views. No generic resend/retry/charge action is provided.

## Integration contracts required from root

`GET /api/v1/users?q=&cursor=&limit=` must be coordinator-only, return a direct array, use stable ID ascending order and the last record ID as cursor. Search matches name/email; limits default/max 200. The old endpoint ignored search/cursor, so integrate the root backend update before browser acceptance.

`GET /api/v1/operations` supplies the root-approved worker/job/inquiry/connection/failure projection. The panel has an explicit error state until that endpoint is integrated; it never substitutes a healthy result.

Documents reuse existing `GET /documents`, `GET /documents/:id`, `PATCH /documents/:id {expectedRevision,visibility}`, multipart `POST /documents`, multipart `POST /documents/:id/versions`, and version-specific download URLs. No document deletion or per-version permission model is assumed.

## Validation and independent review

Frontend TypeScript and whitespace/diff checks pass. Root owns the final integrated suite, production build and browser acceptance. No new mirror tests were added. Preserve the untracked `node_modules` symlink; do not stage it.

Independent review should cover mobile menu keyboard access and sign-out errors; a single skip target per route; tab arrow/Home/End behavior; more than 200 portal/calendar records; user searches past the initial page; document sharing, stale-revision errors and denial of historical download URLs after revoke; exact version downloads; intake resume failure, dirty status, failed-save preservation and step/error focus. Use only isolated synthetic records, and do not activate Ireland’s providers.
