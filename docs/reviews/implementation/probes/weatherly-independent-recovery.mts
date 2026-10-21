import "./_review-safety.mjs";
import {
  checkoutRoot,
  checkerDatabaseUrl,
  apiBase,
  webBase,
} from "./_review-safety.mjs";
import { createRequire } from "node:module";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { snapshot, restore } from "../../../../infra/ops/backup.ts";
const require = createRequire(
    new URL("../../../../package.json", import.meta.url),
  ),
  { Client } = require("pg"),
  exec = promisify(execFile),
  suffix = randomUUID().replaceAll("-", ""),
  src = "checker_recovery_src_" + suffix,
  dst = "checker_recovery_dst_" + suffix;
const url = new URL("./", checkerDatabaseUrl).href;
const admin = new Client({ connectionString: checkerDatabaseUrl });
await admin.connect();
const temp = await mkdtemp("/tmp/weatherly-checker-recovery-"),
  checks = [];
const check = (name, pass, extra = {}) => checks.push({ name, pass, ...extra });
async function denied(name, fn, pattern) {
  try {
    await fn();
    check(name, false);
  } catch (e) {
    check(name, pattern.test(e.message), { error: e.message });
  }
}
const key = randomBytes(32).toString("base64");
const env = {
  ...process.env,
  DATABASE_URL: url + src,
  RESTORE_DATABASE_URL: url + dst,
  OBJECT_STORAGE_DIR: temp + "/source",
  RESTORE_OBJECT_STORAGE_DIR: temp + "/target",
  S3_BUCKET: "",
  RESTORE_S3_BUCKET: "",
  BACKUP_ENCRYPTION_KEY: key,
  BACKUP_WRITES_QUIESCED: "yes",
  PG_TOOLS_CONTAINER: process.env.PG_TOOLS_CONTAINER,
  RELEASE_COMMIT: "independent-synthetic-recovery",
};
const versions = [
  Buffer.from("Independent original document bytes\n"),
  Buffer.from("Independent amended document bytes\n"),
];
try {
  await admin.query('CREATE DATABASE "' + src + '"');
  await admin.query('CREATE DATABASE "' + dst + '"');
  await exec(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { cwd: checkoutRoot, env, maxBuffer: 1024 * 1024 },
  );
  const db = new Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  await db.query(
    'INSERT INTO "Document"(id,name,"mimeType","createdById","updatedAt") VALUES($1,$2,$3,$4,now())',
    [
      "synthetic-doc",
      "Independent sensitive title",
      "text/plain",
      "independent",
    ],
  );
  await mkdir(temp + "/source/documents/checker", { recursive: true });
  for (let i = 0; i < versions.length; i++) {
    const objectKey = "documents/checker/version" + (i + 1);
    await writeFile(path.join(temp, "source", objectKey), versions[i]);
    await db.query(
      'INSERT INTO "DocumentVersion"(id,"documentId","objectKey",checksum,size,version) VALUES($1,$2,$3,$4,$5,$6)',
      [
        "independent-v" + i,
        "synthetic-doc",
        objectKey,
        createHash("sha256").update(versions[i]).digest("hex"),
        versions[i].length,
        i + 1,
      ],
    );
  }
  await db.end();
  await denied(
    "Snapshot requires explicit quiesced writers",
    () =>
      snapshot(temp + "/unpaused", { ...env, BACKUP_WRITES_QUIESCED: "no" }),
    /Stop writers/,
  );
  const captured = await snapshot(temp + "/snapshot", env);
  check(
    "Snapshot captures both immutable versions encrypted",
    captured.encrypted && captured.objects === 2 && captured.tables > 20,
  );
  const dump = await readFile(temp + "/snapshot/database.dump.enc");
  check(
    "Database archive does not expose synthetic title",
    !dump.includes(Buffer.from("Independent sensitive title")),
  );
  await denied(
    "Wrong key rejected before restoring",
    () =>
      restore(temp + "/snapshot", {
        ...env,
        BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      }),
    /authentication/,
  );
  await denied(
    "Source database overwrite forbidden",
    () =>
      restore(temp + "/snapshot", {
        ...env,
        RESTORE_DATABASE_URL: env.DATABASE_URL,
      }),
    /source database/,
  );
  await denied(
    "Source object store overwrite forbidden",
    () =>
      restore(temp + "/snapshot", {
        ...env,
        RESTORE_OBJECT_STORAGE_DIR: env.OBJECT_STORAGE_DIR,
      }),
    /source object store/,
  );
  const m = JSON.parse(
    await readFile(temp + "/snapshot/manifest.json", "utf8"),
  );
  const objectFile = path.join(temp, "snapshot", m.manifest.objects[0].file),
    original = await readFile(objectFile),
    tampered = Buffer.from(original);
  tampered[15] ^= 1;
  await writeFile(objectFile, tampered);
  await denied(
    "Tampered encrypted object rejected before restoring",
    () => restore(temp + "/snapshot", env),
    /integrity/,
  );
  await writeFile(objectFile, original);
  const result = await restore(temp + "/snapshot", env);
  check(
    "Independent isolated restore validates full schema and both versions",
    result.verified &&
      result.objects === 2 &&
      result.tables === captured.tables,
  );
  for (let i = 0; i < 2; i++)
    check(
      "Restored immutable version" + (i + 1) + " bytes match",
      Buffer.compare(
        await readFile(temp + "/target/documents/checker/version" + (i + 1)),
        versions[i],
      ) === 0,
    );
  const restored = new Client({ connectionString: env.RESTORE_DATABASE_URL });
  await restored.connect();
  const rows = await restored.query(
    'SELECT version,"objectKey" FROM "DocumentVersion" WHERE "documentId"=$1 ORDER BY version',
    ["synthetic-doc"],
  );
  await restored.end();
  check(
    "Restored version sequence and object linkage preserved",
    rows.rows.length === 2 &&
      rows.rows[1].version === 2 &&
      rows.rows[1].objectKey === "documents/checker/version2",
  );
  await denied(
    "Populated target cannot be overwritten",
    () => restore(temp + "/snapshot", env),
    /must be empty/,
  );
  console.log(
    JSON.stringify(
      {
        checks: checks.length,
        failed: checks.filter((c) => !c.pass).length,
        results: checks,
      },
      null,
      2,
    ),
  );
} finally {
  for (const name of [src, dst])
    await admin.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
  await admin.end();
  await rm(temp, { recursive: true, force: true });
}
