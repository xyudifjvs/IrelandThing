import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import type { RequestHandler } from "express";
import { prisma } from "@weatherly/db";
import { asyncHandler, HttpError, type Principal } from "@weatherly/platform";
import { hasAgentAgreementAccess } from "./agent-membership";

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
    advanced: {
      useSecureCookies: process.env.NODE_ENV === "production",
      ipAddress: { ipAddressHeaders: ["x-weatherly-client-ip"] },
    },
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
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
          !["/session", "/profile", "/invitations/accept"].includes(req.path)
        ) {
          if (!(await hasAgentAgreementAccess(user.id)))
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
      }
    }
    next();
  });
}
