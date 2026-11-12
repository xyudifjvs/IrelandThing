import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
export function createObjectStore(): ObjectStore {
  if (process.env.S3_BUCKET) {
    const client = new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    });
    const Bucket = process.env.S3_BUCKET;
    return {
      async put(Key, Body, ContentType) {
        await client.send(
          new PutObjectCommand({ Bucket, Key, Body, ContentType }),
        );
      },
      async get(Key) {
        const r = await client.send(new GetObjectCommand({ Bucket, Key }));
        if (!r.Body) throw new Error("Object missing");
        return Buffer.from(await r.Body.transformToByteArray());
      },
      async remove(Key) {
        await client.send(new DeleteObjectCommand({ Bucket, Key }));
      },
    };
  }
  if (process.env.NODE_ENV === "production")
    throw new Error("Private S3 storage is required in production");
  const root = path.resolve(process.env.OBJECT_STORAGE_DIR || ".local/objects");
  const resolve = (key: string) => {
    if (!/^[a-zA-Z0-9/_-]+$/.test(key)) throw new Error("Invalid storage key");
    const p = path.resolve(root, key);
    if (!p.startsWith(root + path.sep)) throw new Error("Invalid storage key");
    return p;
  };
  return {
    async put(key, body) {
      const p = resolve(key);
      await mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
      await writeFile(p, body, { mode: 0o600, flag: "wx" });
    },
    get: (key) => readFile(resolve(key)),
    async remove(key) {
      await unlink(resolve(key)).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== "ENOENT") throw e;
      });
    },
  };
}
