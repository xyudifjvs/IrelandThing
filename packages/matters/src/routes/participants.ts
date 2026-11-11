import {
  asyncHandler,
  principal,
  assertCoordinator,
  HttpError,
} from "@weatherly/platform";
import { z } from "zod";
import { prisma } from "@weatherly/db";
import { requireMatter, audit } from "../access";

export const grantParticipantHandler = asyncHandler(async (req, res) => {
  const actor = principal(req);
  assertCoordinator(actor);
  const data = z
    .object({ userId: z.string(), role: z.enum(["agent", "client"]) })
    .strict()
    .parse(req.body);
  res.status(201).json(
    await prisma.$transaction(async (tx) => {
      await requireMatter(actor, String(req.params.id), true, tx);
      if (
        !(await tx.user.findFirst({
          where: { id: data.userId, role: data.role },
        }))
      )
        throw new HttpError(
          422,
          "INVALID_PARTICIPANT",
          "User role does not match",
        );
      const row = await tx.matterParticipant.upsert({
        where: {
          matterId_userId: {
            matterId: String(req.params.id),
            userId: data.userId,
          },
        },
        create: { ...data, matterId: String(req.params.id) },
        update: { role: data.role, revokedAt: null },
      });
      await audit(
        tx,
        actor,
        "participant.granted",
        "MatterParticipant",
        row.id,
        row.matterId,
      );
      return row;
    }),
  );
});

export const revokeParticipantHandler = asyncHandler(async (req, res) => {
  const actor = principal(req);
  assertCoordinator(actor);
  await prisma.$transaction(async (tx) => {
    await requireMatter(actor, String(req.params.id), true, tx);
    const changed = await tx.matterParticipant.updateMany({
      where: {
        id: String(req.params.participantId),
        matterId: String(req.params.id),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (!changed.count)
      throw new HttpError(404, "NOT_FOUND", "Participant not found");
    await audit(
      tx,
      actor,
      "participant.revoked",
      "MatterParticipant",
      String(req.params.participantId),
      String(req.params.id),
    );
  });
  res.json({ revoked: true });
});
