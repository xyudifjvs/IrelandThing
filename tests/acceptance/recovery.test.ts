import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { snapshot, restore } from "../../infra/ops/backup";
const execute = promisify(execFile),
  id = randomUUID().replaceAll("-", "");
const sourceName = `weatherly_recovery_src_${id}`,
  targetName = `weatherly_recovery_dst_${id}`;
let admin: pg.Client,
  sourceUrl: string,
  targetUrl: string,
  temporary: string,
  env: NodeJS.ProcessEnv;
const documentBytes = Buffer.from(
  "%PDF-1.4\nSynthetic recovery evidence. Exact document bytes must survive restoration.\n%%EOF",
);
const objectKey = `documents/recovery/${id}`;
describe.sequential("encrypted isolated database + document recovery", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error(
        "DATABASE_URL must identify a disposable local test PostgreSQL server.",
      );
    const base = new URL(process.env.DATABASE_URL);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
      throw new Error(
        "Recovery rehearsal refuses non-local PostgreSQL servers.",
      );
    admin = new pg.Client({ connectionString: base.href });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${sourceName}"`);
    await admin.query(`CREATE DATABASE "${targetName}"`);
    base.pathname = "/" + sourceName;
    sourceUrl = base.href;
    base.pathname = "/" + targetName;
    targetUrl = base.href;
    await execute(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      {
        env: { ...process.env, DATABASE_URL: sourceUrl },
        maxBuffer: 1024 * 1024,
      },
    );
    temporary = await mkdtemp(
      path.join(os.tmpdir(), "weatherly-recovery-test-"),
    );
    const root = path.join(temporary, "source-objects");
    await mkdir(path.join(root, "documents/recovery"), { recursive: true });
    await writeFile(path.join(root, objectKey), documentBytes);
    const source = new pg.Client({ connectionString: sourceUrl });
    await source.connect();
    await source.query(
      'INSERT INTO "Document" (id,name,"mimeType","createdById","updatedAt") VALUES ($1,$2,$3,$4,NOW())',
      [
        "recovery-doc",
        "Synthetic evidence.pdf",
        "application/pdf",
        "synthetic-recovery-actor",
      ],
    );
    await source.query(
      'INSERT INTO "DocumentVersion" (id,"documentId","objectKey",checksum,size,version) VALUES ($1,$2,$3,$4,$5,1)',
      [
        "recovery-version",
        "recovery-doc",
        objectKey,
        createHash("sha256").update(documentBytes).digest("hex"),
        documentBytes.length,
      ],
    );
    await source.end();
    env = {
      ...process.env,
      DATABASE_URL: sourceUrl,
      OBJECT_STORAGE_DIR: root,
      RESTORE_DATABASE_URL: targetUrl,
      RESTORE_OBJECT_STORAGE_DIR: path.join(temporary, "restored-objects"),
      S3_BUCKET: "",
      RESTORE_S3_BUCKET: "",
      BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      BACKUP_WRITES_QUIESCED: "yes",
      RELEASE_COMMIT: "synthetic-recovery-rehearsal",
    };
  }, 60000);
  afterAll(async () => {
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${sourceName}" WITH (FORCE)`);
      await admin.query(`DROP DATABASE IF EXISTS "${targetName}" WITH (FORCE)`);
      await admin.end();
    }
    if (temporary) await rm(temporary, { recursive: true, force: true });
  });
  it("requires an explicit paused-writers acknowledgment", async () => {
    await expect(
      snapshot(path.join(temporary, "forbidden"), {
        ...env,
        BACKUP_WRITES_QUIESCED: "no",
      }),
    ).rejects.toThrow("Stop writers");
  });
  it("captures encrypted database and every versioned object", async () => {
    const result = await snapshot(path.join(temporary, "snapshot"), env);
    expect(result.encrypted).toBe(true);
    expect(result.objects).toBe(1);
    expect(result.tables).toBeGreaterThan(20);
    const archive = await readFile(
      path.join(temporary, "snapshot", "database.dump.enc"),
    );
    expect(archive.includes(Buffer.from("Synthetic evidence.pdf"))).toBe(false);
  });
  it("rejects the wrong recovery key and authenticated manifest tampering", async () => {
    await expect(
      restore(path.join(temporary, "snapshot"), {
        ...env,
        BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      }),
    ).rejects.toThrow("authentication");
    const manifestPath = path.join(temporary, "snapshot", "manifest.json");
    const original = await readFile(manifestPath);
    const changed = JSON.parse(original.toString());
    changed.manifest.releaseCommit = "tampered";
    await writeFile(manifestPath, JSON.stringify(changed));
    await expect(
      restore(path.join(temporary, "snapshot"), env),
    ).rejects.toThrow("authentication");
    await writeFile(manifestPath, original);
  });
  it("refuses restoring over the source database", async () => {
    await expect(
      restore(path.join(temporary, "snapshot"), {
        ...env,
        RESTORE_DATABASE_URL: sourceUrl,
      }),
    ).rejects.toThrow("source database");
  });
  it("restores into isolated targets and checks table counts and every database-object checksum", async () => {
    const result = await restore(path.join(temporary, "snapshot"), env);
    expect(result.verified).toBe(true);
    expect(result.objects).toBe(1);
    expect(
      await readFile(path.join(env.RESTORE_OBJECT_STORAGE_DIR!, objectKey)),
    ).toEqual(documentBytes);
    const target = new pg.Client({ connectionString: targetUrl });
    await target.connect();
    const row = await target.query(
      'SELECT d.name,v."objectKey" FROM "Document" d JOIN "DocumentVersion" v ON v."documentId"=d.id WHERE d.id=$1',
      ["recovery-doc"],
    );
    expect(row.rows[0]).toEqual({ name: "Synthetic evidence.pdf", objectKey });
    await target.end();
  }, 30000);
  it("refuses a populated recovery target", async () => {
    await expect(
      restore(path.join(temporary, "snapshot"), env),
    ).rejects.toThrow("must be empty");
  });
});
