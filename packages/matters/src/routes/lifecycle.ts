import type { Router } from "express";
import { asyncHandler, principal } from "@weatherly/platform";
import { createMatter, updateMatter } from "../commands/lifecycle";
import {
  changeFileLifecycle,
  deleteFile,
  previewCloseOut,
  type FileLifecycleEffects,
} from "../commands/file-actions";

export const createMatterHandler = asyncHandler(async (req, res) =>
  res.status(201).json(await createMatter(principal(req), req.body)),
);

export const updateMatterHandler = (explicitLifecycle: boolean) =>
  asyncHandler(async (req, res) =>
    res.json(
      await updateMatter(principal(req), String(req.params.id), req.body, {
        explicitLifecycle,
      }),
    ),
  );

export function registerFileLifecycleRoutes(
  router: Router,
  effects: Pick<FileLifecycleEffects, "onTransition"> &
    Partial<Pick<FileLifecycleEffects, "beforeDelete">>,
) {
  router.get(
    "/:id/close-out",
    asyncHandler(async (req, res) =>
      res.json(await previewCloseOut(principal(req), String(req.params.id))),
    ),
  );
  for (const [path, action] of [
    ["close-out", "close_out"],
    ["terminate", "terminate"],
    ["reopen", "reopen"],
  ] as const)
    router.post(
      `/:id/${path}`,
      asyncHandler(async (req, res) =>
        res.json(
          await changeFileLifecycle(
            principal(req),
            String(req.params.id),
            { ...req.body, action },
            effects,
          ),
        ),
      ),
    );
  const { beforeDelete } = effects;
  if (beforeDelete)
    router.delete(
      "/:id",
      asyncHandler(async (req, res) =>
        res.json(
          await deleteFile(principal(req), String(req.params.id), req.body, {
            beforeDelete,
          }),
        ),
      ),
    );
}
