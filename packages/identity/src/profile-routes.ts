import type { Router } from "express";
import { z } from "zod";
import { prisma } from "@weatherly/db";
import {
  HttpError,
  asyncHandler,
  principal,
  assertCoordinator,
} from "@weatherly/platform";
import { getAgentMembership } from "./agent-membership";
import { lockRosterEmail } from "./roster-registry";

const profileSelection = {
  id: true,
  name: true,
  email: true,
  role: true,
  brokerage: true,
  twoFactorEnabled: true,
} as const;

async function readProfile(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: profileSelection,
  });
  if (user.role !== "agent") return user;
  const roster = await prisma.rosterAgent.findFirst({
    where: { userId: user.id, archivedAt: null },
    select: { phone: true },
  });
  return {
    ...user,
    ...(await getAgentMembership(user.id)),
    phone: roster?.phone ?? null,
  };
}

export function registerProfileRoutes(r: Router) {
  r.get(
    "/session",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      const user = await readProfile(actor.id);
      const session = await prisma.session.findUnique({
        where: { id: actor.sessionId },
        select: { id: true, expiresAt: true },
      });
      res.set("Cache-Control", "private, no-store").json({
        user,
        session,
        mfaRequired: false,
      });
    }),
  );
  r.get(
    "/profile",
    asyncHandler(async (req, res) =>
      res
        .set("Cache-Control", "private, no-store")
        .json(await readProfile(principal(req).id)),
    ),
  );
  r.patch(
    "/profile",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      const { phone, ...data } = z
        .object({
          name: z.string().trim().min(1).max(150).optional(),
          brokerage: z.string().max(250).nullable().optional(),
          phone: z.string().trim().max(60).nullable().optional(),
        })
        .strict()
        .parse(req.body);
      await prisma.$transaction(async (tx) => {
        const email = await lockRosterEmail(tx, actor.email);
        const user = await tx.user.update({
          where: { id: actor.id },
          data,
          select: profileSelection,
        });
        if (phone !== undefined && user.role !== "agent")
          throw new HttpError(
            403,
            "FORBIDDEN",
            "Only an agent can edit their roster phone.",
          );
        if (user.role !== "agent") return;
        const linked = await tx.rosterAgent.findUnique({
          where: { userId: user.id },
        });
        if (linked) {
          await tx.rosterAgent.update({
            where: { id: linked.id },
            data: {
              ...data,
              phone: phone === "" ? null : phone,
              revision: { increment: 1 },
            },
          });
          return;
        }
        if (phone === undefined) return;
        const existing = await tx.rosterAgent.findUnique({
          where: { normalizedEmail: email },
        });
        if (
          existing &&
          (existing.business === "hto" ||
            existing.userId ||
            existing.archivedAt)
        )
          throw new HttpError(
            409,
            "ROSTER_LINK_REQUIRED",
            "Ask Ireland to link your portal account to the roster.",
          );
        const fields = {
          userId: user.id,
          name: user.name,
          brokerage: user.brokerage,
          phone: phone || null,
        };
        if (existing)
          await tx.rosterAgent.update({
            where: { id: existing.id },
            data: { ...fields, revision: { increment: 1 } },
          });
        else
          await tx.rosterAgent.create({
            data: {
              ...fields,
              email: user.email,
              normalizedEmail: email,
              business: "weatherly",
            },
          });
      });
      res
        .set("Cache-Control", "private, no-store")
        .json(await readProfile(actor.id));
    }),
  );
  r.get(
    "/users",
    asyncHandler(async (req, res) => {
      assertCoordinator(principal(req));
      const query = z
        .object({
          q: z.string().trim().max(200).optional(),
          cursor: z.string().min(1).max(200).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(200),
        })
        .parse(req.query);
      res.json(
        await prisma.user.findMany({
          where: query.q
            ? {
                OR: [
                  { name: { contains: query.q, mode: "insensitive" } },
                  { email: { contains: query.q, mode: "insensitive" } },
                ],
              }
            : undefined,
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            brokerage: true,
          },
          orderBy: { id: "asc" },
          take: query.limit,
        }),
      );
    }),
  );
}
