import { createHash } from "node:crypto";
import { prisma } from "@weatherly/db";
import { HttpError, type Principal } from "@weatherly/platform";
import {
  assertCurrentDocumentActor,
  authorizedDocument,
  canReadDocumentHistory,
} from "./access";
import { createObjectStore } from "./storage";

export async function getDocument(actor: Principal, id: string) {
  const doc = await authorizedDocument(actor, id);
  const versions = await prisma.documentVersion.findMany({
    where: { documentId: id },
    orderBy: { version: "desc" },
    ...(canReadDocumentHistory(actor, doc) ? {} : { take: 1 }),
  });
  return {
    ...doc,
    versions: versions.map(
      ({
        objectKey: _,
        uploadRequestId: _request,
        uploadContextHash: _context,
        ...version
      }) => version,
    ),
  };
}
/** Authorized byte access for trusted server adapters; storage keys never cross the API boundary. */
export async function readDocumentVersion(
  actor: Principal,
  documentId: string,
  versionId: string,
  store = createObjectStore(),
) {
  return readDocumentContent(actor, documentId, versionId, store);
}

export async function readDocumentContent(
  actor: Principal,
  documentId: string,
  versionId: string | undefined,
  store: ReturnType<typeof createObjectStore>,
) {
  await assertCurrentDocumentActor(actor);
  const doc = await authorizedDocument(actor, documentId);
  const version = await prisma.documentVersion.findFirst({
    where: {
      documentId,
      ...(canReadDocumentHistory(actor, doc) && versionId
        ? { id: versionId }
        : {}),
    },
    orderBy: { version: "desc" },
  });
  if (!version || (versionId && version.id !== versionId))
    throw new HttpError(404, "VERSION_NOT_FOUND", "Version not found");
  const bytes = await store.get(version.objectKey);
  if (createHash("sha256").update(bytes).digest("hex") !== version.checksum)
    throw new HttpError(
      500,
      "CHECKSUM_MISMATCH",
      "Stored evidence failed integrity validation",
    );
  await assertCurrentDocumentActor(actor);
  const current = await authorizedDocument(actor, documentId);
  if (!canReadDocumentHistory(actor, current)) {
    const latest = await prisma.documentVersion.findFirst({
      where: { documentId },
      orderBy: { version: "desc" },
      select: { id: true },
    });
    if (latest?.id !== version.id)
      throw new HttpError(404, "VERSION_NOT_FOUND", "Version not found");
  }
  return {
    name: doc.name,
    originalName: version.originalName || doc.name,
    mimeType: doc.mimeType,
    checksum: version.checksum,
    bytes,
  };
}
