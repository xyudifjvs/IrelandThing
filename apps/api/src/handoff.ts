import type { Express } from "express";
import { createCreationReviewRouter } from "@weatherly/intake";
import { seedMatterChecklist } from "../../../packages/matters/src/checklist/persistence";
import {
  applyHtoChecklistClosingDate,
  previewHtoChecklistClosingDate,
} from "../../../packages/matters/src/checklist/date-commands";
import { seedMatterPeople } from "../../../packages/matters/src/people/seed";
import { updateFileFacts } from "../../../packages/matters/src/commands/file-facts";
import {
  createHtoOperationsRouter,
  syncHtoClosing,
} from "../../../packages/matters/src/hto-operations";

export function mountCreationAndOperations(app: Express) {
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
