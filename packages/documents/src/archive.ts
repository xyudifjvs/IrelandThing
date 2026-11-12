import JSZip from "jszip";
import { Readable } from "node:stream";
import path from "node:path";
import { type Principal } from "@weatherly/platform";
import { closedDocumentArchiveEntries } from "./access";
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
  return zip.generateNodeStream({ streamFiles: true, compression: "STORE" });
}
