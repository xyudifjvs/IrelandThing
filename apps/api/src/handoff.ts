import type { Express } from "express";
import {
  createCreationReviewRouter,
  createIntakeRouter,
  type BeforeIntakeDelete,
} from "@weatherly/intake";
import { queueDeletedFileCheckouts } from "@weatherly/billing";
import {
  invalidateFileEmailWork,
  listEmailWork,
} from "@weatherly/communications";
import {
  queueFileDocumentCleanup,
  queueIntakeDocumentCleanup,
} from "@weatherly/documents";
import { createMattersRouter } from "@weatherly/matters";
import { asyncHandler, principal } from "@weatherly/platform";
import { seedMatterChecklist } from "../../../packages/matters/src/checklist/persistence";
import {
  applyHtoChecklistClosingDate,
  previewHtoChecklistClosingDate,
} from "../../../packages/matters/src/checklist/date-commands";
import { seedMatterPeople } from "../../../packages/matters/src/people/seed";
import { matterChanged } from "../../../packages/matters/src/change-hook";
import { changeFileBusiness } from "../../../packages/matters/src/commands/file-business";
import type { FileLifecycleEffects } from "../../../packages/matters/src/commands/file-actions";
import { updateFileFacts } from "../../../packages/matters/src/commands/file-facts";
import { createPortfolioRouter } from "../../../packages/matters/src/portfolio/router";
import {
  createHtoOperationsRouter,
  removeHtoClosingBeforeDelete,
  syncHtoClosing,
} from "../../../packages/matters/src/hto-operations";

const fileLifecycle: FileLifecycleEffects = {
  onTransition: async (tx, actor, { matterId, action }) => {
    if (action !== "reopen")
      await invalidateFileEmailWork(tx, matterId, action);
    await matterChanged(tx, actor, matterId);
  },
  beforeDelete: async (tx, actor, { matterId }) => {
    await invalidateFileEmailWork(tx, matterId, "delete");
    await queueDeletedFileCheckouts(tx, actor, matterId);
    await queueFileDocumentCleanup(tx, matterId);
    await removeHtoClosingBeforeDelete(tx, actor, matterId);
  },
};

const beforeIntakeDelete: BeforeIntakeDelete = async (tx, actor, source) => {
  await invalidateFileEmailWork(tx, source.pendingMatterId, "delete");
  await queueDeletedFileCheckouts(tx, actor, source.pendingMatterId);
  await queueIntakeDocumentCleanup(tx, source);
};

export function mountFileWorkspace(app: Express) {
  const matters = createMattersRouter(fileLifecycle);
  matters.patch(
    "/:id/business",
    asyncHandler(async (req, res) =>
      res.json(
        await changeFileBusiness(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  app.use("/api/v1/matters", matters);
  app.use(
    ["/api/v1/intakes", "/api/v1/intake"],
    createIntakeRouter(beforeIntakeDelete),
  );
  app.use("/api/v1/portfolio", createPortfolioRouter({ listEmailWork }));
  app.use(
    "/api/v1/creation-reviews",
    createCreationReviewRouter({
      seedChecklist: seedMatterChecklist,
      seedPeople: seedMatterPeople,
      afterConfirm: async (tx, actor, matterId) => {
        await syncHtoClosing(tx, actor, matterId);
        const review = await tx.creationReview.findUnique({
          where: { confirmedMatterId: matterId },
          select: { intakeId: true },
        });
        if (review?.intakeId)
          await tx.outboxJob.upsert({
            where: { idempotencyKey: `intake-gift:${review.intakeId}` },
            create: {
              topic: "intake.gift",
              idempotencyKey: `intake-gift:${review.intakeId}`,
              payload: { matterId, submissionId: review.intakeId },
            },
            update: {},
          });
      },
    }),
  );
  app.use(
    "/api/v1/hto-operations",
    createHtoOperationsRouter({
      updateFileFacts,
      closingDates: {
        preview: previewHtoChecklistClosingDate,
        apply: applyHtoChecklistClosingDate,
        historicalDateEdits: true,
      },
    }),
  );
}
