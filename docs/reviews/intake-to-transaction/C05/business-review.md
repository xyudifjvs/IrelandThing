# C05 file business command review

Candidate `f7d14d2c3719296453367bd5890029a4ce4e3c5f`, based on `68790df`. Independent reviewer R05. Verdict **changes requested**.

## Finding

**P2. Classifying a legacy file can silently increase its approved service price.** An active file with a null business, an Essentials package and a frozen Essentials snapshot was eligible to request payment at its historical price. Classifying the file as Weatherly and choosing its existing package enters the change branch. With no order, `termsForPackage` reads the live catalog and `changeFileBusiness` overwrites the original snapshot. In the isolated probe, the $390 snapshot at revision 3 became a $425 snapshot at revision 1, and the real billing order writer then created a $425 order. The package code was Essentials throughout. Preserve the valid matching file snapshot when the existing package stays the same, and enforce retained order compatibility before saving. Read current approved terms for a genuinely different package or a file without valid matching terms. [File business command](../../../../packages/matters/src/commands/file-business.ts#L118) · [Legacy creation snapshot](../../../../packages/matters/src/commands/lifecycle.ts#L41) · [Billing order amount](../../../../packages/billing/src/order-requests.ts#L160)

## Verified

- Global TypeScript, exact-commit diff check and 23 tests across four focused lifecycle/billing suites passed after all 19 migrations on disposable loopback PostgreSQL.
- An independent database probe exercised the exact candidate. Assigned agents and clients received 403, unknown files returned 404, forged business/package pairs failed validation, pending-review markers and terminal stages rejected edits, and stale revisions lost. Two edits using the same revision produced one writer and one audit. An exact current-value retry added neither a revision nor an audit.
- The independent probe verified an existing disjoint service order blocks a new package. A cancelled order with uncertain checkout creation blocked a disjoint package and was reused by the real billing order writer for matching terms. A fresh Weatherly package captured current approved terms and an unapproved catalog entry rejected the change.
- The accepted C09 checkout hook ran in the command transaction. A synthetic failure after the hook rolled back the Matter, checkout transition, expiration outbox job and audits. On success the HTO switch queued expiration for the exact open checkout and denied new service requests and agent resume. A fake checkout adapter confirmed one expiration across two job runs. The order snapshot, paid order, gift order, checklist row and processed intake receipt remained intact. Moving back to Weatherly rejected a disjoint paid package and used the matching paid order terms.

## Integration scope

C00 owns the API route and production hook composition. R07 separately reported the template refresh mismatch for existing drafts when the package or side changes. The C15 integrated test should exercise the mounted route with the corrected template hook and C11 linked row projection. D5 treatment of settled orders and dormant HTO history remains for Ireland to confirm. All evidence here uses disposable local data and a synthetic checkout adapter.

## Recheck of `b9b5f9dee91eacd6f641a76c8e9a5cbec0c8c36a`

**Changes requested.** The original classification regression is fixed. The exact $390 snapshot, revision and capture date survived classifying a legacy Essentials file. The actual order writer used $390. With no payment order, a direct Essentials to HTO to Essentials round trip also restored that snapshot and billed $390. A matching retained paid order with different terms took precedence over history and a disjoint order blocked the change. A first-time package selection used the current catalog.

**P2. Selecting a different package after HTO can restore a superseded agreement.** Starting with historical Essentials at $390, select Weatherly Complete, then HTO, then Weatherly Essentials. The package being changed from is the Complete package that immediately preceded HTO. The command instead finds the older Essentials-to-Complete audit because it filters audit records by the requested previous package before selecting the latest record. The actual order writer used $390 instead of the current $425 Essentials terms. Find the audit that started the current HTO period first, then restore its snapshot only if its previous package is the requested package. Leave retained-order precedence in place. [Audit lookup](../../../../packages/matters/src/commands/file-business.ts#L82)

Global TypeScript, the exact diff check, and 24 tests across four focused suites passed. The independent disposable database probe again passed authorization, one-winner revision behavior, uncertain-order recovery, checkout cancellation with a fake provider, transactional outbox rollback, and history preservation.
