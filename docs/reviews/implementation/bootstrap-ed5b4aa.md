# Independent named-owner bootstrap review:ed5b4aa

Exact source: `ed5b4aa3eb8c6be65b83d886f827218562efd468`. Reviewed2026-10-20 America/New_York. The user-authorized temporary name and supplied email address were tested only inside freshly created local disposable databases. No staging/production database, Railway configuration or account was changed. Bootstrap sends no messages; all test credentials were random synthetic values and were not printed.

**14/14 independent assertions pass.**

- Explicit Carson name and matching owner-email confirmation create exactly one coordinator with trimmed name and normalized email.
- Wrong email confirmation, missing confirmation, legacy Ireland confirmation with explicit Carson name, blank explicit name, placeholder email and short password reject before creating a user.
- Two concurrent valid requests with different owner emails produce exactly one coordinator, confirming the advisory-lock/existing-owner boundary rather than relying only on unique email constraints.
- Approved service prices375/475/625 dollars are created; exactly one hashed credential is stored.
- Re-running bootstrap against an existing coordinator is refused and preserves the original owner name and credential hash.
- The new owner has not enrolled an authenticator. Existing production API MFA enforcement remains required; bootstrap does not bypass or automatically complete enrollment.

Source inspection confirms password/owner/catalog creation remains inside the existing transaction and lock. Exact normalized email confirmation is required when BOOTSTRAP_OWNER_NAME is explicitly supplied. For compatibility, the previous `ireland` confirmation remains accepted only when the name variable is absent; the authorized explicit Carson invocation cannot use that legacy exception.

The retained portable probe defaults to a reserved.invalid address and accepts CHECKER_OWNER_EMAIL to test an explicitly supplied address in disposable databases. Its complete14-check run was repeated successfully after replacing the hardcoded supplied address with that test-only variable. Both temporary databases are dropped in the finally block. See `probes/weatherly-independent-bootstrap.mjs` and `probes/README.md`.

No concrete blocker was found for the reviewed explicit-name/exact-email invocation. This finding does not claim that an actual staging owner was created or its MFA/login was verified; those operations remain with the authorized deployment coordinator.
