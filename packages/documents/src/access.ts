import { z } from "zod";
import { prisma, type Prisma } from "@weatherly/db";
import { HttpError, type Principal } from "@weatherly/platform";
import {
  requireMatter,
  matterScope,
  fileReviewPending,
} from "@weatherly/matters";
import { documentAudienceWhere } from "../../matters/src/projections/document-audience";

function documentScope(actor: Principal): Prisma.DocumentWhereInput {
  if (actor.role === "coordinator")
    return {
      OR: [
        { matterId: { not: null } },
        { creationReviewId: null },
        { creationReview: { is: { ownerId: actor.id } } },
      ],
    };
  return {
    category: { not: "service_agreement" },
    OR: [
      {
        matter: { is: matterScope(actor) },
        AND: [documentAudienceWhere(actor.role)],
      },
      { matterId: null, creationReviewId: null, createdById: actor.id },
    ],
  };
}

export async function listDocuments(
  actor: Principal,
  matterId?: string,
  options: { cursor?: string; limit?: number; q?: string } = {},
) {
  const limit = z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(200)
    .parse(options.limit);
  if (options.cursor) await authorizedDocument(actor, options.cursor);
  if (matterId) await requireMatter(actor, matterId);
  const documents = await prisma.document.findMany({
    where: {
      ...(matterId ? { matterId } : {}),
      ...(options.q
        ? { name: { contains: options.q, mode: "insensitive" } }
        : {}),
      ...documentScope(actor),
    },
    include: {
      versions: {
        select: {
          id: true,
          version: true,
          size: true,
          checksum: true,
          originalName: true,
          processingStatus: true,
          error: true,
          createdAt: true,
        },
        orderBy: { version: "desc" },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    take: limit,
  });
  return actor.role === "coordinator"
    ? documents
    : documents.map((document) => ({
        ...document,
        versions:
          document.shareWithAgent === null
            ? document.versions
            : document.versions.slice(0, 1),
      }));
}
export async function authorizedDocument(
  actor: Principal,
  id: string,
  write = false,
) {
  const doc = await prisma.document.findFirst({
    where: { id, ...documentScope(actor) },
  });
  if (!doc)
    throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Document not found");
  if (doc.matterId) {
    if (write && actor.role !== "coordinator")
      throw new HttpError(
        403,
        "TRANSACTION_READ_ONLY",
        "Only Ireland can change documents on an ongoing transaction.",
      );
  }
  if (write && actor.role !== "coordinator" && doc.createdById !== actor.id)
    throw new HttpError(
      403,
      "FORBIDDEN",
      "Only the coordinator or uploader may add a version",
    );
  if (write && actor.role !== "coordinator" && doc.visibility === "client")
    throw new HttpError(
      403,
      "SHARED_VERSION_REQUIRES_REVIEW",
      "Ireland must review new versions of a client-shared document. Upload a separate document for review.",
    );
  return doc;
}

export async function requireUploadMatter(
  actor: Principal,
  matterId: string,
  tx?: Prisma.TransactionClient,
) {
  if (tx) {
    await tx.$queryRaw`SELECT id FROM "Matter" WHERE id = ${matterId} FOR UPDATE`;
  }
  const matter = await requireMatter(actor, matterId, false, tx);
  const active = ["under_contract", "closing", "listing"].includes(
    matter.stage,
  );
  if (
    (actor.role === "agent" && (!active || fileReviewPending(matter))) ||
    (matter.checklistVersion !== null && !active)
  ) {
    throw new HttpError(
      409,
      "TRANSACTION_READ_ONLY",
      "Choose an active transaction for this upload.",
    );
  }
  return matter;
}

export async function requireCreationUpload(
  actor: Principal,
  reviewId: string,
  tx?: Prisma.TransactionClient,
) {
  if (actor.role !== "coordinator")
    throw new HttpError(
      403,
      "FORBIDDEN",
      "Only Ireland can add a contract to a creation review.",
    );
  if (tx) {
    await tx.$queryRaw`SELECT id FROM "CreationReview" WHERE id = ${reviewId} AND "ownerId" = ${actor.id} FOR UPDATE`;
  }
  const db = tx ?? prisma;
  const review = await db.creationReview.findFirst({
    where: { id: reviewId, ownerId: actor.id },
    select: { state: true },
  });
  if (!review)
    throw new HttpError(404, "REVIEW_NOT_FOUND", "Creation review not found.");
  if (review.state !== "open")
    throw new HttpError(
      409,
      "REVIEW_CLOSED",
      "The creation review is already complete.",
    );
}

export async function closedDocumentArchiveEntries(
  actor: Principal,
  matterId: string,
) {
  const matter = await requireMatter(actor, matterId);
  if (matter.stage !== "closed" || fileReviewPending(matter))
    throw new HttpError(
      409,
      "FILE_NOT_CLOSED",
      "Download all documents is available on closed files.",
    );
  const documents = await prisma.document.findMany({
    where: {
      matterId,
      ...documentScope(actor),
      category: { not: "service_agreement" },
    },
    select: {
      id: true,
      name: true,
      versions: {
        take: 1,
        orderBy: { version: "desc" },
        select: { id: true, originalName: true },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return documents.flatMap(({ id, name, versions }) => {
    const [version] = versions;
    return version
      ? [{ id, versionId: version.id, name: version.originalName || name }]
      : [];
  });
}
