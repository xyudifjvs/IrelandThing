import { getAgentMembership } from "@weatherly/identity/membership";
import { Router } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "@weatherly/db";
import { asyncHandler, principal } from "@weatherly/platform";
import { getIntakeSubmission, listIntakeSubmissions } from "./queries";
import { createTransactionFromIntake } from "./legacy-creation";
import { deleteIntake, type BeforeIntakeDelete } from "./delete-intake";
import { draftFor, permitted, saveIntakeDraft, submitIntake } from "./submission";

export function createIntakeRouter({ beforeDelete, canonicalCreation = false }: {
  beforeDelete?: BeforeIntakeDelete;
  canonicalCreation?: boolean;
} = {}) {
  const r = Router();
  if (beforeDelete)
    r.delete(
      "/submissions/:id",
      asyncHandler(async (req, res) =>
        res.json(await deleteIntake(principal(req), String(req.params.id), req.body, beforeDelete)),
      ),
    );
  r.get("/membership", asyncHandler(async (req, res) => {
    const actor = principal(req);
    permitted(actor);
    res.set("Cache-Control", "private, no-store");
    const { business } = await getAgentMembership(actor.id);
    res.json({ business });
  }));
  r.get("/submissions", asyncHandler(async (req, res) => res.json(await listIntakeSubmissions(principal(req), req.query))));
  r.get("/submissions/:id", asyncHandler(async (req, res) => res.json(await getIntakeSubmission(principal(req), String(req.params.id)))));
  r.post("/submissions/:id/create-transaction", asyncHandler(async (req, res) => res.json(await createTransactionFromIntake(principal(req), String(req.params.id), { resumeOnly: canonicalCreation }))));

  r.get(
    "/drafts",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      permitted(actor);
      res.json(
        await prisma.intakeDraft.findMany({
          where: actor.role === "coordinator" ? {} : { userId: actor.id },
          orderBy: { updatedAt: "desc" },
          take: 100,
        }),
      );
    }),
  );
  r.post(
    "/drafts",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      permitted(actor);
      const { payload } = z
        .object({ payload: z.record(z.string(), z.json()).default({}) })
        .strict()
        .parse(req.body);
      res.status(201).json(
        await prisma.intakeDraft.create({
          data: {
            userId: actor.id,
            payload: payload as Prisma.InputJsonValue,
            status: "draft",
          },
        }),
      );
    }),
  );
  r.get(
    "/drafts/:id",
    asyncHandler(async (req, res) =>
      res.json(await draftFor(principal(req), String(req.params.id))),
    ),
  );
  r.patch(
    "/drafts/:id",
    asyncHandler(async (req, res) =>
      res.json(
        await saveIntakeDraft(principal(req), String(req.params.id), req.body),
      ),
    ),
  );
  r.post(
    "/drafts/:id/submit",
    asyncHandler(async (req, res) =>
      res.json(
        await submitIntake(principal(req), String(req.params.id), req.body),
      ),
    ),
  );
  return r;
}
