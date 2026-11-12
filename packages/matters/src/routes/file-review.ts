import { prisma } from "@weatherly/db";
import {
  assertCoordinator,
  asyncHandler,
  HttpError,
  principal,
} from "@weatherly/platform";
import { requireMatter } from "../access";
import { getFileReview, confirmFile } from "../commands/file-review";

export const getFileReviewHandler = asyncHandler(async (req, res) =>
  res.json(await getFileReview(principal(req), String(req.params.id))),
);

export const confirmFileHandler = asyncHandler(async (req, res) =>
  res.json(await confirmFile(principal(req), String(req.params.id), req.body)),
);

export const guardLegacyFileReview = asyncHandler(async (req, _res, next) => {
  const actor = principal(req);
  assertCoordinator(actor);
  const matter = await requireMatter(actor, String(req.params.id));
  const pendingIntake = await prisma.intakeSubmission.findFirst({
    where: { matterId: matter.id, deletedAt: null, processedAt: null },
    select: { id: true },
  });
  if (matter.checklistVersion !== null || pendingIntake)
    throw new HttpError(
      409,
      "CREATION_REVIEW_REQUIRED",
      "Use the transaction creation review or the file checklist.",
    );
  next();
});
