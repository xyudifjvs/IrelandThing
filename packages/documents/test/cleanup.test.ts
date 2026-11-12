import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { prisma } from "@weatherly/db";
import {
  documentCleanupTopic,
  queueFileDocumentCleanup,
  removeDeletedDocumentBlob,
} from "../src/cleanup";

it("commits blob jobs with file deletion and skips keys still in use", async () => {
  const matter = await prisma.matter.create({
    data: {
      title: "Synthetic cleanup",
      propertyAddress: "Test Lane",
      side: "buyer",
      packageCode: "essentials",
    },
  });
  const key = `documents/${randomUUID()}/${randomUUID()}`;
  const document = await prisma.document.create({
    data: {
      matterId: matter.id,
      name: "Synthetic contract",
      mimeType: "application/pdf",
      createdById: "synthetic",
      versions: {
        create: {
          objectKey: key,
          checksum: "a".repeat(64),
          size: 1,
          version: 1,
        },
      },
    },
    include: { versions: true },
  });
  const idempotencyKey = `${documentCleanupTopic}:${document.versions[0].id}`;
  const remove = vi.fn(async () => {});
  const store = {
    put: async () => {},
    get: async () => Buffer.alloc(0),
    remove,
  };
  try {
    await removeDeletedDocumentBlob(store, { objectKey: key });
    expect(remove).not.toHaveBeenCalled();
    await expect(
      prisma.$transaction(async (tx) => {
        await queueFileDocumentCleanup(tx, matter.id);
        throw new Error("Synthetic rollback");
      }),
    ).rejects.toThrow("Synthetic rollback");
    expect(
      await prisma.outboxJob.findUnique({ where: { idempotencyKey } }),
    ).toBeNull();
    await prisma.$transaction(async (tx) => {
      await queueFileDocumentCleanup(tx, matter.id);
      await queueFileDocumentCleanup(tx, matter.id);
      await tx.matter.delete({ where: { id: matter.id } });
    });
    const job = await prisma.outboxJob.findUniqueOrThrow({
      where: { idempotencyKey },
    });
    await removeDeletedDocumentBlob(store, job.payload);
    expect(remove).toHaveBeenCalledExactlyOnceWith(key);
  } finally {
    await prisma.outboxJob.deleteMany({ where: { idempotencyKey } });
    await prisma.matter.deleteMany({ where: { id: matter.id } });
  }
});
