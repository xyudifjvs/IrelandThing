# Independent redesign review

The initial review below predates Ireland’s subsequent catalog/completion decisions. The final follow-up record in `final-review.md` supersedes its business-dependency statements and covers the added approval/client-request implementation.

Reviewed November 4, 2026 on `codex/weatherly-reference-redesign`, before the final implementation commit. The reviewer did not author the application changes. `source-sha256.json` identifies the reviewed application files; this review does not certify later source changes or a hosted deployment.

No remaining code blocker was found in the reviewed snapshot after the fixes below. Release acceptance also depends on the primary agent's real authenticated storage/submission journeys, complete visual comparison results, regression suite and final build. Mocked browser checks are not evidence that a real document was stored or that a real session was authorized.

## Independently verified

- All five preserved originals match their provenance SHA-256 values. The four intake references have identical source CSS; sharing the extracted CSS does not flatten their distinct fields or branches.
- Inspected the four inert production templates, presentation-only review formatters, scoped DOM controller, normalized operational fields, draft/resume flow, upload queue and private document association. No prototype completion action, sample identity, provider activation, invitation or payment action was carried into production behavior.
- Inspected backend role checks, exact revision claim, idempotent receipt handling, upload ownership/current-version checks, atomic matter association and client projections. Full reference records remain in authorized matter details and immutable submission snapshots; client projections omit them.
- Independently exercised 96 normalized combinations of variant, title source and lender source against the real intake schema, including stale choices retained after side changes. All passed, and old hidden manual lender contacts were absent from the active operational projection.
- TypeScript and `git diff --check` passed during review. Free-text values including `cash`, `yes`, `constructor`, `__proto__` and HTML-looking text remained verbatim in display helpers.
- Ran `tools/design/check-intake-recovery.mjs` against the production web build at loopback port 3314. Its session/intake/document API responses are explicit synthetic mocks. The committed `independent-ui-evidence.json` records the passing scenarios and absence of browser errors.

The independent browser checks demonstrate visible/removable invalid legacy Word files; a successful upload followed by a failed draft association; visible retry without a second bytes upload; removal after failed association; removal of a saved attachment from both its group and filename metadata; disabled inputs and communication settings while a snapshot is saving; dropped-file rejection during that save; retained through-agent instructions; step-heading focus; correct Full Listing selection; and safe rejection of inherited URL variant names.

## Defects returned to the implementer and rechecked

- Invisible invalid queue entries and hidden retry controls after association failure.
- Orphan filename metadata after document removal, and failed-queue removal retaining an unwanted attachment.
- Duplicate selections moving an existing queue entry to another upload group's display.
- New title/lender paths conflicting with old schema rules, and hidden manual lender details being promoted as active contacts after a path change.
- File inputs using React change extraction that did not fire for injected controls. Native bubbling input events now reach the form controller.
- Save/submission races accepting new fields or dropped files after a snapshot was taken; communication settings required the same guard as the form.
- Full Listing selection reopening Essentials, loss of the through-agent communication control, and ineffective focus calls on nonfocusable headings.
- Choice translations altering free text or returning inherited object properties, and inherited URL names bypassing the variant allowlist.
- Loss of FAQ discoverability through the new combined navigation label. The existing FAQ is linked from Contact.

The recovery/race cases were rerun against the production build after these fixes. Backend source review found no new cross-account exposure or provider action.

## Scope limits and business dependencies

The independent reviewer inspected the visual comparison scripts and required correction of nested-branch coverage and a valid positive revision for idempotency replay. Whole-page Process parity evidence and cropped intake-form comparisons belong to the design evidence directory. An intake form crop does not establish rail/toolbar parity. Mobile comparisons that repair the original's overflowing rail must disclose that normalization; they do not establish byte-for-byte rendering of the uncorrected original mobile page.

Existing catalog codes/prices remain explicit; the new labels do not establish an approved billing-package mapping. Gift catalog/prices/payment link and operational credit policy remain unresolved. Visible required markers retain the authorized incomplete-submission behavior. Additional contacts require coordinator review and do not grant portal access or send invitations. Other marketing page bodies lack replacement references. No live deployment, provider readiness, real-client migration or end-to-end real-account acceptance is certified by this review.
