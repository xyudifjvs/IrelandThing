import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { prisma } from "@weatherly/db";
import {
  authHandler,
  createAuth,
  createIdentityRouter,
  getAgentMembership,
  sessionMiddleware,
} from "@weatherly/identity";
import type { Principal } from "@weatherly/platform";
import { createInquiry, createOnboardingRouter } from "../src";
import { processCalendlyDelivery } from "../src/calendly";

const key = randomUUID();
const password = "Synthetic-Roster-2026!";
const email = (label: string) => `c08-${label}-${key}@example.test`;
const owner: Principal = {
  id: `coordinator-${key}`,
  email: email("owner"),
  name: "Synthetic coordinator",
  role: "coordinator",
  sessionId: "fixture",
};
const rows: { rosterId?: string; fileId?: string; documentId?: string } = {};
const queue: { id: string; email: string }[] = [];
const coordinator = express();
const authenticated = express();

function errors(
  error: Error & { status?: number; code?: string },
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) {
  res
    .status(error.status || 400)
    .json({ code: error.code, message: error.message });
}

beforeAll(async () => {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-identity-roster-secret-only");
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:4000");
  vi.stubEnv("WEB_ORIGIN", "http://localhost:3000");
  const auth = createAuth();
  await prisma.user.create({
    data: {
      id: owner.id,
      name: owner.name,
      email: owner.email,
      role: owner.role,
    },
  });
  coordinator.use(express.json());
  coordinator.use((req, _res, next) => {
    req.principal = owner;
    next();
  });
  coordinator.use("/onboarding", createOnboardingRouter());
  coordinator.use(
    "/identity",
    createIdentityRouter(auth, {
      queueAgentInvitation: async (_tx, invite) => {
        queue.push({ id: invite.id, email: invite.email });
        return true;
      },
    }),
  );
  coordinator.use(errors);
  authenticated.all("/api/auth/*splat", authHandler(auth));
  authenticated.use(express.json());
  authenticated.use(sessionMiddleware(auth));
  authenticated.get("/api/v1/private", (_req, res) => res.json({ ok: true }));
  authenticated.use("/api/v1/onboarding", createOnboardingRouter());
  authenticated.use("/api/v1", createIdentityRouter(auth));
  authenticated.use(errors);
});

afterAll(async () => {
  await prisma.schedulingDelivery.deleteMany({
    where: { inviteeUri: { contains: key } },
  });
  await prisma.schedulingBooking.deleteMany({
    where: { email: email("lead") },
  });
  await prisma.inquiry.deleteMany({ where: { email: email("lead") } });
  await prisma.invitation.deleteMany({ where: { invitedById: owner.id } });
  if (rows.fileId)
    await prisma.matter.deleteMany({ where: { id: rows.fileId } });
  if (rows.documentId)
    await prisma.document.deleteMany({ where: { id: rows.documentId } });
  await prisma.agreement.deleteMany({ where: { userId: email("weatherly") } });
  await prisma.auditEvent.deleteMany({ where: { actorId: owner.id } });
  await prisma.rosterAgent.deleteMany({
    where: {
      OR: [{ email: { contains: key } }, { id: rows.rosterId ?? "none" }],
    },
  });
  await prisma.user.deleteMany({ where: { email: { contains: key } } });
  vi.unstubAllEnvs();
});

it("binds only the invited HTO account, preserves file business, and keeps the Weatherly agreement gate", async () => {
  const agentEmail = email("hto");
  const created = await request(coordinator)
    .post("/onboarding/roster")
    .send({
      name: "Synthetic HTO",
      email: agentEmail,
      business: "hto",
    })
    .expect(201);
  rows.rosterId = created.body.id;
  const invitation = {
    email: agentEmail,
    role: "agent",
    rosterAgentId: created.body.id,
  };
  await request(coordinator)
    .post("/identity/invitations")
    .send({ ...invitation, email: email("forged") })
    .expect(422);
  const first = await request(coordinator)
    .post("/identity/invitations")
    .send(invitation)
    .expect(201);
  const second = await request(coordinator)
    .post("/identity/invitations")
    .send(invitation)
    .expect(201);
  expect(second.body.delivery).toBe("queued");
  expect(queue.map((event) => event.email)).toEqual([agentEmail, agentEmail]);
  const accept = (token: string) =>
    request(coordinator).post("/identity/invitations/register").send({
      token,
      name: "Synthetic HTO",
      password,
    });
  await accept(first.body.acceptanceToken).expect(400);
  const claims = await Promise.all([
    accept(second.body.acceptanceToken),
    accept(second.body.acceptanceToken),
  ]);
  expect(claims.map((response) => response.status).sort()).toEqual([201, 400]);
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: agentEmail },
  });
  expect(await getAgentMembership(user.id)).toEqual({
    business: "hto",
    rosterAgentId: created.body.id,
  });
  expect(await prisma.account.count({ where: { userId: user.id } })).toBe(1);

  const signedIn = await request(authenticated)
    .post("/api/auth/sign-in/email")
    .send({ email: agentEmail, password })
    .expect(200);
  const cookie = signedIn.headers["set-cookie"];
  const metadata = await request(authenticated)
    .get("/api/v1/session")
    .set("Cookie", cookie)
    .expect(200);
  expect(metadata.body.user.business).toBe("hto");
  expect(metadata.body.user.twoFactorEnabled).toBe(false);
  await request(authenticated)
    .get("/api/v1/private")
    .set("Cookie", cookie)
    .expect(200);
  await request(authenticated)
    .get("/api/v1/onboarding/roster")
    .set("Cookie", cookie)
    .expect(403);
  await request(authenticated)
    .get("/api/v1/onboarding/agreements")
    .set("Cookie", cookie)
    .expect(403);
  await request(authenticated)
    .patch("/api/v1/profile")
    .set("Cookie", cookie)
    .send({ phone: "555-0101" })
    .expect(200);
  const agent = await prisma.rosterAgent.findUniqueOrThrow({
    where: { id: created.body.id },
  });
  expect(agent.phone).toBe("555-0101");
  const roster = await request(coordinator)
    .get(`/onboarding/roster/${agent.id}`)
    .expect(200);
  expect(roster.body.phase).toBe("active");
  const file = await prisma.matter.create({
    data: {
      title: "Synthetic file",
      propertyAddress: "12 Synthetic Way",
      side: "buyer",
      packageCode: "hto_included",
      business: "hto",
      agentId: user.id,
      agentRosterId: agent.id,
    },
  });
  rows.fileId = file.id;
  await request(coordinator)
    .patch(`/onboarding/roster/${agent.id}`)
    .send({
      expectedRevision: agent.revision,
      business: "weatherly",
    })
    .expect(200);
  expect(await getAgentMembership(user.id)).toEqual({
    business: "weatherly",
    rosterAgentId: agent.id,
  });
  expect(
    (await prisma.matter.findUniqueOrThrow({ where: { id: file.id } }))
      .business,
  ).toBe("hto");
  await request(authenticated)
    .get("/api/v1/private")
    .set("Cookie", cookie)
    .expect(403);
});

it("preserves distinct website and verified booking events under one email roster", async () => {
  const lead = email("lead");
  const signups = await Promise.all(
    ["Original inquiry", "Follow-up inquiry"].map((message) =>
      createInquiry({
        requestId: randomUUID(),
        name: "Synthetic lead",
        email: lead.toUpperCase(),
        kind: "contact",
        payload: { message },
      }),
    ),
  );
  const records = await prisma.inquiry.findMany({
    where: { id: { in: signups.map(({ id }) => id) } },
  });
  expect(records).toHaveLength(2);
  expect(new Set(records.map(({ rosterAgentId }) => rosterAgentId)).size).toBe(
    1,
  );
  expect(records[0].rosterAgentId).toBeTruthy();

  const type = `https://api.calendly.com/event_types/${key}`;
  const event = `https://api.calendly.com/scheduled_events/${key}`;
  const secret = "synthetic-calendly-fixture";
  vi.stubEnv(
    "CALENDLY_EVENT_URL",
    "https://calendly.com/synthetic/consultation",
  );
  vi.stubEnv("CALENDLY_EVENT_TYPE_URI", type);
  vi.stubEnv("CALENDLY_WEBHOOK_SIGNING_KEY", secret);
  const now = new Date();
  const payload = Buffer.from(
    JSON.stringify({
      event: "invitee.created",
      created_at: now.toISOString(),
      payload: {
        uri: event + "/invitees/" + key,
        event,
        name: "Verified lead",
        email: lead,
        status: "active",
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        scheduled_event: {
          uri: event,
          event_type: type,
          start_time: now.toISOString(),
          end_time: new Date(now.getTime() + 1800000).toISOString(),
        },
      },
    }),
  );
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret)
    .update(timestamp + ".")
    .update(payload)
    .digest("hex");
  const header = `t=${timestamp},v1=${signature}`;
  expect(await processCalendlyDelivery(payload, header)).toMatchObject({
    applied: true,
  });
  expect(await processCalendlyDelivery(payload, header)).toEqual({
    duplicate: true,
  });
  const booking = await prisma.schedulingBooking.findUniqueOrThrow({
    where: { inviteeUri: event + "/invitees/" + key },
  });
  expect(booking.rosterAgentId).toBe(records[0].rosterAgentId);
});

it("records actual signed versions and prevents archiving an agreement-bearing signup", async () => {
  const roster = await request(coordinator)
    .post("/onboarding/roster")
    .send({
      name: "Synthetic Weatherly",
      email: email("weatherly"),
      business: "weatherly",
    })
    .expect(201);
  const invite = {
    email: email("weatherly"),
    role: "agent",
    rosterAgentId: roster.body.id,
  };
  await request(coordinator)
    .post("/identity/invitations")
    .send(invite)
    .expect(422);
  const sent = await request(coordinator)
    .post(`/onboarding/roster/${roster.body.id}/agreement-sent`)
    .send({ expectedRevision: roster.body.revision, sentOn: "2026-11-01" })
    .expect(200);
  const agreementDocument = await prisma.document.create({
    data: {
      name: "Synthetic agreement.pdf",
      mimeType: "application/pdf",
      visibility: "coordinator",
      category: "service_agreement",
      createdById: owner.id,
    },
  });
  rows.documentId = agreementDocument.id;
  const evidence = {
    rosterAgentId: roster.body.id,
    userId: invite.email,
    version: "2026-01",
    status: "approved",
    documentId: agreementDocument.id,
    signedOn: "2026-11-02",
    agreementRequestId: randomUUID(),
  };
  const recorded = await request(coordinator)
    .post("/onboarding/agreements")
    .send(evidence)
    .expect(201);
  const replayed = await request(coordinator)
    .post("/onboarding/agreements")
    .send(evidence)
    .expect(201);
  expect(replayed.body.id).toBe(recorded.body.id);
  const detail = await request(coordinator)
    .get(`/onboarding/roster/${roster.body.id}`)
    .expect(200);
  expect(detail.body).toMatchObject({
    phase: "agreement_signed",
    phaseOn: "2026-11-02",
  });
  await request(coordinator)
    .post(`/onboarding/roster/${roster.body.id}/archive`)
    .send({ expectedRevision: sent.body.revision })
    .expect(409);
  await request(coordinator)
    .post("/identity/invitations")
    .send(invite)
    .expect(201);
});
