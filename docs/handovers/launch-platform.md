# Launch platform and public website

Owner: root build team. Independent checker: check_team_review. This checkpoint does not activate external accounts.

Implemented:

- Seven distinct public titles/descriptions, canonical URLs and social cards; Organization schema uses only known business facts. No fabricated service area, address, reviews or legal policy. Empty testimonials remain reachable but are excluded from navigation/indexing.
- Indexing requires all three build inputs: `DEPLOYMENT_ENV=production`, `SITE_INDEXING_ENABLED=true`, and an approved HTTPS `PUBLIC_SITE_URL`. Railway staging, IP addresses, local/internal/example/test domains and URL credentials/paths are rejected. Root/account/workspace/portal metadata defaults to noindex; public sitemap is empty in staging. Private API and account paths receive noindex HTTP headers. Robots allows public crawlers to see the noindex directives.
- Fonts served locally with OFL licenses; responsive portrait via Next Image; shared skip link, reduced-motion CSS, security headers, and a useful 404.
- Atomic PostgreSQL request buckets across API replicas, per-user REST/AI limits, and separate auth/inquiry limits. Bucket identifiers are SHA-256 hashes and old buckets are removed by the worker. Health and signed Stripe webhooks do not share a blanket request bucket. `TRUSTED_PROXY_CIDRS` must identify verified socket peers/subnets; empty means no forwarded-address trust. Better Auth sees a server-overwritten address header. Private networking and proxy configuration must still be verified on Railway before launch; empty configuration is conservative but can group anonymous users at the web proxy.
- Inquiry retry deduplication, conflict protection, honeypot and a minimal receipt response. Inquiries remain saved for coordinator review; no email or meeting confirmation is promised. No outbound notification delivery account is configured.
- Worker heartbeat and coordinator-only operations counts for stale workers, overdue/failed jobs, stale integrations and unreviewed inquiries. Queue payloads and provider error messages are not returned. This is visibility in the application, not an activated external alert service.
- Searchable, cursor-paginated coordinator user lookup for UI selectors.

Schema migration: `20261021180000_launch_operations`, additive request-limit/heartbeat tables and nullable inquiry deduplication fields. Deploy migration before new API/worker code. No destructive data changes.

Validation: eight focused tests passed against a newly created disposable local PostgreSQL database. They cover concurrent requests across two stores, expiry, spoofed address headers, authenticated-user isolation, inquiry retries/conflicts, operations authorization/redaction, user search/pagination, staging indexing and public metadata. Typecheck passed. The concurrency test caught a Prisma upsert race; the implementation now inserts with a unique key and reads the winning receipt.

Account gates: Carson's OpenRouter key may be read from ClassDocket only for synthetic route evaluation. User reports prompt logging may be enabled, so client-facing AI remains disabled and privacy verification remains false. Ireland's Gmail, Stripe, Dotloop and system-mail account setup waits for her accounts. No provider sends or charges are part of this checkpoint.

Remaining owner/operations work: final domain/geography and approved business policies, account activation and actual provider acceptance, external alert recipient/channel, backup cadence/retention/recovery targets and a hosted restore rehearsal, representative contract evaluation, and an approved external assistant client. Existing encrypted database-plus-object recovery tests remain part of integrated acceptance; they do not prove a hosted backup schedule exists.
