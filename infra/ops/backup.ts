import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  stat,
  open,
  appendFile,
  mkdtemp,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
type Variables = NodeJS.ProcessEnv;
type Store = {
  fingerprint: string;
  read: (key: string) => Promise<Buffer>;
  write: (key: string, bytes: Buffer) => Promise<void>;
  empty: () => Promise<boolean>;
};
type Entry = {
  key: string;
  checksum: string;
  size: number;
  file: string;
  encryptedChecksum: string;
};
type Manifest = {
  format: "weatherly-encrypted-backup-v1";
  createdAt: string;
  releaseCommit: string;
  sourceDatabase: string;
  sourceStore: string;
  tables: Record<string, number>;
  database: { file: string; encryptedChecksum: string };
  objects: Entry[];
};
const digest = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
function key(env: Variables) {
  const value = env.BACKUP_ENCRYPTION_KEY;
  const bytes = Buffer.from(value || "", "base64");
  if (bytes.length !== 32)
    throw new Error(
      "BACKUP_ENCRYPTION_KEY must contain a base64-encoded 32-byte recovery key.",
    );
  return bytes;
}
function databaseFingerprint(url: string) {
  const p = new URL(url);
  return digest(`${p.hostname}:${p.port || 5432}${p.pathname}`);
}
function safeObjectKey(value: string) {
  if (
    value.startsWith("/") ||
    !/^[a-zA-Z0-9/_-]+$/.test(value) ||
    value.includes("..")
  )
    throw new Error("Unsupported object key in document history.");
  return value;
}
async function store(env: Variables, restore = false): Promise<Store> {
  const prefix = restore ? "RESTORE_" : "";
  const bucket = env[`${prefix}S3_BUCKET`];
  if (bucket) {
    const endpoint = env[`${prefix}S3_ENDPOINT`];
    const client = new S3Client({
      region: env[`${prefix}S3_REGION`] || "auto",
      endpoint,
      forcePathStyle: env[`${prefix}S3_FORCE_PATH_STYLE`] === "true",
      credentials: {
        accessKeyId: env[`${prefix}AWS_ACCESS_KEY_ID`] || "",
        secretAccessKey: env[`${prefix}AWS_SECRET_ACCESS_KEY`] || "",
      },
    });
    return {
      fingerprint: digest(`s3:${endpoint || "aws"}:${bucket}`),
      async read(Key) {
        const r = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: safeObjectKey(Key) }),
        );
        if (!r.Body) throw new Error("Referenced object is missing.");
        return Buffer.from(await r.Body.transformToByteArray());
      },
      async write(Key, Body) {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: safeObjectKey(Key),
            Body,
            ContentType: "application/octet-stream",
          }),
        );
      },
      async empty() {
        const r = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }),
        );
        return !r.Contents?.length;
      },
    };
  }
  const root =
    env[restore ? "RESTORE_OBJECT_STORAGE_DIR" : "OBJECT_STORAGE_DIR"];
  if (!root)
    throw new Error(
      `${restore ? "RESTORE_OBJECT_STORAGE_DIR" : "OBJECT_STORAGE_DIR"} or private S3 settings are required.`,
    );
  const resolved = path.resolve(root);
  if (restore) await mkdir(resolved, { recursive: true, mode: 0o700 });
  return {
    fingerprint: digest(`file:${resolved}`),
    async read(k) {
      return readFile(path.join(resolved, safeObjectKey(k)));
    },
    async write(k, bytes) {
      const file = path.join(resolved, safeObjectKey(k));
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
    },
    async empty() {
      return (await readdir(resolved)).length === 0;
    },
  };
}
async function checksumFile(file: string) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}
function pgProcess(
  program: "pg_dump" | "pg_restore",
  url: string,
  args: string[],
  env: Variables,
) {
  const u = new URL(url);
  const childEnv = {
    ...env,
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
    ...(u.searchParams.get("sslmode")
      ? { PGSSLMODE: u.searchParams.get("sslmode")! }
      : {}),
  };
  if (program === "pg_restore")
    args = [...args, "--dbname", decodeURIComponent(u.pathname.slice(1))];
  const container = env.PG_TOOLS_CONTAINER;
  if (container) {
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(u.hostname))
      throw new Error(
        "Container PostgreSQL tools are allowed only for a local rehearsal.",
      );
    delete (childEnv as Variables).PGHOST;
    delete (childEnv as Variables).PGPORT;
  }
  const child = container
    ? spawn(
        "docker",
        [
          "exec",
          "-i",
          "-e",
          "PGUSER",
          "-e",
          "PGPASSWORD",
          "-e",
          "PGDATABASE",
          container,
          program,
          ...args,
        ],
        { env: childEnv, stdio: ["pipe", "pipe", "pipe"] },
      )
    : spawn(program, args, { env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.resume();
  const done = new Promise<void>((resolve, reject) => {
    child.once("error", () => reject(new Error(`${program} could not start.`)));
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${program} failed; inspect the database/tool version and target configuration.`,
            ),
          ),
    );
  });
  return { child, done };
}
async function counts(client: pg.Client) {
  const { rows } = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  const result: Record<string, number> = {};
  for (const row of rows) {
    const identifier = '"' + row.tablename.replaceAll('"', '""') + '"';
    const r = await client.query(
      `SELECT count(*)::int AS count FROM public.${identifier}`,
    );
    result[row.tablename] = r.rows[0].count;
  }
  return result;
}
async function connect(url: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}
async function encryptDump(
  url: string,
  file: string,
  encryptionKey: Buffer,
  env: Variables,
) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey, iv),
    output = createWriteStream(file, { flags: "wx", mode: 0o600 });
  output.write(iv);
  const { child, done } = pgProcess(
    "pg_dump",
    url,
    ["--format=custom", "--no-owner", "--no-acl"],
    env,
  );
  child.stdin.end();
  await Promise.all([pipeline(child.stdout, cipher, output), done]);
  await appendFile(file, cipher.getAuthTag());
}
async function decryptFile(
  file: string,
  destination: string,
  encryptionKey: Buffer,
) {
  const info = await stat(file);
  if (info.size < 28) throw new Error("Encrypted backup file is truncated.");
  const handle = await open(file, "r");
  const iv = Buffer.alloc(12),
    tag = Buffer.alloc(16);
  try {
    await handle.read(iv, 0, 12, 0);
    await handle.read(tag, 0, 16, info.size - 16);
  } finally {
    await handle.close();
  }
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey, iv);
  cipher.setAuthTag(tag);
  await pipeline(
    createReadStream(file, { start: 12, end: info.size - 17 }),
    cipher,
    createWriteStream(destination, { flags: "wx", mode: 0o600 }),
  );
}
export async function snapshot(
  directory: string,
  env: Variables = process.env,
) {
  if (env.BACKUP_WRITES_QUIESCED !== "yes")
    throw new Error(
      "Stop writers and set BACKUP_WRITES_QUIESCED=yes before snapshotting.",
    );
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const encryptionKey = key(env),
    storage = await store(env);
  await mkdir(directory, { mode: 0o700 });
  await mkdir(path.join(directory, "objects"), { mode: 0o700 });
  const db = await connect(env.DATABASE_URL);
  try {
    const tables = await counts(db);
    const versions = await db.query<{
      objectKey: string;
      checksum: string;
      size: number;
    }>(
      'SELECT "objectKey",checksum,size FROM "DocumentVersion" ORDER BY "objectKey"',
    );
    const entries: Entry[] = [];
    await encryptDump(
      env.DATABASE_URL,
      path.join(directory, "database.dump.enc"),
      encryptionKey,
      env,
    );
    for (const v of versions.rows) {
      const bytes = await storage.read(v.objectKey);
      if (digest(bytes) !== v.checksum || bytes.length !== v.size)
        throw new Error(
          "A referenced source document failed checksum validation.",
        );
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", encryptionKey, iv),
        encrypted = Buffer.concat([
          iv,
          cipher.update(bytes),
          cipher.final(),
          cipher.getAuthTag(),
        ]);
      const file = `objects/${digest(v.objectKey)}.enc`;
      await writeFile(path.join(directory, file), encrypted, {
        flag: "wx",
        mode: 0o600,
      });
      entries.push({
        key: v.objectKey,
        checksum: v.checksum,
        size: v.size,
        file,
        encryptedChecksum: digest(encrypted),
      });
    }
    const manifest: Manifest = {
      format: "weatherly-encrypted-backup-v1",
      createdAt: new Date().toISOString(),
      releaseCommit: env.RELEASE_COMMIT || "unrecorded",
      sourceDatabase: databaseFingerprint(env.DATABASE_URL),
      sourceStore: storage.fingerprint,
      tables,
      database: {
        file: "database.dump.enc",
        encryptedChecksum: await checksumFile(
          path.join(directory, "database.dump.enc"),
        ),
      },
      objects: entries,
    };
    const signature = createHmac("sha256", encryptionKey)
      .update(JSON.stringify(manifest))
      .digest("hex");
    await writeFile(
      path.join(directory, "manifest.json"),
      JSON.stringify({ manifest, signature }, null, 2),
      { flag: "wx", mode: 0o600 },
    );
    return {
      tables: Object.keys(tables).length,
      objects: entries.length,
      encrypted: true,
    };
  } finally {
    await db.end();
  }
}
async function verifiedManifest(directory: string, encryptionKey: Buffer) {
  const { manifest, signature } = JSON.parse(
    await readFile(path.join(directory, "manifest.json"), "utf8"),
  ) as { manifest: Manifest; signature: string };
  if (manifest.format !== "weatherly-encrypted-backup-v1")
    throw new Error("Unsupported backup format.");
  const expected = createHmac("sha256", encryptionKey)
    .update(JSON.stringify(manifest))
    .digest();
  const supplied = Buffer.from(signature || "", "hex");
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw new Error("Backup manifest authentication failed.");
  if (manifest.database.file !== "database.dump.enc")
    throw new Error("Unexpected database archive path.");
  if (
    (await checksumFile(path.join(directory, manifest.database.file))) !==
    manifest.database.encryptedChecksum
  )
    throw new Error("Database archive integrity check failed.");
  for (const e of manifest.objects) {
    safeObjectKey(e.key);
    if (
      e.file !== `objects/${digest(e.key)}.enc` ||
      (await checksumFile(path.join(directory, e.file))) !== e.encryptedChecksum
    )
      throw new Error("Document archive integrity check failed.");
  }
  return manifest;
}
export async function restore(directory: string, env: Variables = process.env) {
  const url = env.RESTORE_DATABASE_URL;
  if (!url)
    throw new Error(
      "RESTORE_DATABASE_URL must identify an empty isolated database.",
    );
  const encryptionKey = key(env);
  const manifest = await verifiedManifest(directory, encryptionKey);
  if (databaseFingerprint(url) === manifest.sourceDatabase)
    throw new Error(
      "Restore into the source database is forbidden; use an isolated empty target.",
    );
  const storage = await store(env, true);
  if (storage.fingerprint === manifest.sourceStore)
    throw new Error("Restore into the source object store is forbidden.");
  const db = await connect(url);
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "weatherly-recovery-"),
  );
  try {
    if (Object.keys(await counts(db)).length)
      throw new Error("Restore target database must be empty.");
    if (!(await storage.empty()))
      throw new Error("Restore target object store must be empty.");
    for (const e of manifest.objects) {
      const file = path.join(temporary, digest(e.key));
      await decryptFile(path.join(directory, e.file), file, encryptionKey);
      const bytes = await readFile(file);
      if (digest(bytes) !== e.checksum || bytes.length !== e.size)
        throw new Error(
          "Decrypted document checksum does not match database evidence.",
        );
      await storage.write(e.key, bytes);
      await rm(file);
    }
    const dump = path.join(temporary, "database.dump");
    await decryptFile(
      path.join(directory, manifest.database.file),
      dump,
      encryptionKey,
    );
    const { child, done } = pgProcess(
      "pg_restore",
      url,
      ["--exit-on-error", "--no-owner", "--no-acl", "--single-transaction"],
      env,
    );
    child.stdout.resume();
    await Promise.all([pipeline(createReadStream(dump), child.stdin), done]);
    const restoredCounts = await counts(db);
    if (JSON.stringify(restoredCounts) !== JSON.stringify(manifest.tables))
      throw new Error("Restored table counts differ from the snapshot.");
    const rows = await db.query<{
      objectKey: string;
      checksum: string;
      size: number;
    }>(
      'SELECT "objectKey",checksum,size FROM "DocumentVersion" ORDER BY "objectKey"',
    );
    if (rows.rows.length !== manifest.objects.length)
      throw new Error(
        "Restored document-version count differs from the snapshot.",
      );
    for (const version of rows.rows) {
      const expected = manifest.objects.find(
        (e) => e.key === version.objectKey,
      );
      if (!expected || expected.checksum !== version.checksum)
        throw new Error("Restored document linkage differs from the snapshot.");
      const bytes = await storage.read(version.objectKey);
      if (digest(bytes) !== version.checksum || bytes.length !== version.size)
        throw new Error("Restored object failed database checksum validation.");
    }
    return {
      tables: Object.keys(restoredCounts).length,
      objects: rows.rows.length,
      verified: true,
    };
  } finally {
    await db.end();
    await rm(temporary, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [command, directory] = process.argv.slice(2);
  if (!directory || !["snapshot", "restore"].includes(command || "")) {
    console.error(
      "Usage: node --import tsx infra/ops/backup.ts snapshot|restore /private/path",
    );
    process.exitCode = 1;
  } else
    try {
      console.log(
        JSON.stringify(
          await (command === "snapshot"
            ? snapshot(directory)
            : restore(directory)),
        ),
      );
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : "Backup operation failed.",
      );
      process.exitCode = 1;
    }
}
