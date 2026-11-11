import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@weatherly/db";
import { processCreationExtraction } from "../src/creation-extraction/worker";
import { creationPromptVersion } from "../src/creation-extraction/prompt";

const ownerId = `creation-extraction-${randomUUID()}`;
const docIds: string[] = [];

beforeAll(async () => {
  await prisma.user.create({
    data: {
      id: ownerId,
      name: "Synthetic coordinator",
      email: `${ownerId}@example.test`,
      role: "coordinator",
    },
  });
});

afterAll(async () => {
  await prisma.document.deleteMany({ where: { id: { in: docIds } } });
  await prisma.creationReview.deleteMany({ where: { ownerId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
});

async function fixture(owned: boolean) {
  const review = await prisma.creationReview.create({
    data: { ownerId, startRequestId: randomUUID(), extractionGeneration: 1 },
  });
  const document = await prisma.document.create({
    data: {
      name: "Synthetic offer",
      mimeType: "application/pdf",
      createdById: ownerId,
      creationReviewId: owned ? review.id : null,
    },
  });
  docIds.push(document.id);
  const version = await prisma.documentVersion.create({
    data: {
      documentId: document.id,
      objectKey: randomUUID(),
      checksum: "0".repeat(64),
      size: 70,
      version: 1,
      processingStatus: "complete",
      pages: [{ page: 1, text: "Synthetic contract" }],
    },
  });
  const job = { reviewId: review.id, generation: 1 };
  const extraction = await prisma.creationExtraction.create({
    data: {
      ...job,
      promptVersion: creationPromptVersion,
      sourceRefs: [{ documentId: document.id, versionId: version.id }],
    },
  });
  return { job, extraction };
}

it("does not expose an unrelated document version to extraction", async () => {
  const { job, extraction } = await fixture(false);
  await processCreationExtraction(job, async (sources) => {
    expect(sources).toBeNull();
    return { status: "unavailable", reason: "source_unavailable" };
  });
  const saved = await prisma.creationExtraction.findUniqueOrThrow({
    where: { id: extraction.id },
  });
  expect(saved).toMatchObject({
    status: "unavailable",
    errorCode: "source_unavailable",
    result: null,
  });
});

it("claims a generation once and discards its result after the review advances", async () => {
  const { job, extraction } = await fixture(true);
  let release!: () => void;
  let started!: () => void;
  const inFlight = new Promise<void>((resolve) => {
    release = resolve;
  });
  const claimed = new Promise<void>((resolve) => {
    started = resolve;
  });
  const first = processCreationExtraction(job, async (sources) => {
    expect(sources?.documents[0].pages[0].text).toBe("Synthetic contract");
    started();
    await inFlight;
    return { status: "unavailable", reason: "provider_unavailable" };
  });
  await Promise.race([
    claimed,
    first.then(() => {
      throw new Error("Extraction was not claimed");
    }),
  ]);
  try {
    expect(
      await processCreationExtraction(job, async () => {
        throw new Error("Duplicate provider call");
      }),
    ).toEqual({ status: "skipped" });
    await prisma.creationReview.update({
      where: { id: job.reviewId },
      data: { extractionGeneration: 2 },
    });
  } finally {
    release();
  }
  expect(await first).toEqual({ status: "skipped" });
  const saved = await prisma.creationExtraction.findUniqueOrThrow({
    where: { id: extraction.id },
  });
  expect(saved.result).toBeNull();
  expect(saved.finishedAt).toBeNull();
});
