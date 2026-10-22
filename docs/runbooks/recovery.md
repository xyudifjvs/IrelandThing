# Encrypted backup and isolated recovery

`infra/ops/backup.ts` captures a PostgreSQL custom-format dump and every historical document object referenced by `DocumentVersion`. AES-256-GCM encrypts each file; an HMAC authenticates the manifest. The manifest records the release commit, table counts and object checksums. No plaintext database archive is written during snapshot. Recovery uses a private temporary directory, removes it afterward, then verifies restored table counts, version linkage, byte size and SHA-256 for every referenced object.

## Snapshot

Stop API and worker writers for the snapshot window, keeping the web entry in maintenance. This is an operational consistency precondition; the acknowledgment variable alone does not stop writers. Preserve the exact service image and record when writers were stopped/resumed. Configure PostgreSQL client tools at least as new as the server major version (the prepared ops image uses version 17), the source database/private store, and a separately escrowed `BACKUP_ENCRYPTION_KEY`.

```sh
BACKUP_WRITES_QUIESCED=yes node --import tsx infra/ops/backup.ts snapshot /private/encrypted-backups/unique-snapshot
```

The destination must not exist. A missing object, checksum discrepancy or dump failure produces an incomplete, unusable snapshot rather than a success manifest. Treat any failed snapshot directory as incomplete. The command prints counts/status only. Resume writers after confirming a successful snapshot. Store encrypted copies outside the application account's ordinary write permissions; configure the approved schedule/retention through operations. Proposed initial cadence is daily plus before migrations, pending owner approval of recovery objectives and retention.

## Restore

1. Keep the original database and bucket intact. Provision a separate empty database and separate empty object destination in an isolated environment. Do not connect outbound providers to the rehearsal.
2. Supply `RESTORE_DATABASE_URL`, `RESTORE_OBJECT_STORAGE_DIR` for local tests or the complete `RESTORE_S3_BUCKET`, `RESTORE_S3_ENDPOINT`, `RESTORE_S3_REGION`, `RESTORE_AWS_ACCESS_KEY_ID`, `RESTORE_AWS_SECRET_ACCESS_KEY` settings, plus the original backup encryption key.
3. Run the command below. It refuses the source database/store, populated targets, wrong keys, modified manifests and corrupted archives. It never issues a drop/clean operation.
4. Verify its successful result, then perform application sign-in/authorization and representative document downloads against the isolated environment. Confirm every persisted product area through its authorized API/MCP surface before any cutover.
5. Before enabling workers, reconcile queued or uncertain mail/payment actions with provider receipts. Rotate the auth secret for cutover; review/reconnect provider credentials according to the incident. Do not restore a historical queue and assume all external side effects are new work.
6. Record exact backup/commit, target identifiers, counts, hashes, elapsed time and independent reviewer. Cutover is a separate explicit release decision.

```sh
node --import tsx infra/ops/backup.ts restore /private/encrypted-backups/unique-snapshot
```

`infra/docker/ops.Dockerfile` packages Node and matching PostgreSQL tools. Pass secrets at runtime and mount a private backup destination. `PG_TOOLS_CONTAINER` is a local-test-only convenience that executes pg_dump/pg_restore inside an existing local PostgreSQL container, preserving the matching client version; it refuses remote database hosts.

The automated synthetic rehearsal lives at `tests/acceptance/recovery.test.ts`. It creates/drops uniquely named databases and separate temporary object directories. A file-adapter rehearsal verifies the backup protocol and exact bytes; it does not certify a live Railway bucket account, its credentials or actual restoration speed at production volume. Repeat the rehearsal with the approved bucket before launch.
