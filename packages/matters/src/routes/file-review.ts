import { asyncHandler, principal } from "@weatherly/platform";
import { getFileReview, confirmFile } from "../commands/file-review";

export const getFileReviewHandler = asyncHandler(async (req, res) =>
  res.json(await getFileReview(principal(req), String(req.params.id))),
);

export const confirmFileHandler = asyncHandler(async (req, res) =>
  res.json(await confirmFile(principal(req), String(req.params.id), req.body)),
);
