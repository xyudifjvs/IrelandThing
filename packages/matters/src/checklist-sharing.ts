import { Router, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import {
  HttpError,
  asyncHandler,
  hashToken,
  newToken,
  principal,
  type Principal,
} from "@weatherly/platform";
import { audit, requireMatter } from "./index";

/** Apply before authentication/rate limiting as well when mounting these routes. */
export const checklistPrivacyHeaders: RequestHandler = (_req, res, next) => {
  res.set({
    "Cache-Control": "private, no-store, max-age=0",
    "Surrogate-Control": "no-store",
    Pragma: "no-cache",
    Expires: "0",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Referrer-Policy": "no-referrer",
  });
  res.vary("Authorization");
  next();
};

const unavailable = () =>
  new HttpError(
    404,
    "CHECKLIST_UNAVAILABLE",
    "This checklist link is unavailable.",
  );
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const shareInput = z
  .object({ expiresAt: z.iso.datetime({ offset: true }).optional() })
  .strict();

async function requireShareManager(
  actor: Principal,
  matterId: string,
  tx: Prisma.TransactionClient | typeof prisma,
) {
  if (actor.role !== "coordinator" && actor.role !== "agent")
    throw new HttpError(
      403,
      "FORBIDDEN",
      "Only the coordinator or an authorized agent can share this checklist.",
    );
  return requireMatter(actor, matterId, false, tx);
}

async function issuerHasAccess(
  tx: Prisma.TransactionClient,
  issuedById: string,
  matterId: string,
) {
  // Never reuse the issuer's role or membership captured when the link was made.
  const user = await tx.user.findUnique({ where: { id: issuedById } });
  if (!user || (user.role !== "coordinator" && user.role !== "agent"))
    return false;
  const accessEvent = await tx.auditEvent.findFirst({
    where: {
      entityType: "User",
      entityId: user.id,
      action: { in: ["identity.access_revoked", "identity.access_restored"] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (accessEvent?.action === "identity.access_revoked") return false;
  const localAccessBypass =
    process.env.APP_ENV === "local" && process.env.NODE_ENV !== "production";
  if (!localAccessBypass && user.role === "agent") {
    const agreement = await tx.agreement.findFirst({
      where: { userId: user.id, status: "approved", documentId: { not: null } },
    });
    const override = await tx.auditEvent.findFirst({
      where: {
        entityType: "User",
        entityId: user.id,
        action: "agent.access_override",
      },
    });
    if (!agreement && !override) return false;
  }
  if (
    !localAccessBypass &&
    user.role === "coordinator" &&
    !user.twoFactorEnabled
  )
    return false;
  try {
    await requireMatter(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        sessionId: "checklist-share",
      },
      matterId,
      false,
      tx,
    );
    return true;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return false;
    throw error;
  }
}

function clientUrl(token: string) {
  let origin: URL;
  try {
    origin = new URL(process.env.WEB_ORIGIN || "http://127.0.0.1:3000");
  } catch {
    throw new HttpError(
      503,
      "SHARING_NOT_CONFIGURED",
      "Checklist sharing is not configured.",
    );
  }
  if (
    origin.protocol !== "https:" &&
    !(
      origin.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
    )
  )
    throw new HttpError(
      503,
      "SHARING_NOT_CONFIGURED",
      "Checklist sharing requires a secure application origin.",
    );
  // The fragment never reaches HTTP access logs or Referrer headers.
  return `${origin.origin}/checklist#${token}`;
}

export async function getChecklistShare(actor: Principal, matterId: string) {
  return prisma.$transaction(
    async (tx) => {
      await requireShareManager(actor, matterId, tx);
      const row = await tx.checklistShare.findUnique({ where: { matterId } });
      if (!row) return { active: false };
      return {
        active:
          !row.revokedAt &&
          row.expiresAt > new Date() &&
          (await issuerHasAccess(tx, row.issuedById, matterId)),
        id: row.id,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function createChecklistShare(
  actor: Principal,
  matterId: string,
  input: unknown = {},
) {
  const data = shareInput.parse(input ?? {});
  const now = new Date();
  const expiresAt = data.expiresAt
    ? new Date(data.expiresAt)
    : new Date(now.getTime() + 30 * 86400000);
  if (expiresAt <= now || expiresAt.getTime() > now.getTime() + 365 * 86400000)
    throw new HttpError(
      422,
      "INVALID_EXPIRY",
      "Choose a future expiry within one year.",
    );
  const token = newToken();
  const url = clientUrl(token);
  return prisma.$transaction(async (tx) => {
    await requireShareManager(actor, matterId, tx);
    await tx.$queryRaw`SELECT "id" FROM "Matter" WHERE "id" = ${matterId} FOR UPDATE`;
    await requireShareManager(actor, matterId, tx);
    const row = await tx.checklistShare.upsert({
      where: { matterId },
      create: {
        matterId,
        tokenHash: hashToken(token),
        issuedById: actor.id,
        expiresAt,
      },
      update: {
        // A new generation ID lets open sharing controls discard a rotated URL,
        // including two rotations in the same millisecond.
        id: randomUUID(),
        tokenHash: hashToken(token),
        issuedById: actor.id,
        expiresAt,
        createdAt: now,
        revokedAt: null,
      },
    });
    await audit(
      tx,
      actor,
      "checklist_share.rotated",
      "ChecklistShare",
      row.id,
      matterId,
      { expiresAt: expiresAt.toISOString() },
    );
    return {
      active: true,
      id: row.id,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      url,
    };
  });
}

export async function revokeChecklistShare(actor: Principal, matterId: string) {
  return prisma.$transaction(async (tx) => {
    await requireShareManager(actor, matterId, tx);
    await tx.$queryRaw`SELECT "id" FROM "Matter" WHERE "id" = ${matterId} FOR UPDATE`;
    await requireShareManager(actor, matterId, tx);
    const row = await tx.checklistShare.findUnique({ where: { matterId } });
    if (row && !row.revokedAt) {
      await tx.checklistShare.update({
        where: { id: row.id },
        data: { revokedAt: new Date() },
      });
      await audit(
        tx,
        actor,
        "checklist_share.revoked",
        "ChecklistShare",
        row.id,
        matterId,
      );
    }
    return { active: false, revoked: true };
  });
}

/** The entire projection and current issuer authorization share one PostgreSQL snapshot. */
export async function getPublicChecklist(token: string) {
  if (!tokenPattern.test(token)) throw unavailable();
  return prisma.$transaction(
    async (tx) => {
      const share = await tx.checklistShare.findFirst({
        where: {
          tokenHash: hashToken(token),
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (
        !share ||
        !(await issuerHasAccess(tx, share.issuedById, share.matterId))
      )
        throw unavailable();
      const matter = await tx.matter.findUnique({
        where: { id: share.matterId },
        select: {
          id: true,
          title: true,
          propertyAddress: true,
          stage: true,
          tasks: {
            where: { visibility: "client" },
            orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              title: true,
              status: true,
              dueDate: true,
            },
          },
          deadlines: {
            where: { status: "confirmed", date: { not: null } },
            orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
            select: { id: true, label: true, date: true },
          },
        },
      });
      if (!matter) throw unavailable();
      const { tasks, deadlines, ...summary } = matter;
      // Do not expose gaps from private tasks in the canonical ordering.
      return {
        matter: summary,
        tasks: tasks.map((task, position) => ({ ...task, position })),
        deadlines,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

/** Mount at /api/public/checklist. Bearer tokens cannot authorize any write. */
export function createPublicChecklistRouter() {
  const router = Router();
  router.use(checklistPrivacyHeaders);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
        req.get("authorization") || "",
      );
      if (!match) throw unavailable();
      res.json(await getPublicChecklist(match[1]));
    }),
  );
  return router;
}

export function registerChecklistShareRoutes(router: Router) {
  router.get(
    "/:id/checklist-share",
    asyncHandler(async (req, res) => {
      res.json(await getChecklistShare(principal(req), String(req.params.id)));
    }),
  );
  router.post(
    "/:id/checklist-share",
    asyncHandler(async (req, res) => {
      res
        .status(201)
        .json(
          await createChecklistShare(
            principal(req),
            String(req.params.id),
            req.body,
          ),
        );
    }),
  );
  router.delete(
    "/:id/checklist-share",
    asyncHandler(async (req, res) => {
      res.json(
        await revokeChecklistShare(principal(req), String(req.params.id)),
      );
    }),
  );
}
