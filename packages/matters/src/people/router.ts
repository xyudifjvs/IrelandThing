import type { Router } from "express";
import { asyncHandler, principal } from "@weatherly/platform";
import { addMatterPerson, updateMatterPerson } from "./commands";

export function registerMatterPeopleRoutes(router: Router) {
  router.post(
    "/:id/people",
    asyncHandler(async (req, res) => {
      res
        .set("Cache-Control", "private, no-store")
        .status(201)
        .json(
          await addMatterPerson(
            principal(req),
            String(req.params.id),
            req.body,
          ),
        );
    }),
  );
  router.patch(
    "/:id/people/:personId",
    asyncHandler(async (req, res) => {
      res
        .set("Cache-Control", "private, no-store")
        .json(
          await updateMatterPerson(
            principal(req),
            String(req.params.id),
            String(req.params.personId),
            req.body,
          ),
        );
    }),
  );
  router.delete(
    "/:id/people/:personId",
    asyncHandler(async (req, res) => {
      res
        .set("Cache-Control", "private, no-store")
        .json(
          await updateMatterPerson(
            principal(req),
            String(req.params.id),
            String(req.params.personId),
            req.body,
            true,
          ),
        );
    }),
  );
}
