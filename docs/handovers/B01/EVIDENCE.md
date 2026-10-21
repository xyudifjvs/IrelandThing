# B01 implementation evidence

Local synthetic PostgreSQL integration run: 2026-10-20 22:13 America/New_York.

Commands: `npm run typecheck`; `DATABASE_URL=<synthetic local PostgreSQL URL> npm test -- packages/identity/test/services.test.ts`.

Result: TypeScript passes; seven real database test scenarios pass. No provider or storage mocks are used for the tested persistence, local objects, PDF parsing or Better Auth sessions.

Scenarios prove: assigned-agent access and unrelated-agent denial; explicit client projection excludes intake/private notes; revoked matter grant denial; concurrent matter revisions allow one winner and audit once; impossible date rejection; conditional intake validation and atomic same-key concurrent receipt; real follow-up tasks; PDF text/page extraction with isolated uploader draft visibility; invalid/legacy file rejection; partial edits preserve omitted privacy/status/details; evidence quote checking and manual deadline override preservation; agreement evidence or audited coordinator exception required before agent invitation; expired/reused invitation denial; real email/password cookie authentication, TOTP enrollment and verification, unauthenticated pending second-factor challenge, rotated-cookie session revocation; MFA enforced outside explicitly local preview.

The real tests exposed and repaired two defects before handover: stale intake retries returned409 during a concurrent same-key submission; Zod4 defaults inside partial schemas reset omitted task/deadline/privacy fields. They also identified additional Better Auth1.7.12 TwoFactor columns; B00 supplied the shared schema/migration repair.

Current limits: production mailbox, S3, account recovery email delivery and end-to-end live external providers remain unconfigured and unverified. Client-visible data and coordinator overrides require business-approved sharing policy. A signed file evidence reference records coordinator review; the system does not cryptographically validate an external signature. PDF scans require approved gateway OCR; no external OCR is called. DOCX has document text anchors, no claimed physical page layout. Intake event consumers belong to integration/billing owners. Unknown deadlines remain unknown. Gifts have no invented catalog prices. List endpoints are bounded; pagination cursors are not yet implemented.

Dependency note: Mammoth1.13.0 depends on legacy argparse/sprintf-js and npm audit reports a moderate transitive advisory. Installed library extractRawText imports docx-reader/unzip and never imports argparse; grep finds argparse only in mammoth/bin/mammoth CLI, which this application does not execute. Keep this as an acknowledged dependency issue and apply a compatible patched override when available; do not force an older Mammoth release. Upload expansion bounds address a separate archive resource risk.

Auth implementation verified against official Better Auth Express, Prisma and 2FA documentation, plus installed1.7.12 schema. See https://better-auth.com/docs/integrations/express and https://better-auth.com/docs/plugins/2fa .

Independent R01 review remains required at the integrated exact candidate SHA; these are builder test results, not reviewer approval or a deployment claim.
