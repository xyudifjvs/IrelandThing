import { prisma, type Prisma } from "@weatherly/db";
import { z } from "zod";
import type { ObjectStore } from "./storage";

export const documentCleanupTopic = "document.delete_blob";

async function queueCleanup(
  tx: Prisma.TransactionClient,
  documents: Prisma.DocumentWhereInput,
) {
  const versions = await tx.documentVersion.findMany({
    where: { document: { is: documents } },
    select: { id: true, objectKey: true },
  });
  await tx.outboxJob.createMany({
    data: versions.map(({ id, objectKey }) => ({
      topic: documentCleanupTopic,
      payload: { objectKey },
      idempotencyKey: `document.delete_blob:${id}`,
    })),
    skipDuplicates: true,
  });
}

export async function queueFileDocumentCleanup(
  tx: Prisma.TransactionClient,
  matterId: string,
) {
  await queueCleanup(tx, { matterId });
}

export async function queueIntakeDocumentCleanup(
  tx: Prisma.TransactionClient,
  source: {
    intakeId: string;
    pendingMatterId: string;
    reviewId: string | null;
  },
) {
  await queueCleanup(tx, {
    OR: [
      { matterId: source.pendingMatterId },
      {
        matterId: null,
        intakeSubmissionId: source.intakeId,
        creationReviewId: null,
      },
      ...(source.reviewId
        ? [
            {
              matterId: null,
              creationReviewId: source.reviewId,
              intakeSubmissionId: null,
            },
          ]
        : []),
    ],
  });
}

export async function removeDeletedDocumentBlob(
  store: ObjectStore,
  payload: unknown,
) {
  const { objectKey } = z
    .object({
      objectKey: z
        .string()
        .min(1)
        .max(512)
        .regex(/^[a-zA-Z0-9/_-]+$/),
    })
    .strict()
    .parse(payload);
  if (
    await prisma.documentVersion.findUnique({
      where: { objectKey },
      select: { id: true },
    })
  )
    return;
  await store.remove(objectKey);
}
