import { Router, type RequestHandler } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import { hasAgentAgreementAccess } from "@weatherly/identity/membership";
import {
  HttpError,
  assertCoordinator,
  asyncHandler,
  decryptSecret,
  encryptSecret,
  hashToken,
  newToken,
  principal,
  type Principal,
} from "@weatherly/platform";
import { audit, requireMatter } from "./access";
import { approvedWorkflowTaskDates } from "./rules";
import { sharedTaskFields } from "./projections/task-fields";
import {
  audienceAllows,
  deadlineProjection,
} from "./projections/deadline-fields";
import { fileReviewPending } from "./file-review";
import { canonicalPortalTimeline } from "./projections/canonical-timeline";
import {
  documentAudienceWhere,
  portalDocumentSelect,
} from "./projections/document-audience";
import { peopleAudienceWhere, portalPersonSelect } from "./people/projection";
import { portalClosedDate } from "./projections/portal-fields";

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
  if (
    !localAccessBypass &&
    user.role === "agent" &&
    !(await hasAgentAgreementAccess(user.id, tx))
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
      const secret = await tx.checklistShareSecret.findUnique({
        where: { matterId },
        select: { shareId: true },
      });
      const active =
        !row.revokedAt &&
        row.expiresAt > new Date() &&
        (await issuerHasAccess(tx, row.issuedById, matterId));
      return {
        active,
        canCopy: active && secret?.shareId === row.id,
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
  assertCoordinator(actor);
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
  const ciphertext = encryptSecret(token);
  return prisma.$transaction(async (tx) => {
    const current = await requireMatter(actor, matterId, true, tx);
    if (fileReviewPending(current))
      throw new HttpError(
        409,
        "FILE_REVIEW_REQUIRED",
        "Ireland must confirm this file before a client checklist link can be created.",
      );
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
    await tx.checklistShareSecret.upsert({
      where: { matterId },
      create: { matterId, shareId: row.id, ciphertext },
      update: { shareId: row.id, ciphertext },
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
  assertCoordinator(actor);
  return prisma.$transaction(async (tx) => {
    await requireMatter(actor, matterId, true, tx);
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
    await tx.checklistShareSecret.deleteMany({ where: { matterId } });
    return { active: false, revoked: true };
  });
}

export async function copyChecklistShare(actor: Principal, matterId: string) {
  return prisma.$transaction(
    async (tx) => {
      const matter = await requireShareManager(actor, matterId, tx);
      const row = await tx.checklistShare.findUnique({ where: { matterId } });
      if (
        !row ||
        row.revokedAt ||
        row.expiresAt <= new Date() ||
        fileReviewPending(matter) ||
        !(await issuerHasAccess(tx, row.issuedById, matterId)) ||
        !(await issuerHasAccess(tx, actor.id, matterId))
      )
        throw unavailable();
      const secret = await tx.checklistShareSecret.findUnique({
        where: { matterId },
      });
      if (!secret || secret.shareId !== row.id) throw replacementRequired();
      let token: string;
      try {
        token = decryptSecret(secret.ciphertext);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw replacementRequired();
      }
      if (!tokenPattern.test(token) || hashToken(token) !== row.tokenHash)
        throw replacementRequired();
      return { id: row.id, expiresAt: row.expiresAt, url: clientUrl(token) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

function replacementRequired() {
  return new HttpError(
    409,
    "CHECKLIST_LINK_REPLACE_REQUIRED",
    "Ireland must replace this link before it can be copied.",
  );
}

/** The entire projection and current issuer authorization share one PostgreSQL snapshot. */
export async function getPublicChecklist(token: string) {
  if (!tokenPattern.test(token)) throw unavailable();
  return prisma.$transaction(
    async (tx) => {
      const share = await authorizedPublicShare(tx, token);
      const matter = await tx.matter.findUnique({
        where: { id: share.matterId },
        select: {
          id: true,
          title: true,
          propertyAddress: true,
          stage: true,
          side: true,
          checklistVersion: true,
          deadlineTimeZone: true,
          details: true,
          tasks: {
            orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              title: true,
              status: true,
              dueDate: true,
              dueAt: true,
              actualDate: true,
              stepKey: true,
              kind: true,
              visibility: true,
              details: true,
              dateRule: true,
            },
          },
          deadlines: {
            orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              label: true,
              date: true,
              status: true,
              details: true,
            },
          },
          documents: {
            where: {
              ...documentAudienceWhere("client"),
              shareWithClient: true,
            },
            select: portalDocumentSelect,
            orderBy: { createdAt: "desc" },
          },
          contacts: {
            where: peopleAudienceWhere("client"),
            select: portalPersonSelect,
            orderBy: { createdAt: "asc" },
          },
        },
      });
      if (!matter || fileReviewPending(matter)) throw unavailable();
      const {
        tasks,
        deadlines,
        details,
        checklistVersion,
        deadlineTimeZone,
        side,
        documents,
        contacts,
        ...summary
      } = matter;
      const portalMatter = {
        ...summary,
        side,
        closedOn: portalClosedDate(matter, tasks, "client"),
      };
      if (checklistVersion !== null)
        return {
          matter: portalMatter,
          tasks: canonicalPortalTimeline(tasks, "client", {
            timeZone: deadlineTimeZone,
          }),
          clientRequests: [],
          deadlines: [],
          documents,
          people: contacts,
        };
      const dates = deadlineProjection(deadlines, tasks, details, "client");
      const approvedTasks = approvedWorkflowTaskDates(tasks, deadlines, details)
        .filter(
          (task) =>
            task.status !== "not_applicable" &&
            audienceAllows(task.visibility, "client"),
        )
        .map(dates.task);
      const sharedTasks = approvedTasks.map(
        (
          {
            kind: _kind,
            visibility: _visibility,
            details: _details,
            dueAt: _dueAt,
            actualDate: _actualDate,
            stepKey: _key,
            dateRule: _dateRule,
            ...task
          },
          position,
        ) => {
          const { note: _note, ...appointment } = sharedTaskFields(_details);
          return { ...task, ...appointment, position };
        },
      );
      const requestIds = new Set(
        approvedTasks
          .filter((task) => task.kind === "client_request")
          .map((task) => task.id),
      );
      // Do not expose gaps from private tasks in the canonical ordering.
      return {
        matter: portalMatter,
        tasks: sharedTasks,
        clientRequests: sharedTasks.filter((task) => requestIds.has(task.id)),
        deadlines: dates.deadlines
          .filter(
            (deadline) => deadline.status === "confirmed" && deadline.date,
          )
          .map(({ id, label, date }) => ({ id, label, date })),
        documents,
        people: contacts,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

async function authorizedPublicShare(
  tx: Prisma.TransactionClient,
  token: string,
) {
  const share = await tx.checklistShare.findFirst({
    where: {
      tokenHash: hashToken(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!share || !(await issuerHasAccess(tx, share.issuedById, share.matterId)))
    throw unavailable();
  return share;
}

type PublicDocumentReader = (objectKey: string) => Promise<Buffer>;

async function publicDocumentVersion(token: string, documentId: string) {
  return prisma.$transaction(
    async (tx) => {
      const share = await authorizedPublicShare(tx, token);
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          matterId: share.matterId,
          ...documentAudienceWhere("client"),
          shareWithClient: true,
        },
        select: {
          name: true,
          mimeType: true,
          matter: {
            select: { stage: true, details: true },
          },
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: {
              id: true,
              originalName: true,
              checksum: true,
              objectKey: true,
            },
          },
        },
      });
      if (!document?.matter || fileReviewPending(document.matter))
        throw unavailable();
      const [version] = document.versions;
      if (!version) throw unavailable();
      return {
        shareId: share.id,
        name: version.originalName || document.name,
        mimeType: document.mimeType,
        ...version,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

function bearerToken(authorization?: string) {
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization || "")?.[1];
  if (!token) throw unavailable();
  return token;
}

/** Mount at /api/public/checklist. Bearer tokens cannot authorize any write. */
export function createPublicChecklistRouter(
  readDocument?: PublicDocumentReader,
) {
  const router = Router();
  router.use(checklistPrivacyHeaders);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      res.json(await getPublicChecklist(bearerToken(req.get("authorization"))));
    }),
  );
  router.get(
    ["/documents/:documentId/download", "/documents/:documentId/view"],
    asyncHandler(async (req, res) => {
      const token = bearerToken(req.get("authorization"));
      const documentId = String(req.params.documentId);
      const version = await publicDocumentVersion(token, documentId);
      if (!readDocument)
        throw new HttpError(
          503,
          "DOCUMENTS_UNAVAILABLE",
          "Document downloads are unavailable.",
        );
      const bytes = await readDocument(version.objectKey);
      const current = await publicDocumentVersion(token, documentId);
      if (current.id !== version.id || current.shareId !== version.shareId)
        throw unavailable();
      if (createHash("sha256").update(bytes).digest("hex") !== version.checksum)
        throw new HttpError(
          500,
          "CHECKSUM_MISMATCH",
          "Stored file failed integrity validation.",
        );
      const inline =
        req.path.endsWith("/view") && version.mimeType === "application/pdf";
      res.set({
        "Content-Type": version.mimeType,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(version.name)}`,
        "X-Content-Type-Options": "nosniff",
        ...(inline ? { "Content-Security-Policy": "sandbox" } : {}),
      });
      res.send(bytes);
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
    "/:id/checklist-share/copy",
    checklistPrivacyHeaders,
    asyncHandler(async (req, res) => {
      res.json(await copyChecklistShare(principal(req), String(req.params.id)));
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
