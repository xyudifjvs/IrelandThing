import { Prisma, prisma } from "@weatherly/db";
import { audit, requireMatter } from "@weatherly/matters";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import type {
  ExtractionStatus,
  SourceVersion,
} from "@weatherly/platform/handoff-contracts";
import {
  extractionActionSchema,
  reviewPayloadSchema,
  saveReviewSchema,
  sourcesSchema,
  startReviewSchema,
} from "./inputs";
import { defaultReviewPayload } from "./intake-defaults";
import { intakeContractIds, originalIntakeDocumentIds } from "../snapshot";
import { listReviewDocuments, verifySources } from "./sources";

const includeIntake = { intake: true } as const;
type StoredReview = Prisma.CreationReviewGetPayload<{
  include: typeof includeIntake;
}>;
const promptVersion = "creation-signed-terms-v1";
const extractionTimeoutMs = 60_000;

export async function ownedReview(
  tx: Prisma.TransactionClient,
  actor: Principal,
  id: string,
  lock = false,
): Promise<StoredReview> {
  assertCoordinator(actor);
  if (lock)
    await tx.$queryRaw`
      SELECT id FROM "CreationReview"
      WHERE id = ${id} AND "ownerId" = ${actor.id} FOR UPDATE
    `;
  const review = await tx.creationReview.findFirst({
    where: { id, ownerId: actor.id },
    include: includeIntake,
  });
  if (!review)
    throw new HttpError(404, "REVIEW_NOT_FOUND", "Creation review not found.");
  return review;
}

export function assertReviewRevision(
  review: StoredReview,
  expectedRevision: number,
) {
  if (review.state === "deleted" || review.intake?.deletedAt)
    throw new HttpError(
      410,
      "CREATION_REVIEW_DELETED",
      "This creation review is no longer available.",
    );
  if (review.state !== "open")
    throw new HttpError(
      409,
      "REVIEW_ALREADY_CONFIRMED",
      "The creation review has already been confirmed.",
    );
  if (review.revision !== expectedRevision)
    throw new HttpError(
      409,
      "REVISION_CONFLICT",
      "The review changed. Refresh before editing or confirming.",
    );
}

// Intake starts and intake deletion share this transaction lock. It closes the
// gap where no review row exists for deletion to lock yet.
export async function lockIntakeReviewIdentity(
  tx: Prisma.TransactionClient,
  intakeId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`creation-intake:${intakeId}`}))`;
}

/** Preserve the existing Matter-before-Intake lock order used by legacy writes. */
export async function lockPendingIntake(
  tx: Prisma.TransactionClient,
  intakeId: string,
) {
  const receipt = await tx.intakeSubmission.findUnique({
    where: { id: intakeId },
  });
  if (!receipt)
    throw new HttpError(404, "INTAKE_NOT_FOUND", "Intake not found.");
  await tx.$queryRaw`SELECT id FROM "Matter" WHERE id = ${receipt.matterId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "IntakeSubmission" WHERE id = ${intakeId} FOR UPDATE`;
  const intake = await tx.intakeSubmission.findUnique({
    where: { id: intakeId },
  });
  if (!intake || intake.deletedAt)
    throw new HttpError(404, "INTAKE_NOT_FOUND", "Intake not found.");
  if (intake.matterId !== receipt.matterId)
    throw new HttpError(
      409,
      "INTAKE_CHANGED",
      "The intake transaction changed. Refresh the review.",
    );
  const matter = await tx.matter.findUnique({ where: { id: intake.matterId } });
  if (matter?.stage !== "pending_review" || matter.checklistVersion !== null)
    throw new HttpError(
      409,
      "INTAKE_ALREADY_CONFIRMED",
      "The intake is no longer awaiting confirmation.",
    );
  return { intake, matter };
}

async function intakeSummary(
  tx: Prisma.TransactionClient,
  intake: NonNullable<StoredReview["intake"]>,
) {
  const agent = await tx.user.findUnique({
    where: { id: intake.userId },
    select: {
      name: true,
      email: true,
      brokerage: true,
      rosterAgent: { select: { phone: true } },
    },
  });
  const documents = await tx.document.findMany({
    where: {
      creationReviewId: null,
      OR: [
        {
          intakeSubmissionId: intake.id,
          OR: [{ matterId: null }, { matterId: intake.matterId }],
        },
        {
          matterId: intake.matterId,
          intakeSubmissionId: null,
          id: { in: originalIntakeDocumentIds(intake.snapshot) },
        },
      ],
    },
    select: {
      id: true,
      name: true,
      versions: {
        where: { createdAt: { lte: intake.createdAt } },
        orderBy: { version: "desc" },
        take: 1,
        select: { originalName: true },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return {
    id: intake.id,
    snapshot: intake.snapshot,
    createdAt: intake.createdAt,
    documents: documents.map(({ id, name, versions }) => ({
      id,
      name: versions[0]?.originalName || name,
    })),
    agent: agent
      ? {
          name: agent.name,
          email: agent.email,
          brokerage: agent.brokerage,
          phone: agent.rosterAgent?.phone ?? null,
        }
      : null,
  };
}

export async function readMatterIntake(actor: Principal, matterId: string) {
  assertCoordinator(actor);
  return prisma.$transaction(async (tx) => {
    await requireMatter(actor, matterId, false, tx);
    const intake = await tx.intakeSubmission.findFirst({
      where: { matterId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return intake ? intakeSummary(tx, intake) : null;
  });
}

async function recordExtraction(
  tx: Prisma.TransactionClient,
  reviewId: string,
  generation: number,
  sources: SourceVersion[],
  action: "start" | "skip",
) {
  await tx.creationExtraction.create({
    data: {
      reviewId,
      generation,
      sourceRefs: sources,
      promptVersion,
      status: action === "start" ? "queued" : "skipped",
      finishedAt: action === "skip" ? new Date() : null,
    },
  });
  if (action === "start")
    await tx.outboxJob.create({
      data: {
        topic: "creation.extract",
        idempotencyKey: `creation-extract:${reviewId}:${generation}`,
        payload: { reviewId, generation },
      },
    });
}

async function projectReview(
  tx: Prisma.TransactionClient,
  review: StoredReview,
) {
  if (
    review.intake?.deletedAt ||
    review.state === "deleted" ||
    (review.state === "confirmed" && !review.confirmedMatterId)
  )
    throw new HttpError(
      410,
      "CREATION_REVIEW_DELETED",
      "This creation review is no longer available.",
    );
  const generation = review.extractionGeneration;
  const sources = sourcesSchema.parse(review.sourceRefs);
  const extraction =
    generation > 0
      ? await tx.creationExtraction.findUnique({
          where: { reviewId_generation: { reviewId: review.id, generation } },
        })
      : null;
  let status = (extraction?.status ?? "idle") as ExtractionStatus;
  const expired =
    extraction &&
    (status === "queued" || status === "running") &&
    Date.now() - extraction.createdAt.getTime() >= extractionTimeoutMs;
  if (expired) status = "unavailable";
  return {
    id: review.id,
    revision: review.revision,
    state: review.state,
    intake: review.intake ? await intakeSummary(tx, review.intake) : null,
    ...reviewPayloadSchema.parse(review.payload),
    sources,
    documents: await listReviewDocuments(tx, review, sources),
    extraction: {
      generation,
      status,
      proposal: status === "proposed" ? (extraction?.result ?? null) : null,
      reason: expired
        ? "timeout"
        : status === "unavailable"
          ? (extraction?.errorCode ?? null)
          : null,
    },
    confirmedMatterId: review.confirmedMatterId,
  };
}

export async function readCreationReview(actor: Principal, id: string) {
  return prisma.$transaction(
    async (tx) => projectReview(tx, await ownedReview(tx, actor, id)),
    { isolationLevel: "RepeatableRead" },
  );
}

export async function startCreationReview(actor: Principal, input: unknown) {
  assertCoordinator(actor);
  const { requestId, intakeId } = startReviewSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const replay = async () => {
      const existing = await tx.creationReview.findUnique({
        where: { startRequestId: requestId },
        include: includeIntake,
      });
      if (
        existing &&
        (existing.ownerId !== actor.id ||
          existing.intakeId !== (intakeId ?? null))
      )
        throw new HttpError(
          409,
          "START_REQUEST_CONFLICT",
          "The request key belongs to a different creation review.",
        );
      return existing;
    };
    const existing = await replay();
    if (existing) return projectReview(tx, existing);

    let payload: Prisma.InputJsonValue = { facts: {}, people: [], dates: [] };
    let sources: SourceVersion[] = [];
    if (intakeId) {
      await lockIntakeReviewIdentity(tx, intakeId);
      const { intake, matter } = await lockPendingIntake(tx, intakeId);
      const active = await tx.creationReview.findUnique({
        where: { intakeId },
        include: includeIntake,
      });
      if (active) {
        if (active.ownerId !== actor.id)
          throw new HttpError(
            409,
            "INTAKE_REVIEW_EXISTS",
            "This intake already has a creation review.",
          );
        return projectReview(tx, active);
      }
      const agent = await tx.user.findUnique({
        where: { id: intake.userId },
        select: { name: true, email: true },
      });
      payload = reviewPayloadSchema.parse(
        defaultReviewPayload(intake, matter, agent),
      );
      const contractIds = intakeContractIds(intake.snapshot);
      const documents = await tx.document.findMany({
        where: {
          id: { in: [...contractIds] },
          creationReviewId: null,
          OR: [
            { matterId: matter.id, intakeSubmissionId: null },
            {
              intakeSubmissionId: intake.id,
              OR: [{ matterId: null }, { matterId: matter.id }],
            },
          ],
        },
        orderBy: { id: "asc" },
        select: {
          id: true,
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { id: true },
          },
        },
      });
      sources = documents.flatMap((doc) =>
        doc.versions[0]
          ? [{ documentId: doc.id, versionId: doc.versions[0].id }]
          : [],
      );
    }

    // A retry can cross another request's commit between the initial read and insert.
    const generation = sources.length ? 1 : 0;
    const inserted = await tx.creationReview.createMany({
      data: [
        {
          ownerId: actor.id,
          intakeId,
          startRequestId: requestId,
          payload,
          sourceRefs: sources,
          extractionGeneration: generation,
        },
      ],
      skipDuplicates: true,
    });
    const review = await replay();
    if (!review)
      throw new HttpError(
        409,
        "INTAKE_REVIEW_EXISTS",
        "This intake already has a creation review.",
      );
    if (inserted.count) {
      await audit(
        tx,
        actor,
        "creation_review.opened",
        "CreationReview",
        review.id,
        null,
      );
      if (generation)
        await recordExtraction(tx, review.id, generation, sources, "start");
    }
    return projectReview(tx, review);
  });
}

export async function saveCreationReview(
  actor: Principal,
  id: string,
  input: unknown,
) {
  assertCoordinator(actor);
  const { expectedRevision, sources, ...edits } = saveReviewSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const review = await ownedReview(tx, actor, id, true);
    assertReviewRevision(review, expectedRevision);
    const current = reviewPayloadSchema.parse(review.payload);
    const payload = {
      ...current,
      ...edits,
      ...(edits.people !== undefined ? { peopleEdited: true } : {}),
      facts: { ...current.facts, ...edits.facts },
    };
    const currentSources = sourcesSchema.parse(review.sourceRefs);
    const sourcesChanged =
      sources !== undefined &&
      JSON.stringify(sources) !== JSON.stringify(currentSources);
    if (sourcesChanged) await verifySources(tx, review, sources, true);
    const updated = await tx.creationReview.update({
      where: { id },
      data: {
        payload,
        revision: { increment: 1 },
        ...(sourcesChanged
          ? { sourceRefs: sources, extractionGeneration: { increment: 1 } }
          : {}),
      },
      include: includeIntake,
    });
    return projectReview(tx, updated);
  });
}

export async function changeCreationExtraction(
  actor: Principal,
  id: string,
  input: unknown,
) {
  assertCoordinator(actor);
  const { expectedRevision, action } = extractionActionSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const review = await ownedReview(tx, actor, id, true);
    assertReviewRevision(review, expectedRevision);
    const sources = sourcesSchema.parse(review.sourceRefs);
    if (action === "start") {
      if (!sources.length)
        throw new HttpError(
          422,
          "EXTRACTION_SOURCE_REQUIRED",
          "Select a signed source or enter the details manually.",
        );
      await verifySources(tx, review, sources, true);
    }
    const updated = await tx.creationReview.update({
      where: { id },
      data: {
        revision: { increment: 1 },
        extractionGeneration: { increment: 1 },
      },
      include: includeIntake,
    });
    await recordExtraction(
      tx,
      id,
      updated.extractionGeneration,
      sources,
      action,
    );
    return projectReview(tx, updated);
  });
}
