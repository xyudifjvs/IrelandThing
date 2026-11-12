import { Router } from "express";
import { asyncHandler, principal } from "@weatherly/platform";
import {
  confirmCreationReview,
  type CreationReviewDependencies,
} from "./confirm";
import {
  changeCreationExtraction,
  readCreationReview,
  saveCreationReview,
  startCreationReview,
} from "./storage";

export function createCreationReviewRouter(
  dependencies: CreationReviewDependencies,
) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  router.post(
    "/",
    asyncHandler(async (req, res) =>
      res.json(await startCreationReview(principal(req), req.body)),
    ),
  );
  router.get(
    "/:id",
    asyncHandler(async (req, res) =>
      res.json(await readCreationReview(principal(req), String(req.params.id))),
    ),
  );
  router.patch(
    "/:id",
    asyncHandler(async (req, res) =>
      res.json(
        await saveCreationReview(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  router.post(
    "/:id/extraction",
    asyncHandler(async (req, res) =>
      res.json(
        await changeCreationExtraction(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  router.post(
    "/:id/confirm",
    asyncHandler(async (req, res) =>
      res.json(
        await confirmCreationReview(
          principal(req),
          String(req.params.id),
          req.body,
          dependencies,
        ),
      ),
    ),
  );
  return router;
}
