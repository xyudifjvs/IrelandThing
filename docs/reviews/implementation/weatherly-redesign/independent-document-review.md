# Independent ongoing-document permission review

Reviewed the root agent's document enforcement after the owner clarified that ongoing file management is Ireland-only. This review is separate from the reviewer's own matters/AI implementation, which still requires another reviewer.

The reviewed `packages/documents/src/index.ts` SHA-256 is `951b550655316a2db6ced0aeeeb07ca1f2f16b1f38a836c9b52367e325814cb2`.

The independent review found an authorization-order regression: a forbidden version request could reveal the existence of a coordinator-private document through a 403 response. The source owner moved the read-only guard after the existing visibility check. The final private-document probe returns the expected generic 404 and does not write an object.

All 11 document batch regressions pass on the disposable local database and private temporary object directory. Positive ongoing version/format/storage/idempotency cases now use coordinator writers; their agent download and projection checks remain read-only. Agent intake uploads without a matter remain allowed, including version history. Client and other-agent negative assertions retain their intended permission checks.

The new role matrix verifies that assigned agents cannot create an ongoing matter document or version even when they originally uploaded the intake file; no object write occurs. Coordinator writes remain available. The assignment race test assigns an intake document after the replacement object has been written but before the database commit. The conditional update rejects the version, removes the new object and preserves the original bytes, version and assignment.

TypeScript and `git diff --check` also pass. No provider, account, deployment or real-client operation was used. These checks do not replace production same-origin/authentication acceptance or certify the reviewer's separate matters/AI changes.
