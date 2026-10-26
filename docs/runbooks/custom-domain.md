# Connect weatherlytc.com

Updated October 26, 2026. Squarespace DNS and root forwarding are configured. The reviewed release and web build settings are prepared. API/worker origins remain on the working preview until valid HTTPS permits the coordinated switch. The domain is not yet accepted. This is not approval for real-client operations.

## October 21 preparation state (historical)

- Railway has `www.weatherlytc.com` attached to the existing web service, port 3000, in the existing staging environment. Domain ID: `d16dc661-04dd-43af-b86e-5ecc764377bf`.
- Ownership is unverified and its TLS certificate is waiting for verification. The existing Railway URL still serves the current hosted deployment. No deployment was triggered by this preparation.
- Public DNS still resolves the root to Squarespace's four default A records and `www` to `ext-sq.squarespace.com`. The domain's nameservers remain `nsc1` through `nsc4.squarespacedns.com`.
- Google Workspace mail uses `MX @ 1 smtp.google.com`. Screenshots also show Google SPF and DKIM records. Preserve these and all other mail/verification records; the screenshot truncates the DKIM value, so it must not be used to reconstruct that record.
- Exact machine-readable setup: `../../infra/railway/custom-domain.json`. Its verification TXT value is intended for public DNS; it is not an account credential.

## October 26 cutover

- Replaced the Squarespace website defaults with the Railway `www` CNAME and public verification TXT. The complete prior DNS snapshot is retained locally under `.local/domain-cutover/`.
- Authoritative DNS and public resolvers return the intended CNAME and TXT. Google MX, SPF and the complete DKIM value match the saved records. Nameservers and Domain Connect remain unchanged.
- Squarespace forwards the apex to the canonical origin with HTTPS and path preservation. Verified `https://weatherlytc.com/login` returns HTTP 302 to `https://www.weatherlytc.com/login`. Keep it temporary until acceptance.
- API/worker/web source pins now target reviewed GitHub main commit `80e5a51796c7d067d50878d6834df2a309a42e2e`. Web build inputs use `www`, staging noindex and all provider gates remain in place. API/worker origins were prepared for `www`, then restored to the preview because the custom domain could not provide valid HTTPS.
- API build `45427fc5-8c92-4448-85db-57d7d636b7d3` reached image upload but was canceled to prevent a partial sign-in cutover during the TLS outage. Worker and web were not deployed. All three application services continue serving `ed5b4aa`; see the staging manifest. Preview `/health`, owner sign-in, secure/HttpOnly cookies, MFA gating, sign-out and session invalidation passed.
- Railway currently reports a [certificate-issuance outage and build-upload delays](https://status.railway.com/). The domain still reports validating ownership and fails hostname verification. A certificate retry request was rejected because the domain has not entered a failed state. Do not bypass certificate validation or repeatedly recreate the domain.

## Resume after Railway certificate recovery

1. Check `www.weatherlytc.com` ownership/certificate status and verify HTTPS without bypassing validation. Do not remove/recreate a correctly configured domain to work around the provider outage.
2. Set API and worker `WEB_ORIGIN` and `BETTER_AUTH_URL` to `https://www.weatherlytc.com`. Web already has `PUBLIC_SITE_URL=https://www.weatherlytc.com`, `DEPLOYMENT_ENV=staging` and `SITE_INDEXING_ENABLED=false`.
3. Deploy pinned API commit `80e5a51796c7d067d50878d6834df2a309a42e2e`, verify migration history is current through all 11 migrations and health passes, then deploy worker and web from the same commit.
4. Complete the acceptance checks below and update both manifests with actual serving revisions. Only then change the apex forwarding from 302 to 301.

The provider outage is an external blocker. No background deployment or follow-up automation was left running. The existing preview remains the usable sign-in address.

## Address choice

Use `https://www.weatherlytc.com` as the canonical website/application address, with `https://weatherlytc.com` forwarding to it. This works with the existing Squarespace DNS service: [Railway documents](https://docs.railway.com/networking/domains/working-with-domains#adding-a-root-domain) that Squarespace does not support the root CNAME flattening Railway requires. A `www` CNAME plus [Squarespace domain forwarding](https://support.squarespace.com/hc/en-us/articles/214767107-Forwarding-a-domain) avoids a nameserver migration.

## Coordinated cutover with Ireland

1. Sign in to the Squarespace account that manages `weatherlytc.com`. Inspect and save the complete current DNS records and forwarding rules before editing. Confirm the website is still the expected Squarespace default/placeholder; do not replace a newly active site without reconciling it with the owner.
2. Recheck Railway build availability and the latest reviewed, CI-passing release. The launch batch requires API, worker and web from the same release, plus all 11 database migrations through `20261022014500_client_checklist_sharing`. Follow `../release/railway-staging.md`. Complete the deployment/origin steps in the same cutover window as DNS; a changed CNAME alone will not make sign-in work correctly.
3. In Squarespace DNS, replace the website's `www` CNAME and add the ownership TXT below. If the Squarespace Defaults group prevents editing its `www` record, remove only that website-default group as described in [Squarespace's external-host instructions](https://support.squarespace.com/hc/en-us/articles/215744668-Pointing-a-Squarespace-domain). Its root A/HTTPS records are website defaults. Do not remove Google mail records, the `_domainconnect` record, or change nameservers/DNSSEC.

| Type  | Host                  | Value                                                                             |
| ----- | --------------------- | --------------------------------------------------------------------------------- |
| CNAME | `www`                 | `yu5cb8hd.up.railway.app`                                                         |
| TXT   | `_railway-verify.www` | `railway-verify=8b4cbc9d5f7636b3946931954876ed747b495106f7c7f0f62988e2235b74bc00` |

4. Under Squarespace Website → Domain forwarding, forward `@` to `https://www.weatherlytc.com`; enable SSL and maintain paths. Use a temporary redirect while validating, then a permanent redirect after acceptance. Squarespace forwarding does not preserve query parameters, so all authentication/invitation/recovery/provider-callback links must use the canonical `www` origin directly.
5. Set the API's `WEB_ORIGIN` and `BETTER_AUTH_URL` to `https://www.weatherlytc.com`; use that `WEB_ORIGIN` for worker-generated links as well. Set web build input `PUBLIC_SITE_URL=https://www.weatherlytc.com`. Keep `DEPLOYMENT_ENV=staging`, `SITE_INDEXING_ENABLED=false`, production authentication settings, MFA requirements and provider activation gates. Deploy the reviewed API/worker/web configuration. Do not broaden trusted origins with a wildcard to accommodate the transition. Leave provider account setup paused; later OAuth callbacks must match this canonical origin.
6. Check Railway domain status until ownership is verified and the certificate is issued. Railway retries ownership checks for up to 72 hours; if setup happens later and issuance has failed, inspect `domain_status` and use `retry_domain_certificate` only when the record is correct and the reported failure is retryable.
7. Verify HTTPS on both hostnames, root path forwarding, `/health`, sign-in/MFA/sign-out, same-origin authenticated writes, unauthorized document/API denial, public metadata and noindex. Confirm the Google MX/SPF/DKIM records are unchanged. Recheck the API/worker/web serving commits before updating the deployment manifest.

## Rollback

Keep the existing Railway service domain during validation. Restore the saved Squarespace website records/forwarding configuration if routing fails, and restore the API/worker origins if they had changed. Do not roll back or alter Google Workspace records. Preserve the database, private bucket, accounts and provider-disabled state.

## Outstanding at October 21 preparation (historical)

Squarespace access/DNS changes, forwarding, ownership/TLS, coordinated origin/release deployment and custom-domain acceptance are pending. Railway was still reporting a build outage during preparation. Final business/account/backup/alert/pilot gates remain in `../release/requirements-evidence.md`; a custom domain does not close them.
