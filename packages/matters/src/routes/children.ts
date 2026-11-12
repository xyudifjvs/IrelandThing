import { asyncHandler, principal } from "@weatherly/platform";
import { addTask, reorderTasks } from "../commands/tasks";
import { addNote } from "../commands/notes";
import { addDeadline } from "../commands/deadlines";
import { updateChild } from "../commands/update-child";
import {
  applyMatterChecklistDates,
  previewMatterChecklistDates,
} from "../checklist/date-commands";
import type { Router } from "express";

export const reorderTasksHandler = asyncHandler(async (req, res) => {
  res.json(await reorderTasks(principal(req), String(req.params.id), req.body));
});

export function registerChildRoutes(router: Router) {
  router.post(
    "/:id/checklist/dates/preview",
    asyncHandler(async (req, res) =>
      res.json(
        await previewMatterChecklistDates(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  router.post(
    "/:id/checklist/dates/apply",
    asyncHandler(async (req, res) =>
      res.json(
        await applyMatterChecklistDates(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  for (const kind of ["tasks", "deadlines", "notes"] as const) {
    const one =
      kind === "tasks" ? "task" : kind === "notes" ? "note" : "deadline";
    router.post(
      `/:id/${kind}`,
      asyncHandler(async (req, res) =>
        res
          .status(201)
          .json(
            await (
              one === "task" ? addTask : one === "note" ? addNote : addDeadline
            )(principal(req), String(req.params.id), req.body),
          ),
      ),
    );
    router.patch(
      `/:id/${kind}/:childId`,
      asyncHandler(async (req, res) =>
        res.json(
          await updateChild(
            principal(req),
            String(req.params.id),
            String(req.params.childId),
            one,
            req.body,
          ),
        ),
      ),
    );
    router.delete(
      `/:id/${kind}/:childId`,
      asyncHandler(async (req, res) =>
        res.json(
          await updateChild(
            principal(req),
            String(req.params.id),
            String(req.params.childId),
            one,
            req.body,
            true,
          ),
        ),
      ),
    );
  }
}
