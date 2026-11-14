import { Router } from "express";
import { asyncHandler, principal } from "@weatherly/platform";
import {
  applyLinkedClosingDate,
  previewLinkedClosingDate,
  type HtoClosingDateCommands,
} from "./closing-date";
import { exportHtoClosings } from "./csv";
import {
  resolveHtoMatch,
  updateLinkedClosing,
  type UpdateLinkedFileFacts,
} from "./linked";
import { addManualClosing, updateManualClosing } from "./manual";
import { listHtoOperations } from "./queries";

export function createHtoOperationsRouter({
  updateFileFacts,
  closingDates,
}: {
  updateFileFacts: UpdateLinkedFileFacts;
  closingDates?: HtoClosingDateCommands;
}) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      res.json(
        await listHtoOperations(
          principal(req),
          req.query,
          new Date(),
          closingDates?.historicalDateEdits === true,
        ),
      );
    }),
  );
  router.post(
    "/rows",
    asyncHandler(async (req, res) => {
      res.status(201).json(await addManualClosing(principal(req), req.body));
    }),
  );
  router.patch(
    "/rows/:id",
    asyncHandler(async (req, res) => {
      res.json(
        await updateManualClosing(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      );
    }),
  );
  router.patch(
    "/rows/:id/facts",
    asyncHandler(async (req, res) => {
      res.json(
        await updateLinkedClosing(
          principal(req),
          String(req.params.id),
          req.body,
          updateFileFacts,
        ),
      );
    }),
  );
  router.post(
    "/rows/:id/match",
    asyncHandler(async (req, res) => {
      res.json(
        await resolveHtoMatch(principal(req), String(req.params.id), req.body),
      );
    }),
  );
  router.post(
    "/rows/:id/closing-date/preview",
    asyncHandler(async (req, res) => {
      res.json(
        await previewLinkedClosingDate(
          principal(req),
          String(req.params.id),
          req.body,
          closingDates,
        ),
      );
    }),
  );
  router.post(
    "/rows/:id/closing-date/apply",
    asyncHandler(async (req, res) => {
      res.json(
        await applyLinkedClosingDate(
          principal(req),
          String(req.params.id),
          req.body,
          closingDates,
        ),
      );
    }),
  );
  router.post(
    "/export",
    asyncHandler(async (req, res) => {
      const result = await exportHtoClosings(principal(req), req.body);
      res
        .set({
          "Content-Disposition": `attachment; filename="${result.filename}"`,
          "Content-Type": "text/csv; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        })
        .send(result.csv);
    }),
  );
  return router;
}
