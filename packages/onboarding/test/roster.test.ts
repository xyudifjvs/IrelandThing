import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
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
const rows: { rosterId?: string; fileIds: string[] } = { fileIds: [] };
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
      emailVerified: true,
    },
  });
  await prisma.account.create({
    data: {
      id: randomUUID(),
      accountId: owner.id,
      userId: owner.id,
      providerId: "credential",
      password: await hashPassword(password),
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
  await prisma.inquiry.deleteMany({ where: { email: { contains: key } } });
  await prisma.invitation.deleteMany({ where: { invitedById: owner.id } });
  await prisma.matter.deleteMany({ where: { id: { in: rows.fileIds } } });
  const documents = await prisma.document.findMany({
    where: { createdById: owner.id },
    select: { id: true },
  });
  await prisma.agreement.deleteMany({
    where: { documentId: { in: documents.map(({ id }) => id) } },
  });
  await prisma.document.deleteMany({ where: { createdById: owner.id } });
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
  rows.fileIds.push(file.id);
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

async function legacyAgreement(userId: string) {
  const document = await prisma.document.create({
    data: {
      name: "Synthetic legacy evidence.pdf",
      mimeType: "application/pdf",
      category: "service_agreement",
      visibility: "coordinator",
      createdById: owner.id,
    },
  });
  return (
    await request(coordinator)
      .post("/onboarding/agreements")
      .send({
        userId,
        documentId: document.id,
        version: "legacy-1",
        status: "approved",
      })
      .expect(201)
  ).body;
}

it("rejects archive after an unlinked legacy account or prior inquiry has advanced", async () => {
  const legacyEmail = email("existing-agent");
  const userId = randomUUID();
  await prisma.user.create({
    data: {
      id: userId,
      name: "Existing Synthetic Agent",
      email: legacyEmail,
      role: "agent",
      emailVerified: true,
    },
  });
  await prisma.account.create({
    data: {
      id: randomUUID(),
      userId,
      providerId: "credential",
      accountId: userId,
      password: await hashPassword(password),
    },
  });
  await legacyAgreement(userId);
  const source = await createInquiry({
    email: legacyEmail.toUpperCase(),
    name: "Existing Synthetic Agent",
    kind: "contact",
    payload: {},
  });
  const receipt = await prisma.inquiry.findUniqueOrThrow({
    where: { id: source.id },
  });
  const row = await prisma.rosterAgent.findUniqueOrThrow({
    where: { id: receipt.rosterAgentId! },
  });
  expect(row.userId).toBeNull();
  const detail = await request(coordinator)
    .get(`/onboarding/roster/${row.id}`)
    .expect(200);
  expect(detail.body).toMatchObject({
    phase: "active",
    hasAccount: true,
    canArchive: false,
  });
  const denied = await request(coordinator)
    .post(`/onboarding/roster/${row.id}/archive`)
    .send({ expectedRevision: row.revision })
    .expect(409);
  expect(denied.body.code).toBe("INQUIRY_ARCHIVE_ONLY");
  expect(
    (await prisma.rosterAgent.findUniqueOrThrow({ where: { id: row.id } }))
      .archivedAt,
  ).toBeNull();
  const session = await request(authenticated)
    .post("/api/auth/sign-in/email")
    .send({ email: legacyEmail, password })
    .expect(200);
  await request(authenticated)
    .get("/api/v1/private")
    .set("Cookie", session.headers["set-cookie"])
    .expect(200);

  const legacySent = await createInquiry({
    email: email("legacy-sent"),
    name: "Sent Synthetic Agent",
    kind: "contact",
    payload: {},
  });
  const sentReceipt = await prisma.inquiry.findUniqueOrThrow({
    where: { id: legacySent.id },
  });
  const sentRow = await prisma.rosterAgent.findUniqueOrThrow({
    where: { id: sentReceipt.rosterAgentId! },
  });
  await request(coordinator)
    .patch(`/onboarding/inquiries/${sentReceipt.id}`)
    .send({ expectedRevision: sentReceipt.revision, status: "agreement_sent" })
    .expect(200);
  const sentDetail = await request(coordinator)
    .get(`/onboarding/roster/${sentRow.id}`)
    .expect(200);
  expect(sentDetail.body).toMatchObject({
    phase: "agreement_sent",
    canArchive: false,
  });
  await request(coordinator)
    .post(`/onboarding/roster/${sentRow.id}/archive`)
    .send({ expectedRevision: sentRow.revision })
    .expect(409);
});

it("materializes and invites a signed-agreement-only legacy signup without changing its evidence", async () => {
  const recipient = email("agreement-only");
  const agreement = await legacyAgreement(recipient.toUpperCase());
  const roster = await request(coordinator)
    .get("/onboarding/roster")
    .expect(200);
  const entry = roster.body.find(
    (row: { email: string }) => row.email === recipient,
  );
  expect(entry).toMatchObject({
    phase: "agreement_signed",
    canArchive: false,
    source: { kind: "agreement", id: agreement.id },
  });
  const detail = await request(coordinator)
    .get(`/onboarding/roster/${entry.id}`)
    .expect(200);
  expect(detail.body.agreementHistory[0]).toMatchObject({
    id: agreement.id,
    documentId: agreement.documentId,
  });
  const imported = await request(coordinator)
    .post("/onboarding/roster/import")
    .send(entry.source)
    .expect(200);
  const replayed = await request(coordinator)
    .post("/onboarding/roster/import")
    .send(entry.source)
    .expect(200);
  expect(replayed.body.id).toBe(imported.body.id);
  const linked = await prisma.agreement.findUniqueOrThrow({
    where: { id: agreement.id },
  });
  expect(linked).toMatchObject({
    documentId: agreement.documentId,
    userId: recipient.toUpperCase(),
    rosterAgentId: imported.body.id,
  });
  const invitation = await request(coordinator)
    .post("/identity/invitations")
    .send({ email: recipient, role: "agent", rosterAgentId: imported.body.id })
    .expect(201);
  await request(coordinator)
    .post("/identity/invitations/register")
    .send({
      token: invitation.body.acceptanceToken,
      name: "Synthetic Agreement Recipient",
      password,
    })
    .expect(201);
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: recipient },
  });
  expect(
    (await prisma.agreement.findUniqueOrThrow({ where: { id: agreement.id } }))
      .userId,
  ).toBe(user.id);
});

it.each(["import", "website inquiry"])(
  "preserves recorded invitation approval when resending after %s",
  async (source) => {
    const fromInquiry = source === "website inquiry";
    const recipient = email(fromInquiry ? "invite-inquiry" : "invite-import");
    const otherRecipient = email(
      fromInquiry ? "other-inquiry" : "other-import",
    );
    const session = await request(authenticated)
      .post("/api/auth/sign-in/email")
      .send({ email: owner.email, password })
      .expect(200);
    const cookie = session.headers["set-cookie"];
    expect(cookie).toBeDefined();
    const invite = (body: Record<string, unknown>) =>
      request(authenticated)
        .post("/api/v1/invitations")
        .set("Cookie", cookie)
        .send(body);
    const [original, other] = await Promise.all(
      ["Original synthetic invite file", "Other synthetic file"].map((title) =>
        prisma.matter.create({
          data: {
            title,
            propertyAddress: "Synthetic Only",
            packageCode: "essentials",
            side: "buyer",
          },
        }),
      ),
    );
    rows.fileIds.push(original.id, other.id);
    const approvalOverrideReason =
      "Synthetic approval previously recorded by the coordinator";
    const legacyInvite = (matterId: string) =>
      invite({
        email: recipient,
        role: "agent",
        approvalOverrideReason,
        matterId,
      }).expect(201);
    const separateFile = await legacyInvite(other.id);
    const sameFile = await legacyInvite(original.id);
    const first = await legacyInvite(original.id);
    const client = await invite({
      email: recipient,
      role: "client",
      matterId: other.id,
    }).expect(201);
    if (fromInquiry) {
      await prisma.invitation.update({
        where: { id: first.body.id },
        data: { email: recipient.toUpperCase() },
      });
      await createInquiry({
        name: "Synthetic Invite Recipient",
        email: recipient,
        kind: "contact",
        payload: {},
      });
    }
    const roster = await request(authenticated)
      .get("/api/v1/onboarding/roster")
      .set("Cookie", cookie)
      .expect(200);
    const entry = roster.body.find(
      (row: { email: string }) => row.email === recipient,
    );
    expect(entry).toMatchObject({
      phase: "invited",
      canArchive: false,
      invitation: { id: first.body.id },
      source: fromInquiry ? null : { kind: "invitation", id: first.body.id },
    });
    const rosterAgentId = fromInquiry
      ? entry.id
      : (
          await request(authenticated)
            .post("/api/v1/onboarding/roster/import")
            .set("Cookie", cookie)
            .send(entry.source)
            .expect(200)
        ).body.id;
    const separateBefore = await prisma.invitation.findUniqueOrThrow({
      where: { id: separateFile.body.id },
    });
    expect(separateBefore.rosterAgentId).toBe(
      fromInquiry ? null : rosterAgentId,
    );
    const otherRoster = await prisma.rosterAgent.create({
      data: {
        name: "Different roster recipient",
        email: otherRecipient,
        normalizedEmail: otherRecipient,
      },
    });
    const misdirectedInvites = await Promise.all(
      [
        { email: recipient, rosterAgentId: otherRoster.id },
        { email: otherRecipient, rosterAgentId },
      ].map((target) =>
        prisma.invitation.create({
          data: {
            ...target,
            role: "agent",
            matterId: other.id,
            tokenHash: randomUUID(),
            expiresAt: new Date(Date.now() + 3600000),
            invitedById: owner.id,
          },
        }),
      ),
    );
    const detail = await request(authenticated)
      .get(`/api/v1/onboarding/roster/${rosterAgentId}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(detail.body.invitation.id).toBe(first.body.id);

    const resend = { email: recipient, role: "agent", rosterAgentId };
    await invite({ ...resend, matterId: other.id }).expect(422);
    await invite({ ...resend, email: otherRoster.email }).expect(422);
    await invite({ ...resend, role: "client" }).expect(422);
    const second = await invite(resend).expect(201);
    expect(second.body.id).not.toBe(first.body.id);
    const old = await prisma.invitation.findUniqueOrThrow({
      where: { id: first.body.id },
    });
    expect(old.rosterAgentId).toBe(fromInquiry ? null : rosterAgentId);
    expect(old.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    const duplicate = await prisma.invitation.findUniqueOrThrow({
      where: { id: sameFile.body.id },
    });
    expect(duplicate.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    const separateAfter = await prisma.invitation.findUniqueOrThrow({
      where: { id: separateFile.body.id },
    });
    expect(separateAfter.expiresAt).toEqual(separateBefore.expiresAt);
    const unrelatedActive = await prisma.invitation.count({
      where: {
        id: { in: [client.body.id, ...misdirectedInvites.map(({ id }) => id)] },
        expiresAt: { gt: new Date() },
      },
    });
    expect(unrelatedActive).toBe(3);
    const approval = await prisma.auditEvent.findFirstOrThrow({
      where: {
        entityType: "Invitation",
        entityId: second.body.id,
        action: "invitation.created",
      },
    });
    expect(approval.details).toMatchObject({
      approvalOverrideReason,
      priorInvitationId: first.body.id,
    });
    const resent = await prisma.invitation.findUniqueOrThrow({
      where: { id: second.body.id },
    });
    expect(resent).toMatchObject({ matterId: original.id, rosterAgentId });

    const register = (token: string) =>
      request(authenticated)
        .post("/api/v1/invitations/register")
        .send({ token, name: "Synthetic Invite Recipient", password });
    await register(first.body.acceptanceToken).expect(400);
    await register(second.body.acceptanceToken).expect(201);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: recipient },
    });
    expect(await getAgentMembership(user.id)).toMatchObject({ rosterAgentId });
    const files = () =>
      prisma.matterParticipant.findMany({
        where: { userId: user.id },
        orderBy: { matterId: "asc" },
        select: { matterId: true },
      });
    expect(await files()).toEqual([{ matterId: original.id }]);
    if (!fromInquiry) {
      const recipientSession = await request(authenticated)
        .post("/api/auth/sign-in/email")
        .send({ email: recipient, password })
        .expect(200);
      const recipientCookie = recipientSession.headers["set-cookie"];
      await request(authenticated)
        .post("/api/v1/invitations")
        .set("Cookie", recipientCookie)
        .send(resend)
        .expect(403);
      await request(authenticated)
        .post("/api/v1/invitations/accept")
        .set("Cookie", recipientCookie)
        .send({ token: separateFile.body.acceptanceToken })
        .expect(200);
      expect((await files()).map(({ matterId }) => matterId)).toEqual(
        [original.id, other.id].sort(),
      );
    }
  },
);
