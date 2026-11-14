import { asyncHandler, principal } from "@weatherly/platform";
import { listMatters, getMatter } from "../projections/matters";

export const listMattersHandler = asyncHandler(async (req, res) =>
  res.json(
    await listMatters(principal(req), {
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      cursor:
        typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      limit:
        req.query.limit === undefined ? undefined : Number(req.query.limit),
      stage: typeof req.query.stage === "string" ? req.query.stage : undefined,
    }),
  ),
);

export const getMatterHandler = asyncHandler(async (req, res) =>
  res.json(await getMatter(principal(req), String(req.params.id))),
);
