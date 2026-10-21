import { isIP } from "node:net";
import { createHash } from "node:crypto";
import {
  rateLimit,
  ipKeyGenerator,
  type Store,
  type Options,
} from "express-rate-limit";
import type { Express, RequestHandler } from "express";
import { prisma } from "@weatherly/db";

/** Never trust a hop count or a client-supplied header without a trusted socket peer. */
export function trustedProxyAddresses(
  value = process.env.TRUSTED_PROXY_CIDRS || "",
) {
  if (!value.trim()) return false;
  return value.split(",").map((part) => {
    const entry = part.trim();
    const [address, prefix, extra] = entry.split("/");
    const family = isIP(address);
    if (
      !family ||
      extra !== undefined ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) ||
          Number(prefix) < (family === 4 ? 8 : 32) ||
          Number(prefix) > (family === 4 ? 32 : 128)))
    ) {
      throw new Error(
        "TRUSTED_PROXY_CIDRS must contain explicit proxy IPs or bounded CIDRs; broad trust and hop counts are forbidden.",
      );
    }
    return entry;
  });
}

export function configureNetworkBoundary(
  app: Express,
  proxies = trustedProxyAddresses(),
) {
  app.set("trust proxy", proxies);
  app.use((req, _res, next) => {
    // Better Auth sees only Express's verified address, never an incoming private header.
    delete req.headers["x-weatherly-client-ip"];
    if (req.ip) req.headers["x-weatherly-client-ip"] = req.ip;
    next();
  });
}

export class PostgresLimitStore implements Store {
  localKeys = false;
  windowMs = 60000;
  constructor(public prefix: string) {}
  init(options: Options) {
    this.windowMs = options.windowMs;
  }
  private key(value: string) {
    return this.prefix + ":" + createHash("sha256").update(value).digest("hex");
  }
  async increment(value: string) {
    const key = this.key(value);
    const now = new Date();
    const reset = new Date(now.valueOf() + this.windowMs);
    const [row] = await prisma.$queryRaw<{ hits: number; resetAt: Date }[]>`
      INSERT INTO "RequestLimit" (key, hits, "resetAt") VALUES (${key}, 1, ${reset})
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN "RequestLimit"."resetAt" <= ${now} THEN 1 ELSE LEAST("RequestLimit".hits + 1, 2147483646) END,
        "resetAt" = CASE WHEN "RequestLimit"."resetAt" <= ${now} THEN ${reset} ELSE "RequestLimit"."resetAt" END
      RETURNING hits, "resetAt"`;
    return { totalHits: row.hits, resetTime: row.resetAt };
  }
  async decrement(value: string) {
    await prisma.$executeRaw`UPDATE "RequestLimit" SET hits=GREATEST(hits-1,0) WHERE key=${this.key(value)} AND "resetAt">${new Date()}`;
  }
  async resetKey(value: string) {
    await prisma.requestLimit.deleteMany({ where: { key: this.key(value) } });
  }
}

export function requestLimiter(
  scope: string,
  limit: number,
  options: { windowMs?: number; authenticatedOnly?: boolean } = {},
): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs || 60000,
    limit,
    store: new PostgresLimitStore(scope),
    keyGenerator: (req) =>
      req.principal
        ? `user:${req.principal.id}`
        : `ip:${ipKeyGenerator(req.ip || "127.0.0.1")}`,
    skip: (req) => Boolean(options.authenticatedOnly && !req.principal),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Wait a moment and try again.",
      },
    },
  });
}
