# Railway staging deployment

Deployed at the user's explicit request on October 20, 2026 (America/New_York). This is a hosted staging system, not acceptance for real-client operations.

- Site: https://web-staging-be4e.up.railway.app
- Railway project: https://railway.com/project/5b58af24-8d43-4226-8901-a5dd63c5dfbb
- GitHub repository: `xyudifjvs/IrelandThing`, branch `build/B00-foundation`.
- Resource identifiers and pinned source revision: `infra/railway/staging.json`.
- Current rollout: the API and worker serve `ed5b4aa` successfully; web still serves `a47f4ef` while its `ed5b4aa` rebuild finishes. The manifest distinguishes each serving revision from the pending target.
- Only web has a public domain. API, worker and PostgreSQL have no public domains or TCP proxies. Documents use a private Railway bucket.
- PostgreSQL 17 uses a persistent volume. API, worker, web and database use one replica each in `sfo`; the document bucket is in `iad`.
- The three application services build their repository Dockerfiles from the pinned GitHub commit. No local image or `.next` output is uploaded, and branch pushes do not automatically change the pinned release.

## Verified on the initial deployment

All four services reached Railway `SUCCESS`, one running replica each, no crashed replicas and no pending staged changes. The API's predeploy step applied all eight migrations successfully over private PostgreSQL networking. The worker started successfully and its heartbeat health check passed. The fresh web build passed TypeScript and generated 28 static pages; its `/health` check verifies the private API/database path.

Public HTTPS `/health` returns 200. Unauthenticated matter, session and assistant-record requests return 401. MCP POST returns 503 `MCP_UNAVAILABLE` while the feature is disabled. The browser shows the real hosted home, portal entry and sign-in pages; the local demo login is absent.

A private SSH diagnostic confirmed production runtime/authentication mode, the exact public origin, absent live-provider keys and authenticated private bucket access (HeadBucket 200). A synthetic object was written, read back exactly and removed successfully. The new database initially contained zero users and zero matters. No local sample data, email accounts or payment accounts were copied.

## Access and release limits

The user authorized a temporary initial coordinator using their own email until Ireland's address is available. Bootstrap completed on October 21, 2026 (America/New_York), using the exact reviewed `ed5b4aa` source: its SHA-256 was checked inside the deployed API container before execution. Private database checks confirm exactly one correctly named coordinator, zero matters and the three approved prices ($375 / $475 / $625).

The nonsecret bootstrap email/name inputs are stored on Railway's API service; the password and exact-email confirmation were supplied only to the one-time SSH process. A subsequent fresh process confirmed neither secret setup input remained in the service environment. Initial credentials are delivered in a private ignored local file, never committed or printed in deployment logs.

Hosted HTTPS sign-in passed with Secure/HttpOnly session cookies. The authenticated session reports required MFA enrollment, business-data access returns 403 `MFA_REQUIRED` before enrollment, and sign-out returns the session to 401. Authenticator enrollment is left for the owner. After bootstrap, changing an environment input does not change the persisted user; handover must update the application account deliberately.

Gmail, Stripe, Dotloop, OpenRouter, transactional email and external MCP remain unconfigured/disabled. Ireland's own Stripe account is still required. No real email, AI request or payment was sent. The remaining acceptance/operations work in `validation.md` still applies, including real provider journeys, a hosted restore rehearsal and monitoring. The API's current process-local rate limiter treats requests arriving through the web proxy as a shared origin; review proxy-aware limits before broader traffic. Bucket/database backups are not claimed to be scheduled by this deployment.

To publish a reviewed update, stage the desired GitHub commit for each application service, inspect the changes, deploy and verify all services/HTTP checks. Keeping a commit pinned intentionally prevents an unrelated branch push from silently replacing the hosted version.
