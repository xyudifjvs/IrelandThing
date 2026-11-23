import { Router } from "express";
import {
  checklistPrivacyHeaders,
  registerChecklistShareRoutes,
} from "../checklist-sharing";
import {
  asyncHandler,
  principal,
  assertCoordinator,
  HttpError,
} from "@weatherly/platform";
import { requireMatter } from "../access";
import { prisma } from "@weatherly/db";
import {
  getFileReviewHandler,
  confirmFileHandler,
  guardLegacyFileReview,
} from "./file-review";
import {
  createMatterHandler,
  registerFileLifecycleRoutes,
  updateMatterHandler,
} from "./lifecycle";
import type { FileLifecycleEffects } from "../commands/file-actions";
import { registerMatterPeopleRoutes } from "../people/router";
import { listMattersHandler, getMatterHandler } from "./queries";
import {
  grantParticipantHandler,
  revokeParticipantHandler,
} from "./participants";
import { reorderTasksHandler, registerChildRoutes } from "./children";
import { updateFileFacts } from "../commands/file-facts";

export function createMattersRouter({
  effects,
  canonicalCreation = false,
}: {
  effects?: FileLifecycleEffects;
  canonicalCreation?: boolean;
} = {}) {
  const router = Router();
  router.use(checklistPrivacyHeaders);
  const reviewGuard = canonicalCreation ? [guardLegacyFileReview] : [];
  router.get("/:id/file-review", ...reviewGuard, getFileReviewHandler);
  router.post("/:id/confirm-file", ...reviewGuard, confirmFileHandler);
  registerChecklistShareRoutes(router);
  registerMatterPeopleRoutes(router);
  if (effects) registerFileLifecycleRoutes(router, effects);
  router.post("/:id/tasks/reorder", reorderTasksHandler);
  router.get("/", listMattersHandler);
  router.post(
    "/",
    canonicalCreation
      ? asyncHandler(async (req) => {
          assertCoordinator(principal(req));
          throw new HttpError(
            409,
            "CREATION_REVIEW_REQUIRED",
            "Open a transaction creation review before creating a file.",
          );
        })
      : createMatterHandler,
  );
  router.get("/:id", getMatterHandler);
  router.patch(
    "/:id/facts",
    asyncHandler(async (req, res) => {
      res
        .set("Cache-Control", "private, no-store")
        .json(
          await prisma.$transaction((tx) =>
            updateFileFacts(
              tx,
              principal(req),
              String(req.params.id),
              req.body,
            ),
          ),
        );
    }),
  );
  router.patch("/:id", updateMatterHandler(Boolean(effects)));
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
