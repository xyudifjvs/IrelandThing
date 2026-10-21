import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { ZodError } from "zod";
import { prisma } from "@weatherly/db";
import { HttpError, sanitizeError } from "@weatherly/platform";
import {
  createAuth,
  authHandler,
  sessionMiddleware,
  createIdentityRouter,
} from "@weatherly/identity";
import { createMattersRouter } from "@weatherly/matters";
import { createDocumentsRouter } from "@weatherly/documents";
import { createIntakeRouter } from "@weatherly/intake";
import { createOnboardingRouter } from "@weatherly/onboarding";
const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin: process.env.WEB_ORIGIN || "http://127.0.0.1:3000",
    credentials: true,
  }),
);
app.use(
  rateLimit({
    windowMs: 60000,
    limit: 240,
    standardHeaders: true,
    legacyHeaders: false,
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
const auth = createAuth();
app.all("/api/auth/*splat", authHandler(auth));
app.use(express.json({ limit: "2mb" }));
app.use("/api/v1", sessionMiddleware(auth));
app.use("/api/v1", createIdentityRouter(auth));
app.use("/api/v1/matters", createMattersRouter());
app.use("/api/v1/documents", createDocumentsRouter());
app.use("/api/v1/intakes", createIntakeRouter());
app.use("/api/v1/onboarding", createOnboardingRouter());
app.use((_req, res) =>
  res
    .status(404)
    .json({
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
      res
        .status(422)
        .json({
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
  process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1",
  () => console.log(`Weatherly API: http://127.0.0.1:${port}`),
);
process.on("SIGTERM", () =>
  server.close(() => {
    void prisma.$disconnect();
  }),
);
