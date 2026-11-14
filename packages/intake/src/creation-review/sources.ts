import { Prisma } from "@weatherly/db";
import { HttpError } from "@weatherly/platform";
import type { SourceVersion } from "@weatherly/platform/handoff-contracts";

export type ReviewSourceScope = {
  id: string;
  ownerId: string;
  confirmedMatterId: string | null;
  intake: { id: string; matterId: string } | null;
};

function reviewDocuments(scope: ReviewSourceScope): Prisma.DocumentWhereInput {
  const matterId = scope.confirmedMatterId ?? scope.intake?.matterId;
  const reviewDocument: Prisma.DocumentWhereInput = {
    creationReviewId: scope.id,
    intakeSubmissionId: null,
    createdById: scope.ownerId,
    OR: [{ matterId: null }, ...(matterId ? [{ matterId }] : [])],
  };
  if (!scope.intake) return reviewDocument;
  return {
    OR: [
      reviewDocument,
      {
        intakeSubmissionId: scope.intake.id,
        creationReviewId: null,
        OR: [{ matterId: null }, { matterId: scope.intake.matterId }],
      },
      {
        matterId: scope.intake.matterId,
        intakeSubmissionId: null,
        creationReviewId: null,
      },
    ],
  };
}

export function listReviewDocuments(
  tx: Prisma.TransactionClient,
  scope: ReviewSourceScope,
  pinned: SourceVersion[],
) {
  return tx.document
    .findMany({
      where: reviewDocuments(scope),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        mimeType: true,
        category: true,
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { id: true, version: true, processingStatus: true },
        },
      },
    })
    .then((documents) =>
      documents.map(({ versions, ...document }) => ({
        ...document,
        latestVersion: versions[0] ?? null,
        pinnedVersionId:
          pinned.find(({ documentId }) => documentId === document.id)
            ?.versionId ?? null,
      })),
    );
}

export async function verifySources(
  tx: Prisma.TransactionClient,
  scope: ReviewSourceScope,
  sources: SourceVersion[],
  lock = false,
) {
  if (!sources.length) return;
  const ids = sources.map(({ documentId }) => documentId);
  if (lock) {
    await tx.$queryRaw`
      SELECT id FROM "Document" WHERE id IN (${Prisma.join(ids)})
      ORDER BY id FOR UPDATE
    `;
    await tx.$queryRaw`
      SELECT id FROM "DocumentVersion"
      WHERE id IN (${Prisma.join(sources.map(({ versionId }) => versionId))})
      ORDER BY id FOR KEY SHARE
    `;
  }
  const versions = await tx.documentVersion.findMany({
    where: {
      id: { in: sources.map(({ versionId }) => versionId) },
      document: reviewDocuments(scope),
    },
    select: { id: true, documentId: true },
  });
  if (
    sources.some(
      ({ documentId, versionId }) =>
        !versions.some(
          (v) => v.id === versionId && v.documentId === documentId,
        ),
    )
  )
    throw new HttpError(
      409,
      "SOURCE_GENERATION_CONFLICT",
      "A pinned source is unavailable. Refresh the review and select its source again.",
    );
}

export async function attachReviewDocuments(
  tx: Prisma.TransactionClient,
  scope: ReviewSourceScope,
  matterId: string,
) {
  await tx.document.updateMany({
    where: { matterId: null, AND: [reviewDocuments(scope)] },
    data: { matterId },
  });
}
