import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL ?? "");
assert(
  ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    && /^\/weatherly_c01_[a-z0-9_]+_test$/.test(url.pathname),
  "C01 verification requires a disposable local C01 database.",
);
const pool = new pg.Pool({ connectionString: url.href, max: 2 });
const db = await pool.connect();
const key = randomUUID();

async function expectConstraint(statement, code, constraint) {
  await db.query("SAVEPOINT invalid_write");
  try {
    await assert.rejects(db.query(statement), { code, constraint });
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT invalid_write");
    await db.query("RELEASE SAVEPOINT invalid_write");
  }
}

try {
  // Autocommit both writers through distinct connections.
  const insert = (connection, id) => connection.query(
    `INSERT INTO "CreationReview" ("id", "ownerId", "startRequestId", "updatedAt")
      VALUES ($1, 'c01-owner', $2, now())`,
    [id, key],
  );
  const writes = await Promise.allSettled([
    insert(db, key + "-first"),
    insert(pool, key + "-second"),
  ]);
  assert.equal(writes.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(writes.find(({ status }) => status === "rejected").reason.constraint, "CreationReview_startRequestId_key");
  const replay = (await db.query(
    'SELECT "intakeId", "confirmedMatterId" FROM "CreationReview" WHERE "startRequestId" = $1',
    [key],
  )).rows;
  assert.deepEqual(replay, [{ intakeId: null, confirmedMatterId: null }]);

  await db.query("BEGIN");
  await db.query(`
    INSERT INTO "CreationReview" ("id", "intakeId", "ownerId", "startRequestId", "updatedAt")
    VALUES ('verify-review', 'c01-pending-intake', 'c01-owner', 'verify-start', now());
    INSERT INTO "CreationExtraction" ("id", "reviewId", "generation", "sourceRefs", "promptVersion", "updatedAt")
    VALUES ('verify-extraction', 'verify-review', 1, '[]', 'synthetic', now());
    UPDATE "Task" SET "stepKey" = 'inspection' WHERE id = 'c01-task-1';
    INSERT INTO "RosterAgent" ("id", "name", "updatedAt")
    VALUES ('verify-agent', 'Synthetic name-only roster entry', now());
    INSERT INTO "HtoClosing" ("id", "matterId", "updatedAt")
    VALUES ('verify-closing', 'c01-under_contract', now());
    INSERT INTO "EmailWork" ("id", "matterId", "templateId", "updatedAt")
    VALUES ('verify-email', 'c01-under_contract', 'c01-template', now());
    INSERT INTO "ChecklistShareSecret" ("matterId", "shareId", "ciphertext")
    VALUES ('c01-under_contract', 'c01-old-share', 'synthetic-ciphertext-marker');
    UPDATE "ChecklistShare" SET "id" = 'verify-rotated-share' WHERE "id" = 'c01-old-share';
    UPDATE "Matter" SET "purchasePriceCents" = 9007199254740991 WHERE id = 'c01-under_contract';
  `);
  const rotated = await db.query(`
    SELECT 1
    FROM "ChecklistShare" share
    JOIN "ChecklistShareSecret" secret
      ON secret."matterId" = share."matterId" AND secret."shareId" = share.id
    WHERE share.id = 'verify-rotated-share'
  `);
  assert.equal(rotated.rowCount, 0, "Old ciphertext must not follow a legacy share rotation.");
  const price = await db.query('SELECT "purchasePriceCents"::text AS cents FROM "Matter" WHERE id = \'c01-under_contract\'');
  assert.equal(price.rows[0].cents, "9007199254740991");

  await expectConstraint(
    `INSERT INTO "CreationReview" ("id", "intakeId", "ownerId", "startRequestId", "updatedAt")
     VALUES ('verify-duplicate', 'c01-pending-intake', 'c01-owner', 'verify-duplicate', now())`,
    "23505", "CreationReview_intakeId_key",
  );
  await expectConstraint(
    `INSERT INTO "CreationExtraction" ("id", "reviewId", "generation", "sourceRefs", "promptVersion", "updatedAt")
     VALUES ('verify-duplicate', 'verify-review', 1, '[]', 'synthetic', now())`,
    "23505", "CreationExtraction_reviewId_generation_key",
  );
  await expectConstraint(
    `UPDATE "CreationReview" SET "confirmedMatterId" = 'c01-under_contract' WHERE id = 'verify-review'`,
    "23514", "CreationReview_confirmation_receipt_check",
  );
  await expectConstraint(
    `UPDATE "Task" SET "stepKey" = 'inspection' WHERE id = 'c01-task-2'`,
    "23505", "Task_matterId_stepKey_key",
  );
  await expectConstraint(
    `UPDATE "Document" SET "shareWithClient" = true WHERE id = 'c01-document'`,
    "23514", "Document_share_flags_pair_check",
  );
  await db.query(`UPDATE "Document" SET "shareWithAgent" = false, "shareWithClient" = true WHERE id = 'c01-document'`);
  await expectConstraint(
    `UPDATE "Matter" SET "purchasePriceCents" = 9007199254740992 WHERE id = 'c01-under_contract'`,
    "23514", "Matter_purchasePriceCents_safe_check",
  );
  await expectConstraint(
    `INSERT INTO "HtoClosing" ("id", "matterId", "updatedAt")
     VALUES ('verify-duplicate', 'c01-under_contract', now())`,
    "23505", "HtoClosing_matterId_key",
  );
  await expectConstraint(
    `DELETE FROM "Matter" WHERE id = 'c01-under_contract'`,
    "23503", "HtoClosing_matterId_fkey",
  );
  await expectConstraint(
    `INSERT INTO "EmailWork" ("id", "matterId", "templateId", "updatedAt")
     VALUES ('verify-duplicate', 'c01-under_contract', 'c01-template', now())`,
    "23505", "EmailWork_matterId_templateId_key",
  );
  await expectConstraint(
    `INSERT INTO "DigestCursor" ("recipientId", "stream", "pendingWindowStart", "updatedAt")
     VALUES ('c01-owner', 'verify', now(), now())`,
    "23514", "DigestCursor_pending_window_check",
  );
  console.log("C01 constraints verified, including concurrent creation replay and legacy share rotation.");
} finally {
  await db.query("ROLLBACK");
  await db.query('DELETE FROM "CreationReview" WHERE "startRequestId" = $1', [key]);
  db.release();
  await pool.end();
}
