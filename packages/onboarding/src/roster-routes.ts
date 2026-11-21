import type { Router } from "express";
import { asyncHandler, principal } from "@weatherly/platform";
import { getRosterAgent, listArchivedRoster, listRoster } from "./roster-read";
import {
  addRosterAgent,
  archiveRosterAgent,
  restoreRosterAgent,
  importRosterAgent,
  markAgreementSent,
  updateRosterAgent,
} from "./roster-write";

export function registerRosterRoutes(router: Router) {
  router.use("/roster", (_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  router.get(
    "/roster",
    asyncHandler(async (req, res) =>
      res.json(await listRoster(principal(req))),
    ),
  );
  router.post(
    "/roster",
    asyncHandler(async (req, res) =>
      res.status(201).json(await addRosterAgent(principal(req), req.body)),
    ),
  );
  router.post(
    "/roster/import",
    asyncHandler(async (req, res) =>
      res.json(await importRosterAgent(principal(req), req.body)),
    ),
  );
  router.get(
    "/roster/archived",
    asyncHandler(async (req, res) =>
      res.json(await listArchivedRoster(principal(req))),
    ),
  );
  router.post(
    "/roster/:id/restore",
    asyncHandler(async (req, res) =>
      res.json(
        await restoreRosterAgent(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  router.get(
    "/roster/:id",
    asyncHandler(async (req, res) =>
      res.json(await getRosterAgent(principal(req), String(req.params.id))),
    ),
  );
  router.patch(
    "/roster/:id",
    asyncHandler(async (req, res) =>
      res.json(
        await updateRosterAgent(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  router.post(
    "/roster/:id/agreement-sent",
    asyncHandler(async (req, res) =>
      res.json(
        await markAgreementSent(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  router.post(
    "/roster/:id/archive",
    asyncHandler(async (req, res) =>
      res.json(
        await archiveRosterAgent(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      ),
    ),
  );
}
