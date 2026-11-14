# Custom email merge fields

Ireland requested custom field creation at the bottom of the email-template settings on November 14, 2026.

The local implementation adds a Custom merge fields section with a display name, stable template code such as `{{custom_closing_instructions}}`, and optional default value. Coordinators can create and edit definitions. Email templates accept saved custom codes in subjects and bodies; unknown codes are rejected. The composer shows the custom fields used in the selected template and accepts values for an individual email. Those values are stored with the draft's existing template snapshot, and changing them requires refilling and reviewing the draft before sending. The saved-draft refill button explicitly says that it replaces saved wording. Custom values cannot override canonical transaction fields such as the property address.

Definitions use the new `CustomMergeField` table. Deploy migration `20261114010000_custom_email_merge_fields` before starting the updated API. Existing templates and transaction data are retained. This implementation uses manual custom values/defaults; creating a custom code does not automatically extract a new fact from an uploaded contract.

Validation performed locally:

- Prisma client generation and full repository TypeScript checking passed.
- Five focused regression cases passed through TypeScript module execution with Vitest-compatible assertions and a mocked database: namespace/input validation, coordinator access, duplicate/stale edits, defaults/overrides/canonical-fact protection, and missing/unknown codes.
- Component module rendering checks with mocked data/hooks verified creation inputs, used-field selection, and default input values.
- `git diff --check` passed.

The normal Vitest runner could not start because the existing dependency installation lacks Rolldown's native binding. These targeted checks do not certify database migration or real browser interaction. Migration execution, browser acceptance, and deployment remain pending. No emails were sent.
