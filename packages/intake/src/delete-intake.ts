import { z } from "zod";
import { type Prisma, prisma } from "@weatherly/db";
import { audit } from "@weatherly/matters";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import {
  lockIntakeReviewIdentity,
  lockPendingIntake,
} from "./creation-review/storage";

export type BeforeIntakeDelete = (
  tx: Prisma.TransactionClient,
  actor: Principal,
  event: { intakeId: string; pendingMatterId: string; reviewId: string | null },
) => Promise<void>;

const confirmDeleteSchema = z.object({ confirm: z.literal(true) }).strict();

export async function deleteIntake(
  actor: Principal,
  intakeId: string,
  input: unknown,
  beforeDelete: BeforeIntakeDelete,
) {
  assertCoordinator(actor);
  confirmDeleteSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockIntakeReviewIdentity(tx, intakeId);
    const [review] = await tx.$queryRaw<{ id: string; state: string }[]>`
      SELECT id, state FROM "CreationReview" WHERE "intakeId" = ${intakeId} FOR UPDATE
    `;
    const { intake, matter } = await lockPendingIntake(tx, intakeId);
    if (intake.processedAt || (review && review.state !== "open"))
      throw new HttpError(
        409,
        "INTAKE_ALREADY_PROCESSED",
        "The intake is already associated with a transaction.",
      );

    await beforeDelete(tx, actor, {
      intakeId,
      pendingMatterId: matter.id,
      reviewId: review?.id ?? null,
    });
    await tx.intakeSubmission.update({
      where: { id: intakeId },
      data: { deletedAt: new Date(), deletedById: actor.id },
    });
    await tx.intakeDraft.updateMany({
      where: { id: intake.draftId, submittedMatterId: matter.id },
      data: { submittedMatterId: null },
    });
    if (review) {
      await tx.creationExtraction.deleteMany({
        where: { reviewId: review.id },
      });
      await tx.creationReview.update({
        where: { id: review.id },
        data: {
          state: "deleted",
          payload: { facts: {}, people: [], dates: [] },
          sourceRefs: [],
          revision: { increment: 1 },
          extractionGeneration: { increment: 1 },
        },
      });
    }
    await tx.document.deleteMany({
      where: {
        matterId: null,
        OR: [
          { intakeSubmissionId: intakeId, creationReviewId: null },
          ...(review
            ? [{ creationReviewId: review.id, intakeSubmissionId: null }]
            : []),
        ],
      },
    });
    await tx.matter.delete({ where: { id: matter.id } });
    await audit(
      tx,
      actor,
      "intake.deleted",
      "IntakeSubmission",
      intakeId,
      null,
      {
        pendingMatterId: matter.id,
      },
    );
    return { intakeId, deleted: true };
  });
}
