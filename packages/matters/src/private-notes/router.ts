import { Router } from "express";
import { asyncHandler, principal } from "@weatherly/platform";
import {
  addPrivateTodo,
  clearCompletedPrivateTodos,
  listPrivateTodos,
  readPrivateScratchpad,
  removePrivateTodo,
  savePrivateScratchpad,
  setPrivateTodoCompletion,
} from "./service";

export function createPrivateNotesRouter() {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.get(
    "/todos",
    asyncHandler(async (req, res) => {
      res.json(await listPrivateTodos(principal(req), req.query));
    }),
  );
  router.post(
    "/todos",
    asyncHandler(async (req, res) => {
      res.status(201).json(await addPrivateTodo(principal(req), req.body));
    }),
  );
  router.post(
    "/todos/clear-completed",
    asyncHandler(async (req, res) => {
      res.json(await clearCompletedPrivateTodos(principal(req), req.body));
    }),
  );
  router.patch(
    "/todos/:id",
    asyncHandler(async (req, res) => {
      res.json(
        await setPrivateTodoCompletion(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      );
    }),
  );
  router.delete(
    "/todos/:id",
    asyncHandler(async (req, res) => {
      res.json(
        await removePrivateTodo(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      );
    }),
  );
  router.get(
    "/scratchpad",
    asyncHandler(async (req, res) => {
      res.json(await readPrivateScratchpad(principal(req), req.query));
    }),
  );
  router.patch(
    "/scratchpad",
    asyncHandler(async (req, res) => {
      res.json(await savePrivateScratchpad(principal(req), req.body));
    }),
  );
  return router;
}
