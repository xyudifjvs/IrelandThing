# Connect weatherlytc.com

Updated October 26, 2026. **The domain is live with valid HTTPS.** The canonical website and application address is https://www.weatherlytc.com. The root domain forwards to it and preserves paths. API, worker and web successfully serve reviewed GitHub main release `80e5a51796c7d067d50878d6834df2a309a42e2e`.

## Verification recovery

The domain was registered with Railway on October 21, but its DNS verification record was added on October 26. Railway's domain tool reports that automatic ownership checks run for up to 72 hours. The old attempt remained at validating ownership after the DNS was correct. An expired or stalled verification attempt is the best-supported explanation; the internal queue cause was not independently observed.

Railway's certificate incident was marked resolved at 20:02 UTC on October 26. The earlier claim that the continuing platform outage blocked this domain was stale. A fresh `retry_domain_certificate` request through the connected Railway account was accepted, followed by ownership verified and `CERTIFICATE_STATUS_TYPE_VALID`. The old local CLI had refused to retry the pending state. No DNS recreation or certificate-validation bypass was needed.

## Accepted October 26

- Ordinary HTTPS succeeds on the canonical site. Both HTTP and HTTPS apex requests redirect to the canonical origin; `/login` preserves its path.
- The coordinated API, worker and web deployment succeeded from the same reviewed commit. All 11 database migrations are complete with no failed or rolled-back rows. The worker has a current database heartbeat and returns healthy through private networking.
- API/worker `WEB_ORIGIN` and `BETTER_AUTH_URL`, plus the web build's `PUBLIC_SITE_URL`, use `https://www.weatherlytc.com`. Only web has public networking; API, worker, PostgreSQL and document storage remain private.
- Owner HTTPS sign-in, Secure/HttpOnly cookies, required MFA enrollment, blocked business-data access before MFA, canonical-origin acceptance, foreign-origin rejection, sign-out and rejection of the old session cookie passed. Those original MFA checks are historical. The later optional-authenticator release allows email/password workspace access; see `../release/railway-staging.md` for verified login and browser evidence.
- Public health, homepage/login/checklist pages, canonical metadata, staging noindex, unauthenticated API/document denials and invalid checklist-token privacy headers passed. The new homepage and login rendered in the browser without a certificate warning or local-demo sign-in.
- Authoritative CNAME/TXT, nameservers and Google MX/SPF/full DKIM records match the saved post-DNS-change snapshot. Mail configuration was preserved.
- The apex redirect remains **302**. Changing it to 301 is optional follow-up: Squarespace now requires fresh Google reauthentication. The working redirect was left intact. Squarespace drops query parameters, so all token-bearing links must use canonical `www` directly.

Provider activation and indexing remain disabled. This is domain/deployment acceptance, not approval for real-client operations. Ireland's accounts, real provider journeys, recovery delivery, hosted restore/monitoring and other business gates remain in `../release/requirements-evidence.md`. Nonsecret identifiers and acceptance flags are in `../../infra/railway/staging.json` and `../../infra/railway/custom-domain.json`; local diagnostic reports and screenshots are under ignored `.local/domain-cutover/`.

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
5. Set the API's `WEB_ORIGIN` and `BETTER_AUTH_URL` to `https://www.weatherlytc.com`; use that `WEB_ORIGIN` for worker-generated links as well. Set web build input `PUBLIC_SITE_URL=https://www.weatherlytc.com`. Keep `DEPLOYMENT_ENV=staging`, `SITE_INDEXING_ENABLED=false`, production authentication settings, optional authenticator support and provider activation gates. Deploy the reviewed API/worker/web configuration. Do not broaden trusted origins with a wildcard to accommodate the transition. Leave provider account setup paused; later OAuth callbacks must match this canonical origin.
6. Check Railway domain status until ownership is verified and the certificate is issued. Railway reports a 72-hour automatic ownership-check window. If DNS is configured after that window and status stays at validating ownership, inspect `domain_status` and request a fresh `retry_domain_certificate` through the Railway connector after confirming the records. In this cutover the connector accepted that request even though the older CLI had refused the pending state. Do not repeatedly recreate a correctly configured domain.
7. Verify HTTPS on both hostnames, root path forwarding, `/health`, sign-in/MFA/sign-out, same-origin authenticated writes, unauthorized document/API denial, public metadata and noindex. Confirm the Google MX/SPF/DKIM records are unchanged. Recheck the API/worker/web serving commits before updating the deployment manifest.

## Rollback

Keep the existing Railway service domain during validation. Restore the saved Squarespace website records/forwarding configuration if routing fails, and restore the API/worker origins if they had changed. Do not roll back or alter Google Workspace records. Preserve the database, private bucket, accounts and provider-disabled state.

## Outstanding at October 21 preparation (historical)

Squarespace access/DNS changes, forwarding, ownership/TLS, coordinated origin/release deployment and custom-domain acceptance are pending. Railway was still reporting a build outage during preparation. Final business/account/backup/alert/pilot gates remain in `../release/requirements-evidence.md`; a custom domain does not close them.
