import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { prisma } from "@weatherly/db";
import { HttpError, type Principal } from "@weatherly/platform";
import {
  PostgresLimitStore,
  configureNetworkBoundary,
  requestLimiter,
  trustedProxyAddresses,
} from "../../packages/platform/src/request-limits";
import {
  operationStatus,
  createOperationsRouter,
} from "../../packages/platform/src/operations";
import { createInquiry } from "../../packages/onboarding/src/index";
import {
  createAuth,
  createIdentityRouter,
} from "../../packages/identity/src/index";

const prefix = `launch-${randomUUID()}`;
const actor: Principal = {
  id: prefix,
  name: "Synthetic owner",
  email: `${prefix}@example.test`,
  role: "coordinator",
  sessionId: "synthetic",
};
const requestId = randomUUID();
afterAll(async () => {
  await prisma.requestLimit.deleteMany({
    where: { key: { startsWith: prefix } },
  });
  await prisma.inquiry.deleteMany({ where: { requestId } });
  await prisma.outboxJob.deleteMany({
    where: { idempotencyKey: { startsWith: prefix } },
  });
  await prisma.integrationConnection.deleteMany({ where: { ownerId: prefix } });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.$disconnect();
});
function errors(app: express.Express) {
  app.use(
    (
      error: HttpError,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) =>
      res
        .status(error.status || 500)
        .json({ error: { code: error.code || "INTERNAL_ERROR" } }),
  );
}
describe("launch platform boundaries", () => {
  it("counts concurrent requests atomically across independent API stores and resets expired windows", async () => {
    const first = new PostgresLimitStore(prefix + ":atomic");
    const second = new PostgresLimitStore(prefix + ":atomic");
    const hits = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 ? first : second).increment("shared"),
      ),
    );
    expect(hits.map((x) => x.totalHits).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    const rows = await prisma.requestLimit.findMany({
      where: { key: { startsWith: prefix + ":atomic" } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].key).not.toContain("shared");
    await prisma.requestLimit.update({
      where: { key: rows[0].key },
      data: { resetAt: new Date(0) },
    });
    expect((await second.increment("shared")).totalHits).toBe(1);
  });
  it("does not trust spoofed address headers, and separates authenticated users behind one proxy", async () => {
    for (const value of [
      "true",
      "1",
      "0.0.0.0/0",
      "::/0",
      "127.0.0.1/33",
      "127.0.0.1/bad",
    ])
      expect(() => trustedProxyAddresses(value)).toThrow();
    const app = express();
    configureNetworkBoundary(app, false);
    app.use((req, _res, next) => {
      const id = req.get("synthetic-user");
      if (id) req.principal = { ...actor, id };
      next();
    });
    app.use(requestLimiter(prefix + ":http", 2));
    app.get("/", (req, res) =>
      res.json({ ip: req.ip, authIp: req.headers["x-weatherly-client-ip"] }),
    );
    errors(app);
    const spoof = await request(app)
      .get("/")
      .set("X-Forwarded-For", "192.0.2.123")
      .set("X-Weatherly-Client-IP", "192.0.2.124");
    expect(spoof.status).toBe(200);
    expect(spoof.body.ip).not.toBe("192.0.2.123");
    expect(spoof.body.authIp).toBe(spoof.body.ip);
    await request(app).get("/").expect(200);
    await request(app)
      .get("/")
      .set("X-Forwarded-For", "192.0.2.125")
      .expect(429);
    for (const id of ["first", "second"]) {
      await request(app).get("/").set("synthetic-user", id).expect(200);
      await request(app).get("/").set("synthetic-user", id).expect(200);
      const blocked = await request(app)
        .get("/")
        .set("synthetic-user", id)
        .expect(429);
      expect(blocked.headers["retry-after"]).toBeDefined();
    }
    const trusted = express();
    configureNetworkBoundary(trusted, ["127.0.0.1", "::1"]);
    trusted.get("/", (req, res) => res.json({ ip: req.ip }));
    const chain = await request(trusted)
      .get("/")
      .set("X-Forwarded-For", "192.0.2.100, 198.51.100.10");
    expect(chain.body.ip).toBe("198.51.100.10");
  });
  it("returns one inquiry receipt under retries, rejects changed reuse and blocks the trap field", async () => {
    const input = {
      requestId,
      name: "Synthetic inquiry",
      email: "synthetic@example.test",
      kind: "contact",
      payload: { message: "Synthetic question" },
    };
    const results = await Promise.all([
      createInquiry(input),
      createInquiry(input),
      createInquiry(input),
    ]);
    expect(new Set(results.map((x) => x.id)).size).toBe(1);
    expect(Object.keys(results[0]).sort()).toEqual(["id", "status"]);
    expect(await prisma.inquiry.count({ where: { requestId } })).toBe(1);
    await expect(
      createInquiry({ ...input, name: "changed" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      createInquiry({
        ...input,
        requestId: randomUUID(),
        website: "spam.example",
      }),
    ).rejects.toBeDefined();
  });
  it("exposes queue failures only to the coordinator and never returns payloads or provider error text", async () => {
    await prisma.outboxJob.create({
      data: {
        idempotencyKey: prefix + ":failed",
        topic: "synthetic",
        state: "failed",
        payload: { token: "secret-payload" },
        error: "private@example.test secret-provider-response",
      },
    });
    await prisma.integrationConnection.create({
      data: {
        ownerId: prefix,
        provider: "gmail",
        status: "connected",
        credentials: "secret-token",
        lastSyncedAt: new Date(0),
      },
    });
    const status = await operationStatus(actor);
    expect(status.jobs.failed).toBeGreaterThan(0);
    expect(status.integrations.find((x) => x.provider === "gmail")?.stale).toBe(
      true,
    );
    expect(
      status.recentFailures.find((x) => x.topic === "synthetic")?.error,
    ).toBe("JOB_FAILED");
    expect(JSON.stringify(status)).not.toMatch(/secret-|private@example/);
    await expect(
      operationStatus({ ...actor, role: "agent" }),
    ).rejects.toMatchObject({ status: 403 });
    const app = express();
    app.use(createOperationsRouter());
    errors(app);
    await request(app).get("/").expect(401);
  });
  it("restricts user lookup and searches with stable cursor pagination", async () => {
    await prisma.user.createMany({
      data: [0, 1, 2].map((i) => ({
        id: prefix + "-" + i,
        name: prefix + "-lookup",
        email: prefix + "-" + i + "@example.test",
        role: "agent",
      })),
    });
    const app = express();
    app.use((req, _res, next) => {
      if (req.get("synthetic-role"))
        req.principal = {
          ...actor,
          role: req.get("synthetic-role") as Principal["role"],
        };
      next();
    });
    app.use(createIdentityRouter(createAuth()));
    errors(app);
    await request(app).get("/users").expect(401);
    await request(app).get("/users").set("synthetic-role", "agent").expect(403);
    const first = await request(app)
      .get("/users")
      .query({ q: prefix.toUpperCase(), limit: 2 })
      .set("synthetic-role", "coordinator")
      .expect(200);
    const second = await request(app)
      .get("/users")
      .query({ q: prefix, limit: 2, cursor: first.body[1].id })
      .set("synthetic-role", "coordinator")
      .expect(200);
    expect(first.body.map((x: { id: string }) => x.id)).toEqual([
      prefix + "-0",
      prefix + "-1",
    ]);
    expect(second.body.map((x: { id: string }) => x.id)).toEqual([
      prefix + "-2",
    ]);
    expect(first.body[0]).not.toHaveProperty("password");
  });
});
