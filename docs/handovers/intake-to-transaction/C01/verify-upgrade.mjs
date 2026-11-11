import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";

const [mode, snapshotPath] = process.argv.slice(2);
assert(["capture", "verify"].includes(mode) && snapshotPath, "Use capture|verify and a snapshot path.");

const url = new URL(process.env.DATABASE_URL ?? "");
assert(
  ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    && /^\/weatherly_c01_[a-z0-9_]+_test$/.test(url.pathname),
  "C01 verification requires a disposable local C01 database.",
);

const quote = (identifier) => '"' + identifier.replaceAll('"', '""') + '"';
const connection = new pg.Client({ connectionString: url.href });

try {
  await connection.connect();
  const columns = (await connection.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
      ORDER BY table_name, ordinal_position`,
  )).rows;
  const currentShape = Object.groupBy(columns, (column) => column.table_name);
  const before = mode === "verify" ? JSON.parse(await readFile(snapshotPath, "utf8")) : null;
  const shape = before?.shape ?? Object.fromEntries(
    Object.entries(currentShape).map(([table, entries]) => [table, entries.map((entry) => entry.column_name)]),
  );
  const records = {};
  for (const [table, fields] of Object.entries(shape)) {
    assert(fields.every((field) => currentShape[table]?.some((column) => column.column_name === field)));
    const result = await connection.query(
      `SELECT row_to_json(legacy)::text AS data
       FROM (SELECT ${fields.map(quote).join(", ")} FROM ${quote(table)}) AS legacy`,
    );
    records[table] = result.rows.map((row) => row.data).sort();
  }
  const rowCount = Object.values(records).reduce((count, rows) => count + rows.length, 0);
  assert(rowCount > 20, "Load the populated legacy fixture first.");

  if (mode === "capture") {
    assert(!currentShape.CreationReview, "Capture must precede the foundation migration.");
    await writeFile(snapshotPath, JSON.stringify({ shape, records }), { mode: 0o600 });
    console.log(`Captured ${rowCount} rows from ${Object.keys(records).length} legacy tables.`);
  } else {
    assert.deepStrictEqual(records, before.records, "A legacy row or legacy column changed.");
    const reclassified = await connection.query(
      `SELECT
        (SELECT count(*) FROM "Matter" WHERE "business" IS NOT NULL OR "checklistVersion" IS NOT NULL) AS files,
        (SELECT count(*) FROM "Task" WHERE "stepKey" IS NOT NULL OR "dateRule" IS NOT NULL) AS tasks,
        (SELECT count(*) FROM "Document" WHERE "shareWithAgent" IS NOT NULL OR "shareWithClient" IS NOT NULL) AS documents,
        (SELECT count(*) FROM "ChecklistShareSecret") AS secrets,
        (SELECT count(*) FROM "RosterAgent") AS roster,
        (SELECT count(*) FROM "CreationReview") AS reviews`,
    );
    assert(Object.values(reclassified.rows[0]).every((count) => count === "0"));
    console.log(`Preserved all ${rowCount} original rows and their values across ${Object.keys(records).length} legacy tables.`);
  }
} finally {
  await connection.end();
}
