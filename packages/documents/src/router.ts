import { Router, type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "@weatherly/db";
import { HttpError, asyncHandler, principal } from "@weatherly/platform";
import { audit, revision } from "@weatherly/matters";
import {
  listDocuments,
  authorizedDocument,
  requireUploadMatter,
} from "./access";
import { getDocument, readDocumentContent } from "./read";
import { uploadDocument } from "./upload";
import { maxBytes, visibility } from "./validation";
import { createObjectStore } from "./storage";
import { createClosedDocumentArchive } from "./archive";
import { pipeline } from "node:stream/promises";

export function createDocumentsRouter(store = createObjectStore()) {
  const r = Router();
  r.use(
    asyncHandler(async (req, res, next) => {
      res.set("Cache-Control", "private, no-store");
      principal(req);
      next();
    }),
  );
  const uploader = asyncHandler(async (req, _res, next) => {
    if (principal(req).role === "client")
      throw new HttpError(403, "FORBIDDEN", "Clients cannot upload documents");
    next();
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 5, fieldSize: 1000 },
    // Browser filenames are UTF-8; Multer otherwise decodes untagged headers as
    // latin1 and corrupts the original name before it reaches durable storage.
    defParamCharset: "utf8",
  });
  const receiveFile: RequestHandler = (req, res, next) => {
    upload.single("file")(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        next(
          new HttpError(
            error.code === "LIMIT_FILE_SIZE" ? 413 : 422,
            error.code,
            error.code === "LIMIT_FILE_SIZE"
              ? "This file exceeds 20 MB. Choose a smaller PDF or DOCX."
              : ["LIMIT_FILE_COUNT", "LIMIT_UNEXPECTED_FILE"].includes(
                    error.code,
                  )
                ? "Send one file per upload request. Use the document queue for multiple files; a revised version accepts exactly one file."
                : "The upload form exceeds its limits. Choose the file again and retry.",
          ),
        );
      } else if (
        error instanceof Error &&
        /unexpected end of (form|file)|boundary not found|malformed part header/i.test(
          error.message,
        )
      ) {
        next(
          new HttpError(
            422,
            "INCOMPLETE_UPLOAD",
            "The file did not finish uploading. Choose it again and retry. PDF and DOCX files up to 20 MB are supported.",
          ),
        );
      } else next(error);
    });
  };
  r.get(
    "/",
    asyncHandler(async (req, res) =>
      res.json(
        await listDocuments(
          principal(req),
          typeof req.query.matterId === "string"
            ? req.query.matterId
            : undefined,
          {
            cursor:
              typeof req.query.cursor === "string"
                ? req.query.cursor
                : undefined,
            limit:
              req.query.limit === undefined
                ? undefined
                : Number(req.query.limit),
            q: typeof req.query.q === "string" ? req.query.q : undefined,
          },
        ),
      ),
    ),
  );
  r.post(
    "/",
    uploader,
    receiveFile,
    asyncHandler(async (req, res) => {
      if (!req.file) throw new HttpError(422, "FILE_REQUIRED", "Choose a file");
      res
        .status(201)
        .json(await uploadDocument(principal(req), req.body, req.file, store));
    }),
  );
  r.get(
    "/archive/:matterId",
    asyncHandler(async (req, res) => {
      const archive = await createClosedDocumentArchive(
        principal(req),
        String(req.params.matterId),
        store,
      );
      res.set({
        "Content-Type": "application/zip",
        "Content-Disposition":
          'attachment; filename="transaction-documents.zip"',
        "X-Content-Type-Options": "nosniff",
      });
      await pipeline(archive, res);
    }),
  );
  r.get(
    "/:id",
    asyncHandler(async (req, res) =>
      res.json(await getDocument(principal(req), String(req.params.id))),
    ),
  );
  r.post(
    "/:id/versions",
    uploader,
    receiveFile,
    asyncHandler(async (req, res) => {
      if (!req.file) throw new HttpError(422, "FILE_REQUIRED", "Choose a file");
      res
        .status(201)
        .json(
          await uploadDocument(
            principal(req),
            req.body,
            req.file,
            store,
            String(req.params.id),
          ),
        );
    }),
  );
  r.get(
    ["/:id/download", "/:id/view"],
    asyncHandler(async (req, res) => {
      const doc = await readDocumentContent(
        principal(req),
        String(req.params.id),
        typeof req.query.versionId === "string"
          ? req.query.versionId
          : undefined,
        store,
      );
      res.setHeader("Content-Type", doc.mimeType);
      const inline =
        req.path.endsWith("/view") && doc.mimeType === "application/pdf";
      res.setHeader(
        "Content-Disposition",
        `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.originalName)}`,
      );
      if (inline) res.setHeader("Content-Security-Policy", "sandbox");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(doc.bytes);
    }),
  );
  r.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      if (actor.role !== "coordinator")
        throw new HttpError(
          403,
          "FORBIDDEN",
          "Only the coordinator can share files",
        );
      const id = String(req.params.id);
      const {
        expectedRevision,
        shareWithAgent,
        shareWithClient,
        visibility: legacyVisibility,
        category,
      } = z
        .object({
          expectedRevision: revision,
          visibility: visibility.optional(),
          shareWithAgent: z.boolean().optional(),
          shareWithClient: z.boolean().optional(),
          category: z.string().max(100).optional(),
        })
        .strict()
        .refine(
          (input) =>
            input.visibility === undefined ||
            (input.shareWithAgent === undefined &&
              input.shareWithClient === undefined),
        )
        .parse(req.body);
      const current = await authorizedDocument(actor, id, true);
      if (current.creationReviewId)
        throw new HttpError(
          409,
          "REVIEW_DOCUMENT_PRIVATE",
          "Review documents are private until the file is created.",
        );
      if (
        current.category === "service_agreement" ||
        category === "service_agreement"
      )
        throw new HttpError(
          409,
          "AGREEMENT_PRIVATE",
          "Service agreements stay in the agent roster.",
        );
      res.json(
        await prisma.$transaction(async (tx) => {
          if (current.matterId)
            await requireUploadMatter(actor, current.matterId, tx);
          const independent =
            current.shareWithAgent !== null ||
            shareWithAgent !== undefined ||
            shareWithClient !== undefined;
          const agent =
            shareWithAgent ??
            (legacyVisibility
              ? legacyVisibility !== "coordinator"
              : (current.shareWithAgent ??
                current.visibility !== "coordinator"));
          const client =
            shareWithClient ??
            (legacyVisibility
              ? legacyVisibility === "client"
              : (current.shareWithClient ?? current.visibility === "client"));
          const data = {
            ...(category !== undefined ? { category } : {}),
            ...(independent
              ? {
                  shareWithAgent: agent,
                  shareWithClient: client,
                  visibility: agent
                    ? client
                      ? "client"
                      : "agent"
                    : "coordinator",
                }
              : legacyVisibility
                ? { visibility: legacyVisibility }
                : {}),
          };
          const changed = await tx.document.updateMany({
            where: {
              id,
              revision: expectedRevision,
              matterId: current.matterId,
            },
            data: { ...data, revision: { increment: 1 } },
          });
          if (!changed.count)
            throw new HttpError(
              409,
              "REVISION_CONFLICT",
              "Document changed; refresh",
            );
          await audit(
            tx,
            actor,
            "document.permissions_updated",
            "Document",
            id,
            null,
            data,
          );
          return tx.document.findUniqueOrThrow({ where: { id } });
        }),
      );
    }),
  );
  return r;
}
