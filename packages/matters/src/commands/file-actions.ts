import { type Prisma, prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import { z } from "zod";
import { audit, requireMatter } from "../access";
import { fileReviewPending } from "../file-review";
import { json, revision } from "../validation/common";

const actionSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("close_out"), expectedRevision: revision })
    .strict(),
  z
    .object({ action: z.literal("reopen"), expectedRevision: revision })
    .strict(),
  z
    .object({
      action: z.literal("terminate"),
      expectedRevision: revision,
      reason: z.string().trim().max(1000).optional(),
    })
    .strict(),
]);
const deleteSchema = z
  .object({ expectedRevision: revision, confirmation: z.literal("DELETE") })
  .strict();

type Action = z.infer<typeof actionSchema>["action"];

export type FileLifecycleEffects = {
  onTransition: (
    tx: Prisma.TransactionClient,
    actor: Principal,
    event: {
      matterId: string;
      action: Action;
      previousStage: string;
      stage: "closed" | "terminated" | "under_contract";
      revision: number;
    },
  ) => Promise<void>;
  beforeDelete: (
    tx: Prisma.TransactionClient,
    actor: Principal,
    event: { matterId: string; previousStage: string; revision: number },
  ) => Promise<void>;
};

const allowed: Record<Action, readonly string[]> = {
  close_out: ["under_contract", "closing"],
  terminate: ["listing", "under_contract", "closing"],
  reopen: ["closed", "terminated"],
};
const stageAfter = {
  close_out: "closed",
  terminate: "terminated",
  reopen: "under_contract",
} as const;

function assertCurrent(matter: { revision: number }, expectedRevision: number) {
  if (matter.revision !== expectedRevision)
    throw new HttpError(
      409,
      "REVISION_CONFLICT",
      "The file changed. Refresh before continuing.",
    );
}

function assertTransition(
  matter: { stage: string; details: Prisma.JsonValue },
  action: Action,
) {
  if (fileReviewPending(matter) || !allowed[action].includes(matter.stage))
    throw new HttpError(
      409,
      "INVALID_FILE_ACTION",
      "This action is unavailable in the current file status.",
    );
}

function uncheckedItems(
  tx: Prisma.TransactionClient,
  matter: { id: string; checklistVersion: number | null },
) {
  return tx.task.findMany({
    where: {
      matterId: matter.id,
      status: { notIn: ["completed", "signed", "not_applicable"] },
      ...(matter.checklistVersion === null
        ? { kind: "checklist" }
        : { stepKey: { not: null } }),
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, title: true },
  });
}

export async function previewCloseOut(actor: Principal, matterId: string) {
  assertCoordinator(actor);
  return prisma.$transaction(async (tx) => {
    const matter = await requireMatter(actor, matterId, true, tx);
    assertTransition(matter, "close_out");
    return {
      expectedRevision: matter.revision,
      uncheckedItems: await uncheckedItems(tx, matter),
    };
  });
}

export async function changeFileLifecycle(
  actor: Principal,
  matterId: string,
  raw: unknown,
  effects: Pick<FileLifecycleEffects, "onTransition">,
) {
  assertCoordinator(actor);
  const input = actionSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const matter = await requireMatter(actor, matterId, true, tx);
    assertCurrent(matter, input.expectedRevision);
    assertTransition(matter, input.action);
    const evidence = {
      fromStage: matter.stage,
      at: new Date().toISOString(),
      byId: actor.id,
    };
    const details = json.parse(matter.details);
    const unchecked =
      input.action === "close_out" ? await uncheckedItems(tx, matter) : [];
    switch (input.action) {
      case "close_out":
        details.closeOut = evidence;
        break;
      case "terminate":
        details.termination = {
          ...evidence,
          beforeClosing: true,
          reason: input.reason || null,
        };
        break;
      case "reopen":
        details.reopened = evidence;
        break;
    }
    const stage = stageAfter[input.action];
    const changed = await tx.matter.update({
      where: { id: matterId },
      data: { stage, details, revision: { increment: 1 } },
      select: { id: true, revision: true },
    });
    await effects.onTransition(tx, actor, {
      matterId,
      action: input.action,
      previousStage: matter.stage,
      stage,
      revision: changed.revision,
    });
    await audit(
      tx,
      actor,
      `matter.${input.action}`,
      "Matter",
      matterId,
      matterId,
      {
        ...evidence,
        stage,
        beforeRevision: matter.revision,
        ...(input.action === "terminate"
          ? { reason: input.reason || null }
          : {}),
        ...(input.action === "close_out"
          ? { uncheckedItemCount: unchecked.length }
          : {}),
      },
    );
    return {
      matterId,
      stage,
      revision: changed.revision,
      uncheckedItems: unchecked,
    };
  });
}

export async function deleteFile(
  actor: Principal,
  matterId: string,
  raw: unknown,
  effects: Pick<FileLifecycleEffects, "beforeDelete">,
) {
  assertCoordinator(actor);
  const { expectedRevision } = deleteSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    // Confirmation and extraction lock the review before accessing its file.
    const reviews = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "CreationReview"
      WHERE "confirmedMatterId" = ${matterId}
         OR "intakeId" IN (SELECT id FROM "IntakeSubmission" WHERE "matterId" = ${matterId})
      ORDER BY id FOR UPDATE
    `;
    const matter = await requireMatter(actor, matterId, true, tx);
    assertCurrent(matter, expectedRevision);
    if (fileReviewPending(matter))
      throw new HttpError(
        409,
        "INTAKE_REVIEW_REQUIRED",
        "Delete an unconfirmed intake from the intake list.",
      );

    // Domain owners can invalidate jobs and enqueue blob cleanup while the
    // matter and its source references still exist. The hook is DB-only.
    await effects.beforeDelete(tx, actor, {
      matterId,
      previousStage: matter.stage,
      revision: matter.revision,
    });
    const now = new Date();
    await tx.intakeSubmission.updateMany({
      where: { matterId, processedAt: null },
      data: { processedAt: now, processedById: actor.id },
    });
    await tx.intakeSubmission.updateMany({
      where: { matterId, deletedAt: null },
      data: { deletedAt: now, deletedById: actor.id },
    });
    await tx.intakeDraft.updateMany({
      where: { submittedMatterId: matterId },
      data: { submittedMatterId: null },
    });
    const reviewIds = reviews.map(({ id }) => id);
    if (reviewIds.length) {
      await tx.creationExtraction.deleteMany({
        where: { reviewId: { in: reviewIds } },
      });
      await tx.creationReview.updateMany({
        where: { id: { in: reviewIds } },
        data: {
          payload: { facts: {}, people: [], dates: [] },
          sourceRefs: [],
          revision: { increment: 1 },
          extractionGeneration: { increment: 1 },
        },
      });
    }
    await tx.matter.delete({ where: { id: matterId } });
    await audit(tx, actor, "matter.deleted", "Matter", matterId, matterId, {
      beforeRevision: matter.revision,
      previousStage: matter.stage,
    });
    return { matterId, deleted: true };
  });
}
