import JSZip from "jszip";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { HttpError, type Principal } from "@weatherly/platform";
import {
  assertCurrentDocumentActor,
  closedDocumentArchiveEntries,
} from "./access";
import { readDocumentContent } from "./read";
import type { ObjectStore } from "./storage";

function uniqueName(name: string, used: Set<string>) {
  const base = name
    .normalize("NFC")
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  const safe = base && base !== "." && base !== ".." ? base : "document";
  const extension = path.extname(safe);
  const stem = safe.slice(0, safe.length - extension.length);
  let candidate = safe;
  for (let ordinal = 2; used.has(candidate.toLowerCase()); ordinal++)
    candidate = `${stem} (${ordinal})${extension}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export async function createClosedDocumentArchive(
  actor: Principal,
  matterId: string,
  store: ObjectStore,
) {
  await assertCurrentDocumentActor(actor);
  const entries = await closedDocumentArchiveEntries(actor, matterId);
  const zip = new JSZip();
  const used = new Set<string>();
  for (const entry of entries) {
    async function* documentBytes() {
      const document = await readDocumentContent(
        actor,
        entry.id,
        entry.versionId,
        store,
      );
      yield document.bytes;
    }
    zip.file(uniqueName(entry.name, used), Readable.from(documentBytes()));
  }
  const directory = await mkdtemp(path.join(tmpdir(), "weatherly-archive-"));
  const filename = path.join(directory, "documents.zip");
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    await pipeline(
      zip.generateNodeStream({ streamFiles: true, compression: "STORE" }),
      createWriteStream(filename, { flags: "wx", mode: 0o600 }),
    );
    // The ZIP local headers contain names. Confirm access to the entire
    // manifest before exposing even the first header on the response.
    await assertCurrentDocumentActor(actor);
    const current = await closedDocumentArchiveEntries(actor, matterId);
    if (JSON.stringify(current) !== JSON.stringify(entries))
      throw new HttpError(
        409,
        "ARCHIVE_CHANGED",
        "Document access changed. Request the archive again.",
      );
    return { stream: createReadStream(filename), cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
