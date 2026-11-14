import { prisma, Prisma } from "@weatherly/db";
import { sourceVersionSchema } from "@weatherly/platform/handoff-contracts";
import { z } from "zod";
import { assembleCreationSources } from "./source-bundle";
import { extractCreationProposal } from "./extract";
import { creationPromptVersion } from "./prompt";

const jobSchema = z
  .object({
    reviewId: z.string().min(1).max(200),
    generation: z.number().int().positive(),
  })
  .strict();
const timeBudgetMs = 60000;

async function loadCurrentReview(
  tx: Prisma.TransactionClient,
  job: z.infer<typeof jobSchema>,
) {
  await tx.$queryRaw`SELECT id FROM "CreationReview" WHERE id = ${job.reviewId} FOR UPDATE`;
  const review = await tx.creationReview.findUnique({
    where: { id: job.reviewId },
    select: {
      id: true,
      ownerId: true,
      state: true,
      intakeId: true,
      extractionGeneration: true,
      owner: { select: { role: true } },
      intake: { select: { matterId: true, deletedAt: true } },
    },
  });
  if (
    !review ||
    review.state !== "open" ||
    review.extractionGeneration !== job.generation ||
    review.owner.role !== "coordinator" ||
    review.intake?.deletedAt
  )
    return null;
  const lastAccessEvent = await tx.auditEvent.findFirst({
    where: {
      entityType: "User",
      entityId: review.ownerId,
      action: { in: ["identity.access_revoked", "identity.access_restored"] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { action: true },
  });
  return lastAccessEvent?.action === "identity.access_revoked" ? null : review;
}

export async function processCreationExtraction(
  payload: unknown,
  extract = extractCreationProposal,
) {
  const job = jobSchema.parse(payload);
  const key = { reviewId_generation: job };
  const claim = await prisma.$transaction(async (tx) => {
    const review = await loadCurrentReview(tx, job);
    if (!review) return null;
    const row = await tx.creationExtraction.findUnique({ where: key });
    if (!row || !["queued", "running"].includes(row.status)) return null;
    const endsAt = row.createdAt.getTime() + timeBudgetMs;
    if (endsAt <= Date.now() || row.promptVersion !== creationPromptVersion) {
      await tx.creationExtraction.update({
        where: key,
        data: {
          status: "unavailable",
          errorCode:
            row.promptVersion !== creationPromptVersion
              ? "prompt_version"
              : "interrupted",
          finishedAt: new Date(),
        },
      });
      return null;
    }
    // A second delivery cannot claim an already running generation.
    if (row.status === "running") return null;
    const pins = z
      .array(sourceVersionSchema)
      .min(1)
      .max(100)
      .safeParse(row.sourceRefs);
    const versions = pins.success
      ? await tx.documentVersion.findMany({
          where: {
            id: { in: pins.data.map(({ versionId }) => versionId) },
            document: {
              OR: [
                { creationReviewId: review.id },
                ...(review.intakeId
                  ? [{ intakeSubmissionId: review.intakeId }]
                  : []),
                ...(review.intake?.matterId
                  ? [
                      {
                        matterId: review.intake.matterId,
                        matter: { stage: "pending_review" },
                      },
                    ]
                  : []),
              ],
            },
          },
          select: {
            id: true,
            documentId: true,
            processingStatus: true,
            pages: true,
          },
        })
      : [];
    await tx.creationExtraction.update({
      where: key,
      data: { status: "running", startedAt: new Date() },
    });
    return {
      endsAt,
      ownerId: review.ownerId,
      sources: pins.success
        ? assembleCreationSources(
            pins.data,
            versions.map(({ id, ...version }) => ({
              ...version,
              versionId: id,
            })),
          )
        : null,
    };
  });
  if (!claim) return { status: "skipped" } as const;

  const remaining = claim.endsAt - Date.now();
  const outcome =
    remaining > 0
      ? await extract(claim.sources, { signal: AbortSignal.timeout(remaining) })
      : ({ status: "unavailable", reason: "interrupted" } as const);

  return prisma.$transaction(async (tx) => {
    const review = await loadCurrentReview(tx, job);
    if (!review || review.ownerId !== claim.ownerId)
      return { status: "skipped" } as const;
    const update = await tx.creationExtraction.updateMany({
      where: { ...job, status: "running" },
      data:
        outcome.status === "proposed" && Date.now() <= claim.endsAt
          ? {
              status: "proposed",
              result: outcome.proposal as Prisma.InputJsonValue,
              model: outcome.model,
              provider: outcome.provider,
              finishedAt: new Date(),
            }
          : {
              status: "unavailable",
              errorCode:
                outcome.status === "unavailable"
                  ? outcome.reason
                  : "interrupted",
              finishedAt: new Date(),
            },
    });
    return { status: update.count ? "stored" : "skipped" } as const;
  });
}
