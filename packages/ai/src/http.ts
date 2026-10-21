import { Router } from "express";
import { asyncHandler, principal } from "@weatherly/platform";
import {
  requestReview,
  listReviews,
  approveReview,
  rejectReview,
} from "./service";
export function createAIRouter() {
  const router = Router();
  router.get(
    "/reviews",
    asyncHandler(async (req, res) =>
      res.json(await listReviews(principal(req))),
    ),
  );
  router.post(
    "/reviews",
    asyncHandler(async (req, res) =>
      res.status(202).json(await requestReview(principal(req), req.body)),
    ),
  );
  router.post(
    "/reviews/:id/approve",
    asyncHandler(async (req, res) =>
      res.json(
        await approveReview(principal(req), String(req.params.id), req.body),
      ),
    ),
  );
  router.post(
    "/reviews/:id/reject",
    asyncHandler(async (req, res) =>
      res.json(
        await rejectReview(
          principal(req),
          String(req.params.id),
          req.body.reason,
        ),
      ),
    ),
  );
  return router;
}
