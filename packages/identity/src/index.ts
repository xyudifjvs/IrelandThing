import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins";
import { hashPassword } from "better-auth/crypto";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { Router, type RequestHandler } from "express";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { requireMatter } from "@weatherly/matters";
import { prisma } from "@weatherly/db";
import {
  HttpError,
  asyncHandler,
  principal,
  assertCoordinator,
  type Principal,
} from "@weatherly/platform";

export interface IdentityOptions {
  sendSystemEmail?: (input: {
    to: string;
    subject: string;
    text: string;
    purpose: "password_reset";
  }) => Promise<void>;
}
export function createAuth(options: IdentityOptions = {}) {
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.BETTER_AUTH_SECRET ||
      process.env.BETTER_AUTH_SECRET.length < 32)
  )
    throw new Error("A strong BETTER_AUTH_SECRET is required");
  return betterAuth({
    appName: "Weatherly",
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:4000",
    secret: process.env.BETTER_AUTH_SECRET,
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    trustedOrigins: [process.env.WEB_ORIGIN || "http://localhost:3000"],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      ...(options.sendSystemEmail
        ? {
            sendResetPassword: async ({
              user,
              url,
            }: {
              user: { email: string };
              url: string;
            }) => {
              await options.sendSystemEmail!({
                to: user.email,
                subject: "Reset your Weatherly password",
                text: `Use this secure link to reset your Weatherly password: ${url}`,
                purpose: "password_reset",
              });
            },
          }
        : {}),
    },
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "agent", input: false },
        brokerage: { type: "string", required: false },
      },
    },
    plugins: [twoFactor({ issuer: "Weatherly" })],
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
      },
    },
    advanced: { useSecureCookies: process.env.NODE_ENV === "production" },
  });
}
export type WeatherlyAuth = ReturnType<typeof createAuth>;
export const authHandler = (auth: WeatherlyAuth) => toNodeHandler(auth);
export function sessionMiddleware(auth: WeatherlyAuth): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (session) {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
      });
      if (user && ["coordinator", "agent", "client"].includes(user.role)) {
        const accessEvent = await prisma.auditEvent.findFirst({
          where: {
            entityType: "User",
            entityId: user.id,
            action: {
              in: ["identity.access_revoked", "identity.access_restored"],
            },
          },
          orderBy: { createdAt: "desc" },
        });
        if (accessEvent?.action === "identity.access_revoked")
          throw new HttpError(
            403,
            "ACCOUNT_REVOKED",
            "This account access has been revoked",
          );
        if (
          !(
            process.env.APP_ENV === "local" &&
            process.env.NODE_ENV !== "production"
          ) &&
          user.role === "agent" &&
          !["/session", "/profile"].includes(req.path)
        ) {
          const agreement = await prisma.agreement.findFirst({
            where: {
              userId: user.id,
              status: "approved",
              documentId: { not: null },
            },
          });
          const override = await prisma.auditEvent.findFirst({
            where: {
              entityType: "User",
              entityId: user.id,
              action: "agent.access_override",
            },
          });
          if (!agreement && !override)
            throw new HttpError(
              403,
              "AGREEMENT_REQUIRED",
              "A signed approved service agreement is required before agent access",
            );
        }
        req.principal = {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role as Principal["role"],
          sessionId: session.session.id,
        };
        if (
          !(
            process.env.APP_ENV === "local" &&
            process.env.NODE_ENV !== "production"
          ) &&
          user.role === "coordinator" &&
          !user.twoFactorEnabled &&
          !["/session", "/profile"].includes(req.path)
        )
          throw new HttpError(
            403,
            "MFA_REQUIRED",
            "Set up authenticator verification before accessing business records",
          );
      }
    }
    next();
  });
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function createIdentityRouter(auth: WeatherlyAuth) {
  const r = Router();
  r.get(
    "/session",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: actor.id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          brokerage: true,
          twoFactorEnabled: true,
        },
      });
      const session = await prisma.session.findUnique({
        where: { id: actor.sessionId },
        select: { id: true, expiresAt: true },
      });
      res.json({
        user,
        session,
        mfaRequired: user.role === "coordinator" && !user.twoFactorEnabled,
      });
    }),
  );
  r.get(
    "/profile",
    asyncHandler(async (req, res) =>
      res.json(
        await prisma.user.findUniqueOrThrow({
          where: { id: principal(req).id },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            brokerage: true,
            twoFactorEnabled: true,
          },
        }),
      ),
    ),
  );
  r.patch(
    "/profile",
    asyncHandler(async (req, res) => {
      const data = z
        .object({
          name: z.string().trim().min(1).max(150).optional(),
          brokerage: z.string().max(250).nullable().optional(),
        })
        .strict()
        .parse(req.body);
      res.json(
        await prisma.user.update({
          where: { id: principal(req).id },
          data,
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            brokerage: true,
          },
        }),
      );
    }),
  );
  r.get(
    "/users",
    asyncHandler(async (req, res) => {
      assertCoordinator(principal(req));
      res.json(
        await prisma.user.findMany({
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            brokerage: true,
          },
          orderBy: { name: "asc" },
          take: 200,
        }),
      );
    }),
  );
  r.post(
    "/invitations",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      assertCoordinator(actor);
      const data = z
        .object({
          email: z.email().toLowerCase(),
          role: z.enum(["agent", "client"]),
          matterId: z.string().optional(),
          agreementId: z.string().optional(),
          approvalOverrideReason: z
            .string()
            .trim()
            .min(10)
            .max(1000)
            .optional(),
          expiresInHours: z.number().int().min(1).max(168).default(72),
        })
        .strict()
        .parse(req.body);
      if (data.matterId) await requireMatter(actor, data.matterId, true);
      const invitedUser = await prisma.user.findUnique({
        where: { email: data.email },
      });
      let approvedAgreementId: string | undefined;
      if (data.role === "agent") {
        const agreement = await prisma.agreement.findFirst({
          where: {
            ...(data.agreementId ? { id: data.agreementId } : {}),
            userId: invitedUser?.id || data.email,
            status: "approved",
            documentId: { not: null },
          },
        });
        if (agreement) approvedAgreementId = agreement.id;
        else if (!data.approvalOverrideReason)
          throw new HttpError(
            422,
            "AGREEMENT_REQUIRED",
            "Approve signed agreement evidence, or record a coordinator exception reason",
          );
      }
      const token = randomBytes(32).toString("base64url");
      const invitation = await prisma.invitation.create({
        data: {
          email: data.email,
          role: data.role,
          tokenHash: hash(token),
          matterId: data.matterId,
          expiresAt: new Date(Date.now() + data.expiresInHours * 3600000),
          invitedById: actor.id,
        },
      });
      await prisma.auditEvent.create({
        data: {
          actorId: actor.id,
          action: "invitation.created",
          entityType: "Invitation",
          entityId: invitation.id,
          details: {
            approvedAgreementId: approvedAgreementId || null,
            approvalOverrideReason: data.approvalOverrideReason || null,
          },
        },
      });
      res.status(201).json({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        acceptanceToken: token,
        delivery: "manual",
      });
    }),
  );
  // Only possession of an unexpired coordinator-created invitation permits account registration.
  r.post(
    "/invitations/register",
    rateLimit({
      windowMs: 60000,
      limit: 5,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    asyncHandler(async (req, res) => {
      const { token, name, password } = z
        .object({
          token: z.string().min(30),
          name: z.string().trim().min(1).max(150),
          password: z.string().min(12).max(128),
        })
        .strict()
        .parse(req.body);
      const passwordHash = await hashPassword(password);
      res.status(201).json(
        await prisma.$transaction(async (tx) => {
          const invitation = await tx.invitation.findUnique({
            where: { tokenHash: hash(token) },
          });
          if (
            !invitation ||
            invitation.acceptedAt ||
            invitation.expiresAt <= new Date()
          )
            throw new HttpError(
              400,
              "INVALID_INVITATION",
              "Invitation is expired or already used",
            );
          if (await tx.user.findUnique({ where: { email: invitation.email } }))
            throw new HttpError(
              409,
              "ACCOUNT_EXISTS",
              "Sign in to your existing account and accept the invitation",
            );
          const claimed = await tx.invitation.updateMany({
            where: {
              id: invitation.id,
              acceptedAt: null,
              expiresAt: { gt: new Date() },
            },
            data: { acceptedAt: new Date() },
          });
          if (!claimed.count)
            throw new HttpError(
              409,
              "INVITATION_USED",
              "Invitation already accepted",
            );
          const user = await tx.user.create({
            data: {
              id: randomBytes(16).toString("hex"),
              name,
              email: invitation.email,
              emailVerified: true,
              role: invitation.role,
            },
          });
          await tx.account.create({
            data: {
              id: randomBytes(16).toString("hex"),
              accountId: user.id,
              userId: user.id,
              providerId: "credential",
              password: passwordHash,
            },
          });
          await applyInvitationApproval(tx, invitation, user.id);
          if (invitation.matterId)
            await tx.matterParticipant.upsert({
              where: {
                matterId_userId: {
                  matterId: invitation.matterId,
                  userId: user.id,
                },
              },
              create: {
                matterId: invitation.matterId,
                userId: user.id,
                role: invitation.role,
              },
              update: { revokedAt: null },
            });
          return { registered: true, email: user.email };
        }),
      );
    }),
  );
  r.post(
    "/invitations/accept",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      const { token } = z.object({ token: z.string().min(30) }).parse(req.body);
      res.json(
        await prisma.$transaction(async (tx) => {
          const invitation = await tx.invitation.findUnique({
            where: { tokenHash: hash(token) },
          });
          if (
            !invitation ||
            invitation.expiresAt <= new Date() ||
            invitation.acceptedAt ||
            invitation.email.toLowerCase() !== actor.email.toLowerCase()
          )
            throw new HttpError(
              400,
              "INVALID_INVITATION",
              "Invitation is expired, already used, or belongs to another account",
            );
          if (actor.role === "coordinator")
            throw new HttpError(
              409,
              "ROLE_CONFLICT",
              "Coordinator account cannot accept another role",
            );
          const changed = await tx.invitation.updateMany({
            where: {
              id: invitation.id,
              acceptedAt: null,
              expiresAt: { gt: new Date() },
            },
            data: { acceptedAt: new Date() },
          });
          if (!changed.count)
            throw new HttpError(
              409,
              "INVITATION_USED",
              "Invitation already accepted",
            );
          await applyInvitationApproval(tx, invitation, actor.id);
          await tx.user.update({
            where: { id: actor.id },
            data: { role: invitation.role },
          });
          if (invitation.matterId)
            await tx.matterParticipant.upsert({
              where: {
                matterId_userId: {
                  matterId: invitation.matterId,
                  userId: actor.id,
                },
              },
              create: {
                matterId: invitation.matterId,
                userId: actor.id,
                role: invitation.role,
              },
              update: { revokedAt: null },
            });
          await tx.session.deleteMany({
            where: { userId: actor.id, id: { not: actor.sessionId } },
          });
          return { accepted: true, role: invitation.role };
        }),
      );
    }),
  );
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
  return r;
}

async function applyInvitationApproval(
  tx: import("@weatherly/db").Prisma.TransactionClient,
  invitation: { id: string; role: string; email: string; invitedById: string },
  userId: string,
) {
  if (invitation.role !== "agent") return;
  const decision = await tx.auditEvent.findFirst({
    where: {
      entityType: "Invitation",
      entityId: invitation.id,
      action: "invitation.created",
    },
    orderBy: { createdAt: "desc" },
  });
  const details = decision?.details as
    | { approvedAgreementId?: string; approvalOverrideReason?: string }
    | undefined;
  if (details?.approvedAgreementId) {
    const agreement = await tx.agreement.findFirst({
      where: {
        id: details.approvedAgreementId,
        userId: { in: [userId, invitation.email] },
        status: "approved",
        documentId: { not: null },
      },
    });
    if (!agreement)
      throw new HttpError(
        422,
        "AGREEMENT_REQUIRED",
        "The signed agreement approval is no longer valid",
      );
    await tx.agreement.update({
      where: { id: agreement.id },
      data: { userId },
    });
    return;
  }
  if (details?.approvalOverrideReason) {
    await tx.auditEvent.create({
      data: {
        actorId: invitation.invitedById,
        action: "agent.access_override",
        entityType: "User",
        entityId: userId,
        details: {
          reason: details.approvalOverrideReason,
          invitationId: invitation.id,
        },
      },
    });
    return;
  }
  throw new HttpError(
    422,
    "AGREEMENT_REQUIRED",
    "Approve signed agreement evidence before agent access",
  );
}
