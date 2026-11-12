import type { Router } from "express";
import { z } from "zod";
import { prisma } from "@weatherly/db";
import {
  HttpError,
  asyncHandler,
  principal,
  assertCoordinator,
} from "@weatherly/platform";

export function registerAccessRoutes(r: Router) {
  r.post(
    "/users/:id/access",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      assertCoordinator(actor);
      const { enabled, reason } = z
        .object({
          enabled: z.boolean(),
          reason: z.string().trim().min(5).max(1000),
        })
        .strict()
        .parse(req.body);
      const id = String(req.params.id);
      if (id === actor.id)
        throw new HttpError(
          422,
          "SELF_REVOCATION",
          "Coordinator cannot revoke their own account",
        );
      if (!(await prisma.user.findUnique({ where: { id } })))
        throw new HttpError(404, "USER_NOT_FOUND", "User not found");
      await prisma.$transaction(async (tx) => {
        await tx.auditEvent.create({
          data: {
            actorId: actor.id,
            action: enabled
              ? "identity.access_restored"
              : "identity.access_revoked",
            entityType: "User",
            entityId: id,
            details: { reason },
          },
        });
        await tx.session.deleteMany({ where: { userId: id } });
      });
      res.json({ enabled });
    }),
  );
  r.post(
    "/sessions/revoke",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      const { sessionId } = z.object({ sessionId: z.string() }).parse(req.body);
      await prisma.session.deleteMany({
        where: { id: sessionId, userId: actor.id },
      });
      res.json({ revoked: true });
    }),
  );
}
