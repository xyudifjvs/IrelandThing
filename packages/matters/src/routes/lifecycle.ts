import { asyncHandler, principal } from "@weatherly/platform";
import { createMatter, updateMatter } from "../commands/lifecycle";

export const createMatterHandler = asyncHandler(async (req, res) =>
  res.status(201).json(await createMatter(principal(req), req.body)),
);

export const updateMatterHandler = asyncHandler(async (req, res) =>
  res.json(await updateMatter(principal(req), String(req.params.id), req.body)),
);
