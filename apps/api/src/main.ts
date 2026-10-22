import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import {
  configureNetworkBoundary,
  requestLimiter,
} from "../../../packages/platform/src/request-limits";
import { createOperationsRouter } from "../../../packages/platform/src/operations";
import { ZodError } from "zod";
import { prisma } from "@weatherly/db";
import {
  HttpError,
  sanitizeError,
  principal,
  assertCoordinator,
  asyncHandler,
} from "@weatherly/platform";
import {
  createBillingRouter,
  stripeWebhook,
  billingConfigured,
} from "@weatherly/billing";
import { createAIRouter, aiConfigured } from "@weatherly/ai";
import {
  createAssistantRouter,
  createMcpRouter,
  WeatherlyOAuth,
  resourceUrl,
  registerAssistantMessages,
} from "@weatherly/assistant";
import {
  createCommunicationsRouter,
  listMessages,
  connectionStatus,
  sendSystemEmail,
  refreshTemplateDrafts,
} from "@weatherly/communications";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { createWorkflowsRouter } from "../../../packages/matters/src/rules";
import {
  createAuth,
  authHandler,
  sessionMiddleware,
  createIdentityRouter,
} from "@weatherly/identity";
import {
  createMattersRouter,
  registerMatterChangeHook,
} from "@weatherly/matters";
import { createDotloopRouter, dotloopConfigured } from "@weatherly/dotloop";
import { createDocumentsRouter } from "@weatherly/documents";
import { createIntakeRouter } from "@weatherly/intake";
import { createOnboardingRouter, calendlyWebhook } from "@weatherly/onboarding";
const app = express();
configureNetworkBoundary(app);
app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin: process.env.WEB_ORIGIN || "http://127.0.0.1:3000",
    credentials: true,
  }),
);
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({ status: "unavailable", database: "unavailable" });
  }
});
const auth = createAuth({ sendSystemEmail });
registerAssistantMessages(listMessages);
registerMatterChangeHook(refreshTemplateDrafts);
app.post("/api/auth/sign-in/email", requestLimiter("sign-in", 5));
app.post(
  "/api/auth/request-password-reset",
  requestLimiter("password-reset", 3),
);
app.all("/api/auth/*splat", requestLimiter("auth", 60), authHandler(auth));
app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json", limit: "1mb" }),
  stripeWebhook,
);
// Calendly authenticates the exact bytes. Keep this ahead of JSON parsing and sessions.
app.post(
  "/api/webhooks/calendly",
  express.raw({ type: "application/json", limit: "1mb" }),
  calendlyWebhook,
);
app.use(express.json({ limit: "2mb" }));
app.get("/authorize", sessionMiddleware(auth), (req, res, next) => {
  if (!req.principal) {
    res.redirect(
      `${process.env.WEB_ORIGIN}/login?next=${encodeURIComponent(req.originalUrl)}`,
    );
    return;
  }
  next();
});
app.use(
  mcpAuthRouter({
    provider: new WeatherlyOAuth(),
    issuerUrl: new URL(process.env.WEB_ORIGIN || "http://127.0.0.1:3000"),
    resourceServerUrl: resourceUrl(),
    scopesSupported: ["weatherly:read"],
    resourceName: "Weatherly transaction records",
  }),
);
app.use("/api/mcp", requestLimiter("mcp", 240), createMcpRouter());
app.use("/api/v1", (req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.get("origin");
    if (
      (origin && origin !== process.env.WEB_ORIGIN) ||
      (!origin && req.get("cookie"))
    ) {
      return next(
        new HttpError(
          403,
          "ORIGIN_DENIED",
          "This request must originate from the Weatherly workspace.",
        ),
      );
    }
  }
  next();
});
app.use("/api/v1", sessionMiddleware(auth));
app.use("/api/v1", requestLimiter("api", 240));
app.use("/api/v1/ai", requestLimiter("ai", 10, { authenticatedOnly: true }));
app.use(
  "/api/v1/assistant",
  requestLimiter("assistant", 10, { authenticatedOnly: true }),
);
app.use("/api/v1/operations", createOperationsRouter());
app.use("/api/v1", createIdentityRouter(auth));
app.use("/api/v1/matters", createMattersRouter());
app.use("/api/v1/documents", createDocumentsRouter());
app.use("/api/v1/intakes", createIntakeRouter());
app.use("/api/v1/intake", createIntakeRouter());
app.use("/api/v1/onboarding", createOnboardingRouter());
app.use("/api/v1/billing", createBillingRouter());
app.use("/api/v1/ai", createAIRouter());
app.use("/api/v1/assistant", createAssistantRouter());
app.use("/api/v1/communications", createCommunicationsRouter());
app.use("/api/v1/workflows", createWorkflowsRouter());
app.use("/api/v1/dotloop", createDotloopRouter());
app.get(
  "/api/v1/integrations",
  asyncHandler(async (req, res) => {
    const actor = principal(req);
    assertCoordinator(actor);
    const connections = await prisma.integrationConnection.findMany({
      where: { ownerId: actor.id },
    });
    const gmail = await connectionStatus(actor);
    const configured: Record<string, boolean> = {
      gmail: gmail.configured,
      dotloop: dotloopConfigured(),
      stripe: billingConfigured(),
      openrouter: aiConfigured(),
      resend: Boolean(
        process.env.RESEND_API_KEY && process.env.SYSTEM_EMAIL_FROM,
      ),
    };
    res.json(
      Object.entries(configured).map(([provider, ready]) => {
        const connection = connections.find((c) => c.provider === provider);
        return {
          provider,
          status:
            connection?.status === "connected"
              ? "connected"
              : connection?.status === "error"
                ? "error"
                : ready
                  ? "configured"
                  : "not_configured",
          displayEmail: connection?.displayEmail || null,
          lastSyncedAt: connection?.lastSyncedAt || null,
        };
      }),
    );
  }),
);
app.use((_req, res) =>
  res.status(404).json({
    error: { code: "NOT_FOUND", message: "This endpoint does not exist." },
  }),
);
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof ZodError) {
      res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
      });
      return;
    }
    const code = error instanceof HttpError ? error.status : 500;
    if (code === 500)
      console.error("Request failed", {
        type: error instanceof Error ? error.name : "unknown",
      });
    res.status(code).json(sanitizeError(error));
  },
);
const port = Number(process.env.PORT || 4000);
const server = app.listen(
  port,
  process.env.NODE_ENV === "production" ? "::" : "127.0.0.1",
  () => console.log(`Weatherly API: http://127.0.0.1:${port}`),
);
process.on("SIGTERM", () =>
  server.close(() => {
    void prisma.$disconnect();
  }),
);
