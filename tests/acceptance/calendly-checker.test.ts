import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@weatherly/db";
import {
  processCalendlyDelivery,
  schedulingConfig,
  verifyCalendlySignature,
  calendlyWebhook,
} from "../../packages/onboarding/src/calendly";
import {
  createInquiry,
  createOnboardingRouter,
} from "../../packages/onboarding/src/index";
import express from "express";
import request from "supertest";
import { HttpError, hashToken, type Principal } from "@weatherly/platform";
import { createMcpRouter } from "../../packages/assistant/src/mcp";
import { queryStoredRecords } from "../../packages/assistant/src/records";

const prefix = `checker-${randomUUID()}`;
const key = `${prefix}-synthetic-key`;
const typeUri = `https://api.calendly.com/event_types/${prefix}`;
const baseTime = Date.now();
const envNames = [
  "CALENDLY_EVENT_URL",
  "CALENDLY_WEBHOOK_SIGNING_KEY",
  "CALENDLY_EVENT_TYPE_URI",
] as const;
const oldEnv = Object.fromEntries(envNames.map((k) => [k, process.env[k]]));
const requestId = randomUUID();
const eventUri = (id: string) =>
  `https://api.calendly.com/scheduled_events/${prefix}-${id}`;
const inviteeUri = (id: string) => `${eventUri(id)}/invitees/${prefix}-${id}`;
function signature(raw: Buffer, seconds = Math.floor(Date.now() / 1000)) {
  return `t=${seconds},v1=${createHmac("sha256", key).update(`${seconds}.`).update(raw).digest("hex")}`;
}
function fixture(
  id: string,
  status: "active" | "canceled" = "active",
  offset = 0,
  extra = {},
) {
  const at = new Date(baseTime + offset).toISOString();
  return {
    event: status === "active" ? "invitee.created" : "invitee.canceled",
    created_at: at,
    payload: {
      uri: inviteeUri(id),
      event: eventUri(id),
      name: "Synthetic checker",
      email: `${prefix}@example.test`,
      timezone: "America/New_York",
      status,
      created_at: at,
      updated_at: at,
      scheduled_event: {
        uri: eventUri(id),
        event_type: typeUri,
        start_time: "2030-01-01T15:00:00Z",
        end_time: "2030-01-01T15:30:00Z",
      },
      ...extra,
    },
  };
}
async function deliver(value: unknown) {
  const raw = Buffer.from(JSON.stringify(value));
  return processCalendlyDelivery(raw, signature(raw));
}
beforeAll(() => {
  process.env.CALENDLY_EVENT_URL =
    "https://calendly.com/synthetic-checker/onboarding";
  process.env.CALENDLY_WEBHOOK_SIGNING_KEY = key;
  process.env.CALENDLY_EVENT_TYPE_URI = typeUri;
});
afterAll(async () => {
  await prisma.schedulingDelivery.deleteMany({
    where: { inviteeUri: { contains: prefix } },
  });
  await prisma.schedulingBooking.deleteMany({
    where: { inviteeUri: { contains: prefix } },
  });
  await prisma.inquiry.deleteMany({ where: { requestId } });
  for (const k of envNames) {
    if (oldEnv[k] === undefined) delete process.env[k];
    else process.env[k] = oldEnv[k];
  }
});
describe("independent Calendly security and persistence checks", () => {
  it("authenticates exact raw bytes, accepts rotation v1 values, rejects malformed/stale/future timestamps", () => {
    const raw = Buffer.from('{"synthetic": true}');
    const now = Date.now();
    const valid = signature(raw, Math.floor(now / 1000));
    expect(verifyCalendlySignature(raw, valid, key, now)).toBe(true);
    expect(
      verifyCalendlySignature(raw, `${valid},v1=${"0".repeat(64)}`, key, now),
    ).toBe(true);
    expect(
      verifyCalendlySignature(
        Buffer.from('{"synthetic":true}'),
        valid,
        key,
        now,
      ),
    ).toBe(false);
    for (const offset of [-181, 181])
      expect(
        verifyCalendlySignature(
          raw,
          signature(raw, Math.floor(now / 1000) + offset),
          key,
          now,
        ),
      ).toBe(false);
    for (const invalid of [
      undefined,
      "",
      "t=NaN,v1=abc",
      `${valid},t=1`,
      "t=999999999999999999999,v1=abc",
    ])
      expect(verifyCalendlySignature(raw, invalid, key, now)).toBe(false);
  });
  it("fails closed for lookalike or credential-bearing event URLs", () => {
    for (const url of [
      "http://calendly.com/user/meeting",
      "https://calendly.com.evil.test/user/meeting",
      "https://x@calendly.com/user/meeting",
      "https://calendly.com/user/meeting?token=private",
      "https://calendly.com/user/meeting#x",
    ]) {
      expect(
        schedulingConfig({ ...process.env, CALENDLY_EVENT_URL: url })
          .configured,
      ).toBe(false);
    }
  });
  it("persists a signed booking once and preserves existing inquiry data", async () => {
    await createInquiry({
      requestId,
      name: "Synthetic inquiry",
      email: `${prefix}@example.test`,
      kind: "information",
      payload: { message: "Keep this unchanged" },
    });
    const before = await prisma.inquiry.findUniqueOrThrow({
      where: { requestId },
    });
    const value = fixture("duplicate");
    expect((await deliver(value)).duplicate).toBe(false);
    expect((await deliver(value)).duplicate).toBe(true);
    const booking = await prisma.schedulingBooking.findUniqueOrThrow({
      where: { inviteeUri: inviteeUri("duplicate") },
    });
    expect(booking.status).toBe("confirmed");
    expect(booking.provenance).toBe("calendly_signed_webhook");
    expect(
      await prisma.schedulingDelivery.count({
        where: { inviteeUri: booking.inviteeUri },
      }),
    ).toBe(1);
    expect(
      await prisma.inquiry.findUniqueOrThrow({ where: { requestId } }),
    ).toEqual(before);
  });
  it("rejects forged signatures and signed deliveries for another event type before persistence", async () => {
    const forged = Buffer.from(JSON.stringify(fixture("forged")));
    await expect(
      processCalendlyDelivery(
        forged,
        signature(forged).replace(/v1=./, "v1=z"),
      ),
    ).rejects.toMatchObject({ status: 401 });
    const wrong = fixture("scope");
    wrong.payload.scheduled_event.event_type =
      "https://api.calendly.com/event_types/other-synthetic";
    await expect(deliver(wrong)).rejects.toMatchObject({ status: 403 });
    expect(
      await prisma.schedulingBooking.count({
        where: {
          inviteeUri: { in: [inviteeUri("scope"), inviteeUri("forged")] },
        },
      }),
    ).toBe(0);
  });
  it("keeps cancellation terminal across late and newer active deliveries", async () => {
    await deliver(fixture("cancel", "canceled", 1000));
    await deliver(fixture("cancel", "active", 0));
    await deliver(fixture("cancel", "active", 2000));
    expect(
      (
        await prisma.schedulingBooking.findUniqueOrThrow({
          where: { inviteeUri: inviteeUri("cancel") },
        })
      ).status,
    ).toBe("canceled");
  });
  it.each([false, true])(
    "reconciles linked reschedule when replacement arrives first=%s",
    async (replacementFirst) => {
      const old = `old-${replacementFirst}`;
      const next = `new-${replacementFirst}`;
      const created = fixture(next, "active", 2000, {
        old_invitee: inviteeUri(old),
      });
      const canceled = fixture(old, "canceled", 1000, {
        rescheduled: true,
        new_invitee: inviteeUri(next),
      });
      if (replacementFirst) {
        await deliver(created);
        await deliver(fixture(old));
        await deliver(canceled);
      } else {
        await deliver(fixture(old));
        await deliver(canceled);
        await deliver(created);
      }
      expect(
        (
          await prisma.schedulingBooking.findUniqueOrThrow({
            where: { inviteeUri: inviteeUri(old) },
          })
        ).status,
      ).toBe("rescheduled");
      expect(
        (
          await prisma.schedulingBooking.findUniqueOrThrow({
            where: { inviteeUri: inviteeUri(next) },
          })
        ).status,
      ).toBe("confirmed");
    },
  );
  it("limits durable API and assistant record access to coordinators", async () => {
    await deliver(fixture("access"));
    const row = await prisma.schedulingBooking.findUniqueOrThrow({
      where: { inviteeUri: inviteeUri("access") },
    });
    const actor: Principal = {
      id: prefix,
      email: `${prefix}@example.test`,
      name: "Synthetic coordinator",
      role: "coordinator",
      sessionId: prefix,
    };
    function app(role?: Principal["role"]) {
      const a = express();
      a.use((req, _res, next) => {
        if (role) req.principal = { ...actor, role };
        next();
      });
      a.use("/api/v1/onboarding", createOnboardingRouter());
      a.use(
        (
          error: HttpError,
          _req: express.Request,
          res: express.Response,
          _next: express.NextFunction,
        ) =>
          res.status(error.status || 500).json({ error: { code: error.code } }),
      );
      return a;
    }
    for (const suffix of ["", `/${row.id}`]) {
      expect(
        (await request(app()).get(`/api/v1/onboarding/bookings${suffix}`))
          .status,
      ).toBe(401);
      expect(
        (
          await request(app("agent")).get(
            `/api/v1/onboarding/bookings${suffix}`,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app("client")).get(
            `/api/v1/onboarding/bookings${suffix}`,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app("coordinator")).get(
            `/api/v1/onboarding/bookings${suffix}`,
          )
        ).status,
      ).toBe(200);
    }
    const result = await queryStoredRecords(actor, {
      kind: "scheduling_bookings",
      limit: 100,
    });
    expect(JSON.stringify(result)).toContain(row.id);
    for (const role of ["agent", "client"] as const)
      await expect(
        queryStoredRecords({ ...actor, role }, { kind: "scheduling_bookings" }),
      ).rejects.toMatchObject({ status: 403 });
  });
  it("verifies exact raw bytes over HTTP before JSON parsing and refuses browser booking writes", async () => {
    const app = express();
    app.post(
      "/api/webhooks/calendly",
      express.raw({ type: "application/json" }),
      calendlyWebhook,
    );
    app.use(express.json());
    app.use("/api/v1/onboarding", createOnboardingRouter());
    app.use(
      (
        error: HttpError,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) =>
        res.status(error.status || 500).json({ error: { code: error.code } }),
    );
    const compact = Buffer.from(JSON.stringify(fixture("http")));
    const spaced = Buffer.from(JSON.stringify(fixture("http"), null, 2));
    expect(
      (
        await request(app)
          .post("/api/webhooks/calendly")
          .set("Content-Type", "application/json")
          .set("Calendly-Webhook-Signature", signature(compact))
          .send(spaced.toString())
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/webhooks/calendly")
          .set("Content-Type", "application/json")
          .set("Calendly-Webhook-Signature", signature(spaced))
          .send(spaced.toString())
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/v1/onboarding/bookings")
          .send({
            event: "calendly.event_scheduled",
            payload: fixture("browser").payload,
          })
      ).status,
    ).toBe(404);
    expect(
      await prisma.schedulingBooking.count({
        where: { inviteeUri: inviteeUri("browser") },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.schedulingBooking.findUniqueOrThrow({
          where: { inviteeUri: inviteeUri("http") },
        })
      ).status,
    ).toBe("confirmed");
  });
  it("returns durable scheduling records through authenticated MCP and denies revoked grants", async () => {
    const saved = {
      enabled: process.env.MCP_ENABLED,
      manifest: process.env.MCP_APPROVED_CLIENTS_JSON,
    };
    const token = `${prefix}-mcp-token`;
    const evidence = `${prefix} synthetic isolated acceptance fixture only; no real deployment approval.`;
    const redirectUris = ["https://synthetic-checker.example.test/callback"];
    try {
      process.env.MCP_ENABLED = "true";
      process.env.MCP_APPROVED_CLIENTS_JSON = JSON.stringify([
        { id: prefix, redirectUris, evidenceHash: hashToken(evidence) },
      ]);
      await prisma.user.create({
        data: {
          id: prefix,
          name: "Synthetic MCP coordinator",
          email: `${prefix}@example.test`,
          role: "coordinator",
          twoFactorEnabled: true,
        },
      });
      await prisma.assistantClient.create({
        data: {
          id: prefix,
          name: "Synthetic acceptance client",
          approved: true,
          complianceEvidence: evidence,
          approvedById: prefix,
          redirectUris,
        },
      });
      const grant = await prisma.assistantGrant.create({
        data: {
          userId: prefix,
          name: "Synthetic read grant",
          tokenHash: hashToken(token),
          scopes: ["weatherly:read"],
          approvedClient: true,
          complianceEvidence: evidence,
          clientId: prefix,
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      await deliver(fixture("mcp"));
      const booking = await prisma.schedulingBooking.findUniqueOrThrow({
        where: { inviteeUri: inviteeUri("mcp") },
      });
      const app = express();
      app.use(express.json());
      app.use("/api/mcp", createMcpRouter());
      app.use(
        (
          error: HttpError,
          _req: express.Request,
          res: express.Response,
          _next: express.NextFunction,
        ) =>
          res.status(error.status || 500).json({ error: { code: error.code } }),
      );
      const call = () =>
        request(app)
          .post("/api/mcp")
          .set("Authorization", `Bearer ${token}`)
          .set("Accept", "application/json, text/event-stream")
          .send({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "query_records",
              arguments: { kind: "scheduling_bookings", limit: 100 },
            },
          });
      const response = await call();
      expect(response.status).toBe(200);
      expect(response.body.result.isError).not.toBe(true);
      const records = JSON.parse(response.body.result.content[0].text);
      expect(JSON.stringify(records)).toContain(booking.id);
      expect(JSON.stringify(records)).not.toContain(key);
      await prisma.assistantGrant.update({
        where: { id: grant.id },
        data: { revokedAt: new Date() },
      });
      const revoked = await call();
      expect(revoked.status).toBe(401);
      expect(revoked.body.error.code).toBe("INVALID_TOKEN");
      expect(JSON.stringify(revoked.body)).not.toContain(booking.id);
    } finally {
      await prisma.auditEvent.deleteMany({ where: { actorId: prefix } });
      await prisma.assistantGrant.deleteMany({ where: { userId: prefix } });
      await prisma.assistantClient.deleteMany({ where: { id: prefix } });
      await prisma.user.deleteMany({ where: { id: prefix } });
      if (saved.enabled === undefined) delete process.env.MCP_ENABLED;
      else process.env.MCP_ENABLED = saved.enabled;
      if (saved.manifest === undefined)
        delete process.env.MCP_APPROVED_CLIENTS_JSON;
      else process.env.MCP_APPROVED_CLIENTS_JSON = saved.manifest;
    }
  });
});
