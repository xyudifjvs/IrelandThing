import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import {
  HttpError,
  asyncHandler,
  principal,
  assertCoordinator,
  type Principal,
} from "@weatherly/platform";
import { CommunicationsService, createCommunicationsService } from "./service";
export * from "./service";
export * from "./gateway";
export * from "./jobs";
export * from "./policy";
export * from "./merge-fields";
let shared: CommunicationsService | undefined;
const current = () => shared || (shared = createCommunicationsService());
export const listMessages = (actor: Principal, matterId?: string) =>
  current().listMessages(actor, matterId);
export const listThreads = (actor: Principal, matterId?: string) =>
  current().listThreads(actor, matterId);
export const connectionStatus = (actor: Principal) =>
  current().connectionStatus(actor);
export const refreshTemplateDrafts = (
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
) => current().refreshTemplateDrafts(actor, matterId, tx);
export const sendSystemEmail = (
  input: Parameters<CommunicationsService["sendSystemEmail"]>[0],
) => current().sendSystemEmail(input);
export function createCommunicationsRouter(service = current()) {
  const r = Router();
  const matterId = (v: unknown) => (typeof v === "string" ? v : undefined);
  r.get(
    "/status",
    asyncHandler(async (req, res) =>
      res.json(await service.connectionStatus(principal(req))),
    ),
  );
  r.post(
    "/connect",
    asyncHandler(async (req, res) =>
      res.json(await service.connect(principal(req))),
    ),
  );
  r.get(
    "/connect",
    asyncHandler(async (req, res) =>
      res.json(await service.connect(principal(req))),
    ),
  );
  r.get(
    "/callback",
    asyncHandler(async (req, res) =>
      res.json(
        await service.callback(principal(req), {
          state: req.query.state,
          code: req.query.code,
        }),
      ),
    ),
  );
  r.post(
    "/disconnect",
    asyncHandler(async (req, res) =>
      res.json(await service.disconnect(principal(req))),
    ),
  );
  r.post(
    "/sync",
    asyncHandler(async (req, res) =>
      res.status(202).json(await service.queueSync(principal(req))),
    ),
  );
  r.get(
    "/threads",
    asyncHandler(async (req, res) =>
      res.json(
        await service.listThreads(principal(req), matterId(req.query.matterId)),
      ),
    ),
  );
  r.patch(
    "/threads/:id",
    asyncHandler(async (req, res) =>
      res.json(
        await service.associateThread(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  r.get(
    "/messages",
    asyncHandler(async (req, res) =>
      res.json(
        await service.listMessages(
          principal(req),
          matterId(req.query.matterId),
        ),
      ),
    ),
  );
  r.patch(
    "/messages/:id",
    asyncHandler(async (req, res) =>
      res.json(
        await service.shareMessage(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  r.get(
    "/drafts",
    asyncHandler(async (req, res) =>
      res.json(
        await service.listDrafts(principal(req), matterId(req.query.matterId)),
      ),
    ),
  );
  r.post(
    "/drafts",
    asyncHandler(async (req, res) =>
      res.status(201).json(await service.createDraft(principal(req), req.body)),
    ),
  );
  r.patch(
    "/drafts/:id",
    asyncHandler(async (req, res) =>
      res.json(
        await service.updateDraft(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  r.delete(
    "/drafts/:id",
    asyncHandler(async (req, res) => {
      const { expectedRevision } = z
        .object({ expectedRevision: z.number().int().positive() })
        .strict()
        .parse(req.body);
      res.json(
        await service.deleteDraft(
          principal(req),
          String(req.params.id),
          expectedRevision,
        ),
      );
    }),
  );
  r.post(
    "/drafts/:id/send",
    asyncHandler(async (req, res) =>
      res
        .status(202)
        .json(
          await service.queueSend(
            principal(req),
            String(req.params.id),
            req.body,
          ),
        ),
    ),
  );
  r.post(
    "/drafts/:id/reconcile",
    asyncHandler(async (req, res) =>
      res.json(
        await service.reconcileSend(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  r.get(
    "/merge-fields",
    asyncHandler(async (req, res) => {
      const { matterId } = z
        .object({ matterId: z.string().min(1) })
        .parse(req.query);
      res.json(await service.availableMergeFields(principal(req), matterId));
    }),
  );
  r.post(
    "/drafts/:id/reset-template",
    asyncHandler(async (req, res) =>
      res.json(
        await service.resetTemplate(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  r.get(
    "/templates",
    asyncHandler(async (req, res) =>
      res.json(
        await service.listTemplates(
          principal(req),
          req.query.includeInactive === "true",
        ),
      ),
    ),
  );
  r.post(
    "/templates",
    asyncHandler(async (req, res) =>
      res
        .status(201)
        .json(await service.saveTemplate(principal(req), req.body)),
    ),
  );
  r.patch(
    "/templates/:id",
    asyncHandler(async (req, res) =>
      res.json(
        await service.saveTemplate(
          principal(req),
          req.body,
          String(req.params.id),
        ),
      ),
    ),
  );
  r.post(
    "/templates/:id/render",
    asyncHandler(async (req, res) =>
      res.json(
        await service.renderTemplate(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  r.get(
    "/notifications",
    asyncHandler(async (req, res) => {
      assertCoordinator(principal(req));
      const jobs = await prisma.outboxJob.findMany({
        where: { topic: "system.email" },
        select: {
          id: true,
          state: true,
          attempts: true,
          error: true,
          createdAt: true,
          updatedAt: true,
          payload: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      res.json(
        jobs.map(({ payload, ...job }) => ({
          ...job,
          to: (payload as { to?: string })?.to,
          purpose: (payload as { purpose?: string })?.purpose,
        })),
      );
    }),
  );
  r.post(
    "/push",
    asyncHandler(async (req, res) => {
      const audience = process.env.GMAIL_PUBSUB_AUDIENCE,
        serviceAccount = process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT;
      if (!audience || !serviceAccount)
        throw new HttpError(
          503,
          "PUSH_NOT_CONFIGURED",
          "Verified Gmail push is not configured",
        );
      const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!bearer)
        throw new HttpError(
          401,
          "INVALID_PUSH_IDENTITY",
          "Verified Google push identity required",
        );
      let identity;
      try {
        identity = (
          await new OAuth2Client().verifyIdToken({ idToken: bearer, audience })
        ).getPayload();
      } catch {
        throw new HttpError(
          401,
          "INVALID_PUSH_IDENTITY",
          "Push identity could not be verified",
        );
      }
      if (!identity?.email_verified || identity.email !== serviceAccount)
        throw new HttpError(
          403,
          "INVALID_PUSH_IDENTITY",
          "Unexpected Google push service account",
        );
      const { message } = z
        .object({
          message: z.object({
            messageId: z.string().min(1),
            data: z.string().min(1).max(2000),
          }),
        })
        .parse(req.body);
      let decoded;
      try {
        decoded = JSON.parse(
          Buffer.from(message.data, "base64").toString("utf8"),
        );
      } catch {
        throw new HttpError(
          400,
          "INVALID_PUSH",
          "Malformed Gmail push notification",
        );
      }
      const notification = z
        .object({
          emailAddress: z.email(),
          historyId: z.string().regex(/^\d+$/),
        })
        .parse(decoded);
      if (
        notification.emailAddress.toLowerCase() !==
          service.config.mailbox?.toLowerCase() ||
        notification.emailAddress.toLowerCase() === "ireland@ireland.com"
      )
        throw new HttpError(
          403,
          "MAILBOX_MISMATCH",
          "Unexpected Gmail mailbox",
        );
      const connection = await prisma.integrationConnection.findFirst({
        where: {
          provider: "gmail",
          displayEmail: notification.emailAddress,
          status: "connected",
        },
      });
      if (!connection)
        throw new HttpError(
          404,
          "GMAIL_NOT_CONNECTED",
          "Mailbox is not connected",
        );
      try {
        await prisma.$transaction(async (tx) => {
          const receipt = await tx.webhookReceipt.create({
            data: { provider: "gmail_pubsub", eventId: message.messageId },
          });
          await tx.outboxJob.create({
            data: {
              topic: "gmail.sync",
              idempotencyKey: `gmail-push:${message.messageId}`,
              payload: { ownerId: connection.ownerId },
            },
          });
          await tx.webhookReceipt.update({
            where: { id: receipt.id },
            data: { processedAt: new Date() },
          });
        });
      } catch (e) {
        if (!(
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ))
          throw e;
      }
      res.json({ accepted: true });
    }),
  );
  return r;
}
