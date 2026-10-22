import {
  requestEmailSuggestion,
  getEmailSuggestion,
  listEmailSuggestions,
} from "./email";
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
  router.post(
    "/email-suggestions",
    asyncHandler(async (req, res) =>
      res
        .status(201)
        .json(await requestEmailSuggestion(principal(req), req.body)),
    ),
  );
  router.get(
    "/email-suggestions",
    asyncHandler(async (req, res) =>
      res.json(
        await listEmailSuggestions(principal(req), {
          matterId:
            typeof req.query.matterId === "string"
              ? req.query.matterId
              : undefined,
          cursor:
            typeof req.query.cursor === "string" ? req.query.cursor : undefined,
          limit:
            req.query.limit === undefined ? undefined : Number(req.query.limit),
        }),
      ),
    ),
  );
  router.get(
    "/email-suggestions/:id",
    asyncHandler(async (req, res) =>
      res.json(await getEmailSuggestion(principal(req), String(req.params.id))),
    ),
  );
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
