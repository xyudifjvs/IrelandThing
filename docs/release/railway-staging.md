# Railway staging deployment

## October 26 custom-domain setup; rollout held for TLS

The configured source for all three application services is now GitHub main commit `80e5a51796c7d067d50878d6834df2a309a42e2e`. The API build `45427fc5-8c92-4448-85db-57d7d636b7d3` was accepted and reached image upload, then canceled because Railway could not issue the domain certificate. No worker/web deployment was started. All services continue running the prior healthy release. There are 11 migrations in the reviewed release; API `npm run db:deploy` must complete before worker/web rollout.

The desired public origin is `https://www.weatherlytc.com`. Squarespace DNS and HTTPS apex path forwarding are configured; Railway ownership/certificate acceptance is still pending. API/worker origins were restored to the existing preview, and secure owner sign-in/MFA gating/sign-out passed there. No deployment is queued. Settings alone do not establish a completed release. Check `infra/railway/staging.json` and `infra/railway/custom-domain.json` for the last recorded state.

The October 21 sections below are retained as historical evidence and are superseded for the next release selection. Keep production authentication, MFA, staging noindex and provider activation gates.

Deployed at the user's explicit request on October 20, 2026 (America/New_York). This is a hosted staging system, not acceptance for real-client operations.

- Site: https://web-staging-be4e.up.railway.app
- Railway project: https://railway.com/project/5b58af24-8d43-4226-8901-a5dd63c5dfbb
- GitHub repository: `xyudifjvs/IrelandThing`, branch `build/B00-foundation`.
- Resource identifiers, configured source pins and actual serving revisions: `infra/railway/staging.json`.
- Custom domain preparation: `www.weatherlytc.com` is attached to web but awaits owner DNS access and TLS verification. Existing public origin and deployed authentication settings are unchanged. Exact DNS records and coordinated cutover steps: `../runbooks/custom-domain.md` and `infra/railway/custom-domain.json`.
- Completed rollout verified at October 21, 2026 00:16 EDT: API, worker and web all serve the pinned `ed5b4aa` revision successfully. PostgreSQL and all three application services have one running replica, no crashed replicas, no reported issues and no pending work. The manifest records each healthy deployment ID.
- Only web has a public domain. API, worker and PostgreSQL have no public domains or TCP proxies. Documents use a private Railway bucket.
- PostgreSQL 17 uses a persistent volume. API, worker, web and database use one replica each in `sfo`; the document bucket is in `iad`.
- The three application services build their repository Dockerfiles from their pinned GitHub commits. No local image or `.next` output is uploaded, and branch pushes do not automatically change the pinned release.

## Launch-readiness candidate awaiting Railway recovery

The October 21 launch-readiness batch supersedes the copy-only rollout below. Integrated product checkpoint `d1f7d8b` includes SEO/indexing safeguards, local fonts, mobile/accessibility and intake recovery improvements, document sharing/version controls, shared request limits, worker/queue visibility, payment-mode isolation and grounded assistant retrieval. All three application services need the reviewed release commit. The additive ninth migration `20261021180000_launch_operations` must run before the new API and worker start; it adds request-limit/heartbeat tables and inquiry deduplication fields. Do not deploy only the web service for this batch.

At the latest October 21 check, Railway still reports builds paused. All four existing services are healthy with no pending deployment; application services still serve `ed5b4aa`. No source pin, credential or provider-account change was made for the launch-readiness batch. The local preview and repository therefore contain changes absent from the hosted staging site.

After Railway resumes builds: inspect pending work, choose the final CI-passing commit from `validation.md`, pin API/worker/web to that same commit, apply the additive migration through API predeploy, then verify all three deployments and worker operations status. Keep `SITE_INDEXING_ENABLED=false` and provider activation disabled. Recheck health, sign-in/MFA, unauthorized denials, private-document permissions, SEO headers and the real proxy chain before recording new serving revisions. Configure `TRUSTED_PROXY_CIDRS` only from verified Railway peers/subnets; an empty value remains conservative but groups anonymous users at the web proxy. The manifest must record actual successful deployments, not intended pins.

## Historical copy-only deployment attempt

On October 21, 2026 at approximately 11:04 EDT, the reviewed copy revision `c5a3e38da3a5823c0ca52b66b818d85e29f4c708` was saved as the web service's source pin. API and worker pins remain `ed5b4aa`. The staged change affected only the web source commit; no variables, storage or network configuration changed.

The connector accepted the staged change but created no deployment. A direct, commit-specific deploy request then returned `Deploys have been paused temporarily`. Railway's [status page](https://status.railway.com/) confirms an active platform incident with builds paused in all regions. The existing four services remain healthy, and all three application services still serve `ed5b4aa`. The revised copy is visible only in the local preview until a new web deployment succeeds. A saved source pin is not proof of a completed or queued rollout.

[GitHub quality run 39621674869](https://github.com/xyudifjvs/IrelandThing/actions/runs/39621674869) passed on the exact copy revision: fresh PostgreSQL migrations, TypeScript, tests, production build, HTTP acceptance and deployment safeguards. Independent copy review passed after corrections to deadline scope, saved contact instructions, Dotloop availability and email suggestions. Local browser checks covered the revised login, homepage, workspace, portal and intake entry; this pass did not add mobile or real-provider acceptance.

The original recovery instruction was a web-only rollout of `c5a3e38`. That instruction is superseded by the launch-readiness candidate above; it does not cover the new API/worker changes or database migration.

## Verified on the initial deployment

All four services reached Railway `SUCCESS`, one running replica each, no crashed replicas and no pending staged changes. The API's predeploy step applied all eight migrations successfully over private PostgreSQL networking. The worker started successfully and its heartbeat health check passed. The fresh web build passed TypeScript and generated 28 static pages; its `/health` check verifies the private API/database path.

Public HTTPS `/health` returns 200. Unauthenticated matter, session and assistant-record requests return 401. MCP POST returns 503 `MCP_UNAVAILABLE` while the feature is disabled. The browser shows the real hosted home, portal entry and sign-in pages; the local demo login is absent.

The final source rollout passed Railway health checks for all services; public health and unauthenticated session/matter/assistant denials were rechecked successfully. GitHub quality gates also passed at `ed5b4aa` ([run 39539767541](https://github.com/xyudifjvs/IrelandThing/actions/runs/39539767541)) and the documentation checkpoint `e5d3d9e` ([run 39542762330](https://github.com/xyudifjvs/IrelandThing/actions/runs/39542762330)).

A private SSH diagnostic confirmed production runtime/authentication mode, the exact public origin, absent live-provider keys and authenticated private bucket access (HeadBucket 200). A synthetic object was written, read back exactly and removed successfully. The new database initially contained zero users and zero matters. No local sample data, email accounts or payment accounts were copied.

## Access and release limits

The user authorized a temporary initial coordinator using their own email until Ireland's address is available. Bootstrap completed on October 21, 2026 (America/New_York), using the exact reviewed `ed5b4aa` source: its SHA-256 was checked inside the deployed API container before execution. Private database checks confirm exactly one correctly named coordinator, zero matters and the three approved prices ($375 / $475 / $625).

The nonsecret bootstrap email/name inputs are stored on Railway's API service; the password and exact-email confirmation were supplied only to the one-time SSH process. A subsequent fresh process confirmed neither secret setup input remained in the service environment. Initial credentials are delivered in a private ignored local file, never committed or printed in deployment logs.

Hosted HTTPS sign-in passed with Secure/HttpOnly session cookies. The authenticated session reports required MFA enrollment, business-data access returns 403 `MFA_REQUIRED` before enrollment, and sign-out returns the session to 401. Authenticator enrollment is left for the owner. After bootstrap, changing an environment input does not change the persisted user; handover must update the application account deliberately.

Gmail, Stripe, Dotloop, OpenRouter, transactional email and external MCP remain unconfigured/disabled. Ireland's own Stripe account is still required. No real email, AI request or payment was sent. The remaining acceptance/operations work in `validation.md` still applies, including real provider journeys, a hosted restore rehearsal and monitoring. The API's current process-local rate limiter treats requests arriving through the web proxy as a shared origin; review proxy-aware limits before broader traffic. Bucket/database backups are not claimed to be scheduled by this deployment.

To publish a reviewed update, stage the desired GitHub commit for each affected application service, inspect the changes, deploy and verify service/HTTP checks. Keeping commits pinned intentionally prevents an unrelated branch push from silently replacing the hosted version.
