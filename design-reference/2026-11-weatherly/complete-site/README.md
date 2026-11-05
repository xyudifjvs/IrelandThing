# Complete supplied Weatherly site

The owner supplied `/Users/carson/Downloads/Weatherly Transaction Co. Website.html`. The preserved file is byte-identical: **8,386,448 bytes**, SHA-256 **288054418eae3dbd72023857535e2acd1e8ecdb435cb9407f305172dfb9a3686**. `provenance.json` records the original location. The five earlier supplied files are preserved separately, unchanged.

The outer and six nested bundler manifests/templates are decoded using JSON, base64 and gzip only. No bundled JavaScript is executed, rendered, imported, or deployed. `decoded-pages.json` preserves each original static canvas and body. The production route mapping is About Me `/`, Services `/services`, Process `/process`, New Agent Onboarding `/onboarding`, Agent Portal `/agent-portal`, FAQ & Contact `/contact`. Historical `/faq` and `/testimonials` links redirect to the combined contact page and Home testimonials anchor.

`assets.json` records 44 embedded image/font resource references mapping to nine exact local files. The generator verifies source provenance and extracted asset byte length/SHA-256; the browser comparator verifies served production font/image bytes against the same hashes. No third-party fonts/images or export runtime are requested. Font licenses and family/subset mapping ship at `apps/web/public/brand/site/README.md`, beside unchanged SIL OFL 1.1 license copies.

The safe static markup generator rejects executable or embedded elements, event handlers, form actions, unsafe links including escaped protocol-relative separators, nonlocal `src`/`srcset`/CSS URLs and CSS imports/escapes. Known original relative page links and the original Calendly anchor are allowed only in the preserved reference; production links are internal. `static-safety.json` records successful body/header/footer checks for all six pages. Handwritten shared React header/footer contain fixed escaped text and internal/mail/telephone links. Fifteen focused negative injection/resource cases pass.

## Deliberate operational differences

- Services preserves the supplied $425/$515 offerings, Full Listing Coming Soon and gift tiers. Only the two compliance references are narrowed to Howard Hanna and the termination sentence specifies **before closing**, matching owner policy. Gift prices/names are presentation only; no gift billing product or checkout is activated.
- Onboarding retains original visible copy/layout and has real information and agreement-request fields. The brokerage field is readonly **Howard Hanna**, replacing a generic placeholder. Agreement requests include structured team and office fields. The email-only information request uses the approved backend shape.
- Onboarding/contact submission persists a request through the existing API. Pending controls lock, failed saves retain values, and identical retries reuse the request ID. Confirmed receipts say what was saved and explicitly disclose that no email, service agreement or invitation has been sent. A generic Calendly link uses validated configured scheduling only; otherwise it opens a call-request form that explicitly says it has not booked an event, created Zoom or sent email. No provider is activated.
- The supplied Agent Portal login uses the real authentication/session flow and optional MFA. MFA clears the password, locks original credentials and supports authenticator/backup codes. Failure/recovery UI and pending/received states appear only after interaction.
- Internal anchor/form names, required/autocomplete attributes, hidden receipt/MFA/booking hosts and working route targets have no initial visual effect. Original placeholder testimonials/FAQ copy remain supplied placeholders; they have not been represented as verified testimonials or final business answers.
- Authenticated portal, coordinator workspace and shared checklist styles adopt the supplied fonts, warm surfaces, black navigation/buttons, square cards and muted borders. Their data, layouts and functional controls remain application UI. The source contains no authenticated screen design, so these are style-alignment captures, not pixel-equivalence claims.

## Verification and evidence

Run from the repository root with a **local isolated synthetic** API/web preview:

```sh
node tools/design/test-static-reference-safety.mjs
node tools/design/generate-complete-site.mjs
node tools/design/check-complete-site-forms.mjs
node tools/design/compare-complete-site.mjs
node tools/design/capture-portal-style.mjs
```

Set `WEATHERLY_COMPARE_ORIGIN` only to localhost/127.0.0.1 if using another port. Browser scripts use installed Chrome (override `CHROME_EXECUTABLE` as needed). Form checks mock API responses and do not create business records or call providers. Style captures authenticate the local synthetic fixtures and perform read-only navigation. The eight portal/workspace captures passed no horizontal overflow at 1280 and 390 pixels. Source/public comparisons use 1280×1200 and 390×844 with matching viewport meta, DPR 1, original static local fonts/images, and expanded disclosure checks on Home, Services and Contact. Captures wait for fonts/images and consecutive stable painted frames; Next's dev indicator is removed from evidence.

`evidence/site/` contains eighteen original-left / application-right pairs, metrics and five passing form-contract checks. `evidence/portal-style/` contains agent overview/detail and coordinator overview/detail at both widths. `evidence/sha256.json` records evidence file hashes. The JSON records retain their original `.local/redesign` output paths; the same filenames are preserved here. These captures and metrics have been refreshed from the root production-build acceptance rerun.

Raw pixel comparisons below include every pixel, with no regions masked and no arbitrary image transforms. Source and application heights match in every case and there is no horizontal overflow. Unchanged Process, Agent Portal, Contact and closed Services are raw zero at both widths. Onboarding's difference is the Howard Hanna field. Expanded Services differences are the named compliance/termination wording. Home portrait/logo rasterization varies across Chrome runs, including raw-zero runs; the latest JPEG differences have identical source/served bytes, geometry, object-fit and object-position, and small channel deltas. This is recorded rather than claiming an unconditional raw-zero Home result.

| Page | Width | State | Changed pixels | Reference / app height |
| --- | --- | --- | ---: | --- |
| home | 1280 | default | 108549 | 2246 / 2246 |
| home | 1280 | expanded | 108524 | 2460 / 2460 |
| services | 1280 | default | 0 | 1527 / 1527 |
| services | 1280 | expanded | 8819 | 3937 / 3937 |
| process | 1280 | default | 0 | 1358 / 1358 |
| onboarding | 1280 | default | 697 | 1922 / 1922 |
| agentPortal | 1280 | default | 0 | 1016 / 1016 |
| contact | 1280 | default | 0 | 1649 / 1649 |
| contact | 1280 | expanded | 0 | 1798 / 1798 |
| home | 390 | default | 0 | 3234 / 3234 |
| home | 390 | expanded | 0 | 3858 / 3858 |
| services | 390 | default | 0 | 2521 / 2521 |
| services | 390 | expanded | 9399 | 7179 / 7179 |
| process | 390 | default | 0 | 2441 / 2441 |
| onboarding | 390 | default | 683 | 3195 / 3195 |
| agentPortal | 390 | default | 0 | 1458 / 1458 |
| contact | 390 | default | 0 | 1991 / 1991 |
| contact | 390 | expanded | 0 | 2141 / 2141 |
