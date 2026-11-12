import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { prisma, type Prisma } from "@weatherly/db";
import { HttpError, type Principal } from "@weatherly/platform";
import { audit } from "@weatherly/matters";
import {
  authorizedDocument,
  requireCreationUpload,
  requireUploadMatter,
} from "./access";
import { extractDocument, fileType } from "./formats";
import { getDocument } from "./read";
import type { ObjectStore } from "./storage";
import { maxBytes, visibility } from "./validation";

export async function uploadDocument(
  actor: Principal,
  params: unknown,
  file: { originalname: string; buffer: Buffer; size: number },
  store: ObjectStore,
  documentId?: string,
) {
  if (actor.role === "client")
    throw new HttpError(403, "FORBIDDEN", "Clients cannot upload documents");
  const data = z
    .object({
      matterId: z.string().optional(),
      creationReviewId: z.string().trim().min(1).max(200).optional(),
      visibility: visibility.optional(),
      category: z.string().max(100).default("contract"),
      uploadRequestId: z.uuid().optional(),
    })
    .strict()
    .refine(
      (input) => !(input.matterId && input.creationReviewId),
      "Choose one upload destination.",
    )
    .parse(params);
  if (file.size > maxBytes || !file.size)
    throw new HttpError(
      413,
      "INVALID_FILE_SIZE",
      "Choose a file between 1 byte and 20 MB",
    );
  let previous: Awaited<ReturnType<typeof authorizedDocument>> | undefined;
  if (documentId) previous = await authorizedDocument(actor, documentId, true);
  const matterId = previous?.matterId ?? data.matterId;
  const reviewId = matterId
    ? undefined
    : (previous?.creationReviewId ?? data.creationReviewId);
  const agreementUpload =
    previous?.category === "service_agreement" ||
    data.category === "service_agreement";
  if (
    agreementUpload &&
    (actor.role !== "coordinator" ||
      matterId ||
      reviewId ||
      (previous?.visibility ?? data.visibility ?? "coordinator") !==
        "coordinator")
  )
    throw new HttpError(
      403,
      "AGREEMENT_PRIVATE",
      "Upload service agreements privately through the agent roster.",
    );
  if (
    previous?.category === "service_agreement" &&
    (await prisma.agreement.findFirst({
      where: {
        OR: [
          { documentId: previous.id },
          { supportingDocumentIds: { has: previous.id } },
        ],
      },
      select: { id: true },
    }))
  )
    throw new HttpError(
      409,
      "AGREEMENT_IMMUTABLE",
      "Upload a separate signed agreement to preserve the previous record.",
    );
  if (previous && data.creationReviewId && data.creationReviewId !== reviewId)
    throw new HttpError(
      422,
      "REVIEW_MISMATCH",
      "A document version cannot move to a creation review.",
    );
  if (reviewId) await requireCreationUpload(actor, reviewId);
  if (matterId) await requireUploadMatter(actor, matterId);
  if (previous && data.matterId && previous.matterId !== data.matterId)
    throw new HttpError(
      422,
      "MATTER_MISMATCH",
      "A document version cannot move to another matter",
    );
  if (
    actor.role !== "coordinator" &&
    data.visibility &&
    data.visibility !== "agent"
  )
    throw new HttpError(
      403,
      "FORBIDDEN",
      "The coordinator approves sharing permissions",
    );
  const mimeType = fileType(
    file.originalname,
    file.buffer,
    data.category === "email_attachment",
  );
  if (previous && previous.mimeType !== mimeType)
    throw new HttpError(
      415,
      "VERSION_TYPE_MISMATCH",
      "A new version must use the same file format; create a separate document for another format",
    );
  const checksum = createHash("sha256").update(file.buffer).digest("hex");
  const originalName =
    path.basename(file.originalname).replace(/[\r\n\u0000-\u001f]/g, "") ||
    "document";
  const uploadContextHash = createHash("sha256")
    .update(
      JSON.stringify({
        documentId: documentId || null,
        matterId: data.matterId || null,
        ...(reviewId ? { creationReviewId: reviewId } : {}),
        visibility: data.visibility ?? "agent",
        category: data.category,
        name: file.originalname,
        size: file.size,
        checksum,
      }),
    )
    .digest("hex");
  // A response can be lost after PostgreSQL commits. Replaying the same selected
  // file must return that record rather than create a duplicate or new version.
  const replay = async () => {
    if (!data.uploadRequestId) return null;
    const stored = await prisma.documentVersion.findUnique({
      where: {
        uploadedById_uploadRequestId: {
          uploadedById: actor.id,
          uploadRequestId: data.uploadRequestId,
        },
      },
    });
    if (!stored) return null;
    if (stored.uploadContextHash !== uploadContextHash)
      throw new HttpError(
        409,
        "UPLOAD_REQUEST_CONFLICT",
        "This upload was already used for a different file or destination. Remove it and select the intended file again.",
      );
    return getDocument(actor, stored.documentId);
  };
  const existing = await replay();
  if (existing) return existing;
  const key = `documents/${randomUUID()}/${randomUUID()}`;
  try {
    await store.put(key, file.buffer, mimeType);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("Document storage write failed", {
      type: error instanceof Error ? error.name : "unknown",
    });
    throw new HttpError(
      503,
      "STORAGE_UNAVAILABLE",
      "Document storage is temporarily unavailable. Your file was not saved. Retry the upload, or save your intake draft and return later.",
    );
  }
  let extraction;
  try {
    extraction = await extractDocument(file.buffer, mimeType);
  } catch {
    extraction = {
      text: "",
      pages: [],
      status: "failed",
      error: "Unable to parse this file. Upload a readable PDF or DOCX.",
    };
  }
  try {
    return await prisma.$transaction(async (tx) => {
      if (reviewId) await requireCreationUpload(actor, reviewId, tx);
      const matter = matterId
        ? await requireUploadMatter(actor, matterId, tx)
        : null;
      let doc = previous;
      if (doc) {
        if (doc.category === "service_agreement") {
          await tx.$queryRaw`SELECT id FROM "Document" WHERE id = ${doc.id} FOR UPDATE`;
          if (
            await tx.agreement.findFirst({
              where: {
                OR: [
                  { documentId: doc.id },
                  { supportingDocumentIds: { has: doc.id } },
                ],
              },
              select: { id: true },
            })
          )
            throw new HttpError(
              409,
              "AGREEMENT_IMMUTABLE",
              "Upload a separate signed agreement to preserve the previous record.",
            );
        }
        const changed = await tx.document.updateMany({
          where: {
            id: doc.id,
            revision: doc.revision,
            creationReviewId: doc.creationReviewId,
            ...(actor.role !== "coordinator"
              ? { matterId: null, createdById: actor.id }
              : {}),
          },
          data: { revision: { increment: 1 } },
        });
        if (!changed.count)
          throw new HttpError(
            409,
            "REVISION_CONFLICT",
            "Another version was uploaded; retry",
          );
        doc = await tx.document.findUniqueOrThrow({ where: { id: doc.id } });
      } else {
        const independent = Boolean(
          reviewId ||
          (matter &&
            (matter.checklistVersion !== null ||
              actor.role === "agent" ||
              data.visibility === undefined)),
        );
        const shareWithAgent = actor.role === "agent";
        doc = await tx.document.create({
          data: {
            matterId: data.matterId || null,
            creationReviewId: reviewId ?? null,
            name: originalName,
            mimeType,
            category: data.category,
            visibility: independent
              ? shareWithAgent
                ? "agent"
                : "coordinator"
              : (data.visibility ??
                (actor.role === "agent" ? "agent" : "coordinator")),
            ...(independent ? { shareWithAgent, shareWithClient: false } : {}),
            createdById: actor.id,
          },
        });
      }
      const last = await tx.documentVersion.findFirst({
        where: { documentId: doc.id },
        orderBy: { version: "desc" },
      });
      const version = await tx.documentVersion.create({
        data: {
          documentId: doc.id,
          version: (last?.version || 0) + 1,
          objectKey: key,
          checksum,
          originalName,
          uploadedById: actor.id,
          uploadRequestId: data.uploadRequestId,
          uploadContextHash: data.uploadRequestId ? uploadContextHash : null,
          size: file.size,
          extractedText: extraction.text,
          pages: extraction.pages as Prisma.InputJsonValue,
          processingStatus: extraction.status,
          error: extraction.error,
        },
      });
      await audit(
        tx,
        actor,
        "document.uploaded",
        "Document",
        doc.id,
        doc.matterId,
        { version: version.version, checksum: version.checksum },
      );
      const {
        objectKey: _,
        uploadRequestId: _request,
        uploadContextHash: _context,
        ...safeVersion
      } = version;
      return { ...doc, versions: [safeVersion] };
    });
  } catch (error) {
    await store.remove(key);
    // A concurrent request may have committed the same token while this request
    // was extracting the file. The unique constraint arbitrates that race.
    if (data.uploadRequestId) {
      const existing = await replay();
      if (existing) return existing;
    }
    throw error;
  }
}
