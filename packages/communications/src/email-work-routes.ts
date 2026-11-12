import type { Router } from "express";
import { asyncHandler, principal } from "@weatherly/platform";
import {
  changeEmailWork,
  changeTemplateWork,
  listEmailWork,
} from "./email-work";

export function registerEmailWorkRoutes(router: Router) {
  router.get(
    "/work",
    asyncHandler(async (req, res) => {
      res
        .set("Cache-Control", "private, no-store")
        .json(await listEmailWork(principal(req), req.query));
    }),
  );
  router.patch(
    "/work/:id",
    asyncHandler(async (req, res) => {
      res
        .set("Cache-Control", "private, no-store")
        .json(
          await changeEmailWork(
            principal(req),
            String(req.params.id),
            req.body,
          ),
        );
    }),
  );
  router.post(
    "/matters/:matterId/templates/:templateId/work",
    asyncHandler(async (req, res) => {
      res
        .set("Cache-Control", "private, no-store")
        .json(
          await changeTemplateWork(
            principal(req),
            String(req.params.matterId),
            String(req.params.templateId),
            req.body,
          ),
        );
    }),
  );
}
