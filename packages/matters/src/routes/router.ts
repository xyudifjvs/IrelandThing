import { Router } from "express";
import {
  checklistPrivacyHeaders,
  registerChecklistShareRoutes,
} from "../checklist-sharing";
import {
  asyncHandler,
  principal,
  assertCoordinator,
} from "@weatherly/platform";
import { requireMatter } from "../access";
import { prisma } from "@weatherly/db";
import { getFileReviewHandler, confirmFileHandler } from "./file-review";
import { createMatterHandler, updateMatterHandler } from "./lifecycle";
import { listMattersHandler, getMatterHandler } from "./queries";
import {
  grantParticipantHandler,
  revokeParticipantHandler,
} from "./participants";
import { reorderTasksHandler, registerChildRoutes } from "./children";

export function createMattersRouter() {
  const router = Router();
  router.use(checklistPrivacyHeaders);
  router.get("/:id/file-review", getFileReviewHandler);
  router.post("/:id/confirm-file", confirmFileHandler);
  registerChecklistShareRoutes(router);
  router.post("/:id/tasks/reorder", reorderTasksHandler);
  router.get("/", listMattersHandler);
  router.post("/", createMatterHandler);
  router.get("/:id", getMatterHandler);
  router.patch("/:id", updateMatterHandler);
  registerChildRoutes(router);
  router.post("/:id/participants", grantParticipantHandler);
  router.delete("/:id/participants/:participantId", revokeParticipantHandler);
  router.get(
    "/:id/activity",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      await requireMatter(actor, String(req.params.id));
      assertCoordinator(actor);
      res.json(
        await prisma.auditEvent.findMany({
          where: { matterId: String(req.params.id) },
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
      );
    }),
  );
  return router;
}
