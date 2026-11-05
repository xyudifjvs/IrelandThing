# Supplied Weatherly intake records

The November 2026 buyer, seller, buyer compliance and seller compliance forms save their original named controls in the optional `referenceIntake` object. The existing top-level intake fields remain the operational projection for legacy workflows. Existing drafts and historical submissions need no migration.

```ts
{
  version: 1,
  variant: "buyer" | "seller" | "buyer-compliance" | "seller-compliance",
  fields: Record<string, string | boolean>,
  uploads: {
    contractDocs?: string[],
    hoaFiles?: string[],
    utilFiles?: string[],
    policyFiles?: string[]
  },
  fileNames: Record<string, string>
}
```

`fields` includes the structured address (`a_num`, `a_street`, `a_city`, `a_state`, `a_zip`), seller occupancy (`occ`), clients (`b1_name`, `b1_email`, `b1_phone`, etc.), relationship (`buyerRel`, `buyerRelOther`), co-op and additional contacts (`co_*`, `c1_*`, etc.), title and lender paths/contacts, fee and commission instructions, HOA source/delivery answers, buyer MLS instructions, seller utilities/policy notes, gift choice/acknowledgment, and the separately approved contract-location field (`contractLocation`). Boolean values are reserved for `docsDotloop` and `giftAgree`. Branch changes retain hidden answers and previously uploaded evidence; a retained answer is not a new authorization.

Submission validates entered email addresses and dates, version/representation/service consistency, field lengths and upload limits. Draft saves remain available at any point. Final submission now requires either a saved executed-contract upload in `contractDocs` or a nonblank `fields.contractLocation` telling Ireland where to locate it. The `docsDotloop` checkbox alone does not establish a sufficient location. Legacy final submissions require uploaded contract IDs or a selected Dotloop source with its loop ID. The remaining per-field completion rules and what external locations are sufficient remain business decisions; the implementation does not blanket-enforce prototype required markers. Each group accepts at most 30 saved IDs, at most 120 unique intake documents overall; legacy intake still accepts at most 30 contract IDs. The legacy checklist fields retain their own 30-document limit.

Every upload group is included in the server's document ownership, committed-version and unassigned-document checks. Group-only uploads are associated with the resulting matter even when absent from top-level `documentIds`. A failed assignment rolls back the draft claim, receipt and matter. HOA-only evidence never substitutes for an executed contract in follow-up tasks. Extraction failure or a request for OCR does not remove an otherwise stored original file.

Both `Matter.details.referenceIntake` and the immutable `IntakeSubmission.snapshot.referenceIntake` retain the complete data. Existing matter API authorization exposes details to the owning agent and coordinator; client projections omit details. Coordinator-only assistant `intake_drafts` and `intake_submissions` record reads retain these objects. Private documents remain accessible through their existing authorized metadata/download routes. `fileNames` is presentation metadata; canonical document names, versions, checksums and bytes remain in the document store.

Additional contact answers create review tasks; they create no users, invitations or portal grants. Dotloop answers create review/follow-up work and do not connect an account or fetch files. Gift acknowledgment and supplied policy copy create no charge, credit, refund or paid state. Ireland approved the service mapping: `essentials` is **Contract to Close, $425 USD** and `complete` is **Contract to Close + Compliance, $515 USD**. New reference submissions must match their variant to the corresponding code. Full Listing is **Coming soon** and cannot create a new submission or payment request; its saved drafts remain resumable and historical receipt/order replays remain accessible.

The additive `20261105010000_weatherly_service_catalog` migration changes only current catalog rows and increments changed catalog revisions. It does not update historical matters, submission snapshots, payment amounts/snapshots or gifts. Every new submission stores an authoritative `serviceSnapshot` (`code`, `name`, `revision`, `priceCents`, `currency`) in both matter details and the submission snapshot. New checkout requests read the current server catalog; existing orders are returned from their saved snapshots before current catalog checks, preserving their original approved prices. The Full Listing catalog row retains its historical $625 value with `approved: false`; clients should display Coming soon and no order control.
