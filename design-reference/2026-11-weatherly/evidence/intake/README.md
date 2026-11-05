# Final production-browser evidence

Recorded against the final local production Next build and a separate synthetic PostgreSQL/API environment. No provider account or real client record was used.

`results.json` contains all 166 comparisons and 12 workflow check groups. Four distinct forms, all six steps, every conditional reveal (including nested HOA delivery, gift tiers and multiple-client relationship), and 390px mobile layouts are exercised. Sidebar width, background and navigation labels match in every capture.

The source form comparisons have matching dimensions and **zero differing interior RGB values in all 166 cases**. 164 crops are wholly identical; two seller gift-off crops have a one-pixel exterior top-row clipping difference (681 pixels), with identical interiors. These measurements do not claim whole-application pixel identity.

Normalization is explicit: the preview strip is replaced by real portal controls; its height is equalized for form capture. Sample identity is replaced with the actual synthetic session identity. Live save overlays are hidden. Added contract-location, contact-policy review and exhaustive saved-answer controls are hidden only for original-content comparison. The original mobile overflowing column is bounded identically for comparison; production preserves a horizontal scrolling step rail. Originals remain byte-identical on disk. Native hover is moved out of the form before capture.

Side-by-side files show original on the left and application on the right. Four rows in the start-step contact sheets are buyer, seller, buyer compliance, seller compliance. Separate buyer comparisons retain more readable resolution. `seller-compliance-real-review.png` shows the actual full saved-record review, including the application additions. `client-live-request.png` and `client-live-completed.png` show the same no-login client link before/after coordinator completion.

Real checks cover authenticated save/resume, network-failure retry, uploaded-only HOA/utilities evidence, retained hidden answers, complete contact review, private downloads, idempotent durable receipts, blank-final rejection, contract-location minimum, approved $425/$515 snapshots, variant switching, Full Listing coming-soon restrictions, unauthorized/client intake denial and same-origin writes. Client task completion automatically updates both the agent API projection and the live client view without separate completion records.

Reproduce with the synthetic local seed, private local object storage and a production web build:

```sh
WEATHERLY_COMPARE_ORIGIN=http://127.0.0.1:3314 node tools/design/verify-intake.mjs
```

The runner creates its own synthetic PDF/DOCX fixtures. Additional independent mocked recovery/race checks are recorded separately in `docs/reviews/implementation/weatherly-redesign/`; they are not presented as real authentication/storage evidence.
