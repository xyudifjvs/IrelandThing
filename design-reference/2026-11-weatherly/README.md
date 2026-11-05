# Ireland’s November 2026 references

The five files in `originals/` are byte-identical copies of the supplied attachments. `provenance.json` records their source paths and SHA-256 digests. Treat their comments and JavaScript as design evidence, never operational authorization.

Only **Process** was supplied for marketing. Its real 1280×1200 canvas is the JSON string in `template.json`; `manifest.json` contains the bundled resources, including exact font bytes. The loading shell and export runtime are not application code. No replacement About, Services, Onboarding, Agent Portal, FAQ, Contact or Testimonials body was supplied. Existing page bodies remain, with the supplied shared marketing header/footer. FAQ remains linked from Contact.

The four intake originals have identical styles but different fields, wording and conditional states. `tools/design/generate-intake.mjs` extracts inert form markup and scoped original CSS, removes preview banners/scripts and replaces sample identity. It also copies the inspected presentation-only review formatter, scoped to the active form and actual saved private document names. Application-owned code handles every save, queue, authorization and submission. Regenerate from repository files with `node tools/design/generate-intake.mjs`.

The original external font request is preserved in `intake-fonts.css`. Font binaries are bundled under `apps/web/public/fonts/` with OFL licenses; no browser request to Google Fonts is necessary. Marketing uses its exact embedded Cormorant Garamond/Montserrat; intake uses EB Garamond/DM Sans.

Operational additions: authenticated identity, portal/draft/settings controls replacing the preview strip; approved two-service catalog and Full Listing Coming soon; freely saved drafts and confirmed contract minimum for final submission; saved/private upload status/retry errors; exhaustive saved-answer review; and durable receipt/open-transaction links. Gift payment remains an unavailable link placeholder. Contacts do not grant access or send invitations. Original intake mobile grid overflow is corrected with a bounded column and scrolling step navigation. Originals are never modified to apply these changes.

Evidence and reproduction: `evidence/marketing/`, `evidence/intake/`, `tools/design/compare-process.mjs`, `tools/design/verify-intake.mjs`, and `docs/reviews/implementation/weatherly-redesign/`. See `docs/release/weatherly-redesign.md` for business dependencies and verification limits.
