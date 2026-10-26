# Railway staging deployment

## October 26 optional authenticator update

The owner requested email/password access without mandatory authenticator enrollment. The new application change removes that prerequisite consistently from browser login, authenticated API access, checklist sharing, background AI review and assistant grants. The session API retains `mfaRequired: false` for older clients. Authenticator enrollment remains available at `/security`; accounts that enable it still complete Better Auth's second-factor challenge. Existing roles, revoked access, agent agreements and provider approval gates are preserved. No database migration or credential change is required. Deployment and hosted verification of this update are pending; the earlier deployment below still describes its original acceptance checks.

## October 26 custom-domain release accepted

Current owner login after the October 26 handover: `ireland@weatherlytc.com`, display name Ireland. The authorized operator update changed the existing PostgreSQL user and its hashed password while preserving the user ID, coordinator role and MFA policy. Previous login credentials, sessions, reset tokens and assistant grants were invalidated as applicable. HTTPS sign-in, secure cookies, pre-enrollment MFA enforcement and sign-out passed with the new account details. Ireland must complete authenticator enrollment at first sign-in. The saved Railway bootstrap email/name now match Ireland; they are setup metadata, not the live login source. No password was stored as a Railway variable or committed to Git.

The site is live at **https://www.weatherlytc.com**, with https://weatherlytc.com forwarding to it. Railway ownership is verified and its HTTPS certificate is valid. The initial verification attempt appears to have expired or stalled before the October 26 DNS setup; a fresh connector retry cleared it. See `../runbooks/custom-domain.md` for the correction to the earlier outage diagnosis and the complete domain evidence.

API, worker and web successfully serve GitHub main commit `80e5a51796c7d067d50878d6834df2a309a42e2e`. Deployment IDs:

| Service | Successful deployment |
| --- | --- |
| API | `1e75bb67-64a7-44a7-bd5d-42d55de5b54b` |
| Worker | `61c091b5-1464-403b-900a-99f4bc58fbc1` |
| Web | `d9852e81-36f5-49fd-bf03-462e68ec1f9a` |

The API predeploy reports all 11 migrations current; a private database query confirms all completed and none failed/rolled back. The worker's heartbeat was 13 seconds old at acceptance and its private health endpoint returned 200. Railway reports all four services successful and no pending work. Exact serving revisions are verified separately from source pins and recorded in `infra/railway/staging.json`.

API/worker authentication and generated links now use canonical `www`. The fresh web build uses that origin and the private API address. Public HTTPS/health, canonical metadata/noindex, unauthorized API/document denial, invalid public-checklist token privacy, and browser home/login rendering passed. Owner sign-in uses Secure/HttpOnly cookies; the pre-enrollment MFA gate, same-origin checks, sign-out and old-cookie invalidation passed. The owner still must enroll MFA. No post-MFA business flow or real email/payment/AI integration is certified by these checks.

Root HTTP/HTTPS path forwarding works with 302. Squarespace requires fresh Google reauthentication before changing it to 301; that optional follow-up does not block use of the site. Google mail DNS records are unchanged. Keep `DEPLOYMENT_ENV=staging`, `SITE_INDEXING_ENABLED=false`, production authentication and all provider gates. Domain availability does not close the real-client readiness items in `requirements-evidence.md`.

## Historical deployment evidence

The dated sections below describe earlier states and are superseded by the accepted October 26 deployment above. In particular, the preview origin, `ed5b4aa` serving revision and provider-outage statements below are historical, not the current state.

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
