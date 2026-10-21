import { beforeAll, afterAll, describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHmac, createHash } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@weatherly/db";
import { type Principal, HttpError } from "@weatherly/platform";
import {
  createAuth,
  authHandler,
  sessionMiddleware,
  createIdentityRouter,
} from "../src/index";
import {
  createMatter,
  updateMatter,
  getMatter,
  listMatters,
  addNote,
  addDeadline,
  dateOnly,
  addTask,
  createMattersRouter,
  applyReviewedFacts,
  createWorkflowTemplate,
  updateWorkflowTemplate,
  updateDeadline,
} from "../../matters/src/index";
import {
  intakePayload,
  submitIntake,
  saveIntakeDraft,
} from "../../intake/src/index";
import { createOnboardingRouter } from "../../onboarding/src/index";
import {
  createDocumentsRouter,
  createObjectStore,
  uploadDocument,
  getDocument,
} from "../../documents/src/index";

const suffix = randomUUID();
const ids = ["owner", "agent", "other", "client"].map(
  (n) => `svc-${n}-${suffix}`,
);
const matterIds: string[] = [];
const draftIds: string[] = [];
const documentIds: string[] = [];
const workflowTemplateIds: string[] = [];
let owner: Principal, agent: Principal, other: Principal, client: Principal;
function totp(uri: string) {
  const encoded = new URL(uri).searchParams.get("secret")!;
  let bits = "";
  for (const c of encoded.replace(/=+$/, ""))
    bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
      .indexOf(c)
      .toString(2)
      .padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return String(
    (digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000,
  ).padStart(6, "0");
}
const fixture = {
  packageCode: "full_listing",
  side: "seller",
  propertyAddress: `123 Synthetic Lane ${suffix}`,
  purchaseType: "cash",
  contractSource: "not_yet_executed",
  documentIds: [],
  clients: [
    {
      name: "Synthetic Client",
      email: "client@example.test",
      phone: "555-0100",
      relationship: "primary",
    },
  ],
  directContact: "through_agent",
  title: { choice: "have", name: "Synthetic Title" },
  hoa: "seller_will_email",
  priorPolicy: "request_sellers",
  broker: {
    name: "Synthetic Broker",
    email: "broker@example.test",
    pre1978: true,
    ownChecklist: true,
  },
  notes: "Synthetic only",
  gift: { requested: false },
};
function pdf() {
  const stream = "BT /F1 12 Tf 70 700 Td (Synthetic contract evidence) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let result = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(result));
    result += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const start = Buffer.byteLength(result);
  result +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((x) => `${String(x).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(result);
}
let objectDirectory: string | undefined;
beforeAll(async () => {
  process.env.APP_ENV = "local";
  process.env.BETTER_AUTH_SECRET =
    "synthetic-test-secret-at-least-thirty-two-characters";
  process.env.BETTER_AUTH_URL = "http://localhost:4000";
  process.env.WEB_ORIGIN = "http://localhost:3000";
  objectDirectory = await mkdtemp(join(tmpdir(), "weatherly-service-tests-"));
  process.env.OBJECT_STORAGE_DIR = objectDirectory;
  const password = await hashPassword("Synthetic-Test-2026!");
  const roles = ["coordinator", "agent", "agent", "client"];
  for (let i = 0; i < ids.length; i++) {
    await prisma.user.create({
      data: {
        id: ids[i],
        name: roles[i] + " synthetic",
        email: `${ids[i]}@example.test`,
        emailVerified: true,
        role: roles[i],
      },
    });
    await prisma.account.create({
      data: {
        id: randomUUID(),
        accountId: ids[i],
        userId: ids[i],
        providerId: "credential",
        password,
      },
    });
  }
  const mapped = ids.map((id, i) => ({
    id,
    name: "Synthetic",
    email: `${id}@example.test`,
    role: roles[i] as Principal["role"],
    sessionId: "test",
  }));
  [owner, agent, other, client] = mapped;
}, 30000);
afterAll(async () => {
  const receipts = await prisma.intakeSubmission.findMany({
    where: { draftId: { in: draftIds } },
  });
  for (const r of receipts)
    if (!matterIds.includes(r.matterId)) matterIds.push(r.matterId);
  await prisma.outboxJob.deleteMany({
    where: {
      idempotencyKey: { in: receipts.map((r) => `intake-submitted:${r.id}`) },
    },
  });
  await prisma.intakeSubmission.deleteMany({
    where: { draftId: { in: draftIds } },
  });
  await prisma.intakeDraft.deleteMany({ where: { id: { in: draftIds } } });
  await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
  await prisma.matter.deleteMany({ where: { id: { in: matterIds } } });
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.invitation.deleteMany({ where: { invitedById: { in: ids } } });
  await prisma.workflowTemplate.deleteMany({
    where: { id: { in: workflowTemplateIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  if (objectDirectory)
    await rm(objectDirectory, { recursive: true, force: true });
});
describe("real PostgreSQL services and Better Auth", () => {
  it("enforces cross-agent access, explicit client projection, private notes, and revoked grants", async () => {
    const m = await createMatter(owner, {
      title: "Synthetic isolation",
      propertyAddress: "123 Synthetic Lane",
      side: "buyer",
      packageCode: "essentials",
      agentId: agent.id,
      details: { secret: "private-intake" },
    });
    matterIds.push(m.id);
    expect((await listMatters(agent)).some((x) => x.id === m.id)).toBe(true);
    await expect(getMatter(other, m.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      updateMatter(agent, m.id, { expectedRevision: 1, title: "forged" }),
    ).rejects.toMatchObject({ status: 403 });
    await addNote(owner, m.id, { body: "private coordinator note" });
    await addNote(owner, m.id, {
      body: "shared timeline update",
      visibility: "client",
    });
    const participant = await prisma.matterParticipant.create({
      data: { matterId: m.id, userId: client.id, role: "client" },
    });
    const view = await getMatter(client, m.id);
    expect(view).not.toHaveProperty("details");
    expect(view.notes.map((n) => n.body)).toEqual(["shared timeline update"]);
    expect(
      (await listMatters(client)).find((x) => x.id === m.id),
    ).not.toHaveProperty("details");
    await prisma.matterParticipant.update({
      where: { id: participant.id },
      data: { revokedAt: new Date() },
    });
    await expect(getMatter(client, m.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("rejects impossible dates and conflicting concurrent revisions without losing history", async () => {
    expect(dateOnly.safeParse("2026-02-30").success).toBe(false);
    expect(dateOnly.safeParse("2028-02-29").success).toBe(true);
    const m = await createMatter(owner, {
      title: "Revision test",
      propertyAddress: "Synthetic Road",
      side: "seller",
      packageCode: "full_listing",
      agentId: agent.id,
    });
    matterIds.push(m.id);
    const results = await Promise.allSettled([
      updateMatter(owner, m.id, {
        expectedRevision: 1,
        stage: "under_contract",
      }),
      updateMatter(owner, m.id, {
        expectedRevision: 1,
        title: "Concurrent edit",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason,
    ).toMatchObject({ status: 409 });
    expect(
      (await prisma.matter.findUniqueOrThrow({ where: { id: m.id } })).revision,
    ).toBe(2);
    expect(
      await prisma.auditEvent.count({
        where: { matterId: m.id, action: "matter.updated" },
      }),
    ).toBe(1);
    await expect(
      addDeadline(owner, m.id, {
        label: "Closing",
        date: "2026-02-30",
        status: "confirmed",
      }),
    ).rejects.toBeDefined();
  });
  it("validates all key conditional intake branches and atomically returns one concurrent receipt", async () => {
    expect(intakePayload.safeParse(fixture).success).toBe(true);
    for (const patch of [
      { side: "buyer" },
      { purchaseType: "financed" },
      { contractSource: "upload" },
      { contractSource: "dotloop" },
      { gift: { requested: true } },
      { hoa: "request_listing_agent" },
    ])
      expect(intakePayload.safeParse({ ...fixture, ...patch }).success).toBe(
        false,
      );
    const draft = await prisma.intakeDraft.create({
      data: { userId: agent.id, payload: fixture },
    });
    draftIds.push(draft.id);
    await expect(
      saveIntakeDraft(other, draft.id, {
        expectedRevision: 1,
        payload: fixture,
      }),
    ).rejects.toMatchObject({ status: 404 });
    const results = await Promise.all([
      submitIntake(agent, draft.id, {
        expectedRevision: 1,
        idempotencyKey: `submit-${suffix}`,
      }),
      submitIntake(agent, draft.id, {
        expectedRevision: 1,
        idempotencyKey: `submit-${suffix}`,
      }),
    ]);
    expect(results[0].matter.id).toBe(results[1].matter.id);
    matterIds.push(results[0].matter.id);
    expect(
      await prisma.intakeSubmission.count({ where: { draftId: draft.id } }),
    ).toBe(1);
    const tasks = await prisma.task.findMany({
      where: { matterId: results[0].matter.id },
    });
    expect(tasks.some((t) => t.title.includes("HOA"))).toBe(true);
    expect(tasks.some((t) => t.title.includes("Prior title"))).toBe(true);
    expect(tasks.some((t) => t.title.includes("lead-based"))).toBe(true);
    expect(tasks.some((t) => t.title.includes("Preapproval"))).toBe(false);
    await expect(
      submitIntake(agent, draft.id, {
        expectedRevision: 1,
        idempotencyKey: `different-${suffix}`,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("stores and extracts real PDF bytes, isolates draft uploads, and rejects forged file formats", async () => {
    const bytes = pdf();
    const store = createObjectStore();
    const doc = await uploadDocument(
      agent,
      {},
      { originalname: "synthetic.pdf", buffer: bytes, size: bytes.length },
      store,
    );
    documentIds.push(doc.id);
    expect(doc.versions[0].processingStatus).toBe("complete");
    const nextVersion = await uploadDocument(
      agent,
      {},
      { originalname: "synthetic.pdf", buffer: bytes, size: bytes.length },
      store,
      doc.id,
    );
    expect(nextVersion.revision).toBe(doc.revision + 1);
    expect(nextVersion.versions[0].version).toBe(2);
    expect(doc.versions[0].extractedText).toContain(
      "Synthetic contract evidence",
    );
    await expect(getDocument(other, doc.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await getDocument(agent, doc.id)).not.toHaveProperty("objectKey");
    await expect(
      uploadDocument(
        agent,
        {},
        { originalname: "bad.pdf", buffer: Buffer.from("not pdf"), size: 7 },
        store,
      ),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      uploadDocument(
        agent,
        {},
        { originalname: "legacy.doc", buffer: Buffer.from("legacy"), size: 6 },
        store,
      ),
    ).rejects.toMatchObject({ code: "CONVERSION_REQUIRED" });
  });
  it("changes only supplied patch fields and preserves manual deadline overrides during AI review", async () => {
    const m = await createMatter(owner, {
      title: "Reviewed evidence",
      propertyAddress: "Synthetic Evidence Road",
      side: "seller",
      packageCode: "full_listing",
      agentId: agent.id,
    });
    matterIds.push(m.id);
    const task = await addTask(owner, m.id, {
      title: "Keep status",
      status: "completed",
      visibility: "coordinator",
      details: { retained: true },
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.principal = owner;
      next();
    });
    app.use("/matters", createMattersRouter());
    app.use(
      (
        e: HttpError,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => res.status(e.status || 500).json({ error: e.message }),
    );
    const patch = await request(app)
      .patch(`/matters/${m.id}/tasks/${task.id}`)
      .send({ expectedRevision: 1, title: "Changed title" });
    expect(patch.status, patch.text).toBe(200);
    expect(patch.body.status).toBe("completed");
    expect(patch.body.visibility).toBe("coordinator");
    expect(patch.body.details).toEqual({ retained: true });
    const bytes = pdf();
    const doc = await uploadDocument(
      owner,
      { matterId: m.id },
      { originalname: "evidence.pdf", buffer: bytes, size: bytes.length },
      createObjectStore(),
    );
    documentIds.push(doc.id);
    const accepted = await applyReviewedFacts(owner, m.id, {
      expectedRevision: 1,
      deadlines: [
        {
          label: "Closing",
          date: "2026-12-01",
          sourceDocumentId: doc.id,
          sourceQuote: "Synthetic contract evidence",
        },
      ],
    });
    expect(accepted.deadlines[0].status).toBe("confirmed");
    const manual = await request(app)
      .patch(`/matters/${m.id}/deadlines/${accepted.deadlines[0].id}`)
      .send({ expectedRevision: 1, date: "2026-12-02" });
    expect(manual.status, manual.text).toBe(200);
    expect(manual.body.details.manualOverride).toBe(true);
    await expect(
      applyReviewedFacts(owner, m.id, {
        expectedRevision: 3,
        deadlines: [
          {
            label: "Closing",
            date: "2026-12-03",
            sourceDocumentId: doc.id,
            sourceQuote: "Synthetic contract evidence",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "MANUAL_OVERRIDE" });
    expect(
      (await prisma.matter.findUniqueOrThrow({ where: { id: m.id } })).revision,
    ).toBe(3);
  });
  it("prevents an uploader from publishing a new client-shared version without coordinator review", async () => {
    const matter = await createMatter(owner, {
      title: "Synthetic shared version",
      propertyAddress: "Synthetic Sharing Lane",
      side: "buyer",
      packageCode: "essentials",
      agentId: agent.id,
    });
    matterIds.push(matter.id);
    const bytes = pdf();
    const store = createObjectStore();
    const doc = await uploadDocument(
      agent,
      { matterId: matter.id, visibility: "agent" },
      { originalname: "shared.pdf", buffer: bytes, size: bytes.length },
      store,
    );
    documentIds.push(doc.id);
    await prisma.document.update({
      where: { id: doc.id },
      data: { visibility: "client", revision: { increment: 1 } },
    });
    const before = await prisma.documentVersion.count({
      where: { documentId: doc.id },
    });
    await expect(
      uploadDocument(
        agent,
        { visibility: "agent" },
        { originalname: "shared.pdf", buffer: bytes, size: bytes.length },
        store,
        doc.id,
      ),
    ).rejects.toMatchObject({
      status: 403,
      code: "SHARED_VERSION_REQUIRES_REVIEW",
    });
    expect(
      await prisma.documentVersion.count({ where: { documentId: doc.id } }),
    ).toBe(before);
    const reviewed = await uploadDocument(
      owner,
      { visibility: "client" },
      { originalname: "shared.pdf", buffer: bytes, size: bytes.length },
      store,
      doc.id,
    );
    expect(reviewed.versions[0].version).toBe(2);
    expect(reviewed.visibility).toBe("client");
  });
  it("requires signed agreement evidence or audited coordinator exception and consumes invitations once", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.principal = owner;
      next();
    });
    app.use("/identity", createIdentityRouter(createAuth()));
    app.use("/onboarding", createOnboardingRouter());
    app.use(
      (
        e: HttpError,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) =>
        res.status(e.status || 400).json({
          error: { code: e.code || "VALIDATION", message: e.message },
        }),
    );
    const email = `new-${suffix}@example.test`;
    await request(app)
      .post("/identity/invitations")
      .send({ email, role: "agent" })
      .expect(422);
    await request(app)
      .post("/onboarding/agreements")
      .send({ userId: email, version: "test-v1", status: "approved" })
      .expect(422);
    const invited = await request(app).post("/identity/invitations").send({
      email,
      role: "agent",
      approvalOverrideReason:
        "Synthetic test exception approved by coordinator",
    });
    expect(invited.status, invited.text).toBe(201);
    const registered = await request(app)
      .post("/identity/invitations/register")
      .send({
        token: invited.body.acceptanceToken,
        name: "Invited Synthetic Agent",
        password: "Synthetic-Test-2026!",
      });
    expect(registered.status, registered.text).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    ids.push(user.id);
    expect(
      await prisma.auditEvent.count({
        where: { entityId: user.id, action: "agent.access_override" },
      }),
    ).toBe(1);
    await request(app)
      .post("/identity/invitations/register")
      .send({
        token: invited.body.acceptanceToken,
        name: "Invited Synthetic Agent",
        password: "Synthetic-Test-2026!",
      })
      .expect(400);
    const expiredToken = randomUUID() + randomUUID();
    await prisma.invitation.create({
      data: {
        email: `expired-${suffix}@example.test`,
        role: "client",
        tokenHash: createHash("sha256").update(expiredToken).digest("hex"),
        expiresAt: new Date(Date.now() - 1000),
        invitedById: owner.id,
      },
    });
    await request(app)
      .post("/identity/invitations/register")
      .send({
        token: expiredToken,
        name: "Expired Client",
        password: "Synthetic-Test-2026!",
      })
      .expect(400);
  });
  it("uses real Better Auth cookies, enforces MFA outside local, and revokes sessions", async () => {
    const auth = createAuth();
    const app = express();
    app.all("/api/auth/*splat", authHandler(auth));
    app.use(express.json());
    app.use(sessionMiddleware(auth));
    app.use("/api/v1", createIdentityRouter(auth));
    app.get("/api/v1/business", (_req, res) => res.json({ ok: true }));
    app.use(
      (
        error: Error & { status?: number; code?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) =>
        res.status(error.status || 500).json({
          error: { code: error.code || error.name, message: error.message },
        }),
    );
    const signed = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: owner.email, password: "Synthetic-Test-2026!" });
    expect(signed.status, signed.text).toBe(200);
    const cookie = signed.headers["set-cookie"];
    expect(cookie).toBeTruthy();
    const session = await request(app)
      .get("/api/v1/session")
      .set("Cookie", cookie);
    expect(session.status, session.text).toBe(200);
    expect(session.body.user.id).toBe(owner.id);
    process.env.APP_ENV = "staging";
    const denied = await request(app)
      .get("/api/v1/business")
      .set("Cookie", cookie);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("MFA_REQUIRED");
    process.env.APP_ENV = "local";
    const enrollment = await request(app)
      .post("/api/auth/two-factor/enable")
      .set("Cookie", cookie)
      .send({ password: "Synthetic-Test-2026!" });
    expect(enrollment.status, enrollment.text).toBe(200);
    expect(enrollment.body.totpURI).toContain("otpauth://");
    const verified = await request(app)
      .post("/api/auth/two-factor/verify-totp")
      .set("Cookie", cookie)
      .send({ code: totp(enrollment.body.totpURI) });
    expect(verified.status, verified.text).toBe(200);
    const verifiedCookie = verified.headers["set-cookie"] || cookie;
    const activeSession = await request(app)
      .get("/api/v1/session")
      .set("Cookie", verifiedCookie);
    expect(activeSession.status, activeSession.text).toBe(200);
    const challenged = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: owner.email, password: "Synthetic-Test-2026!" });
    expect(challenged.body.twoFactorRedirect).toBe(true);
    await request(app)
      .get("/api/v1/session")
      .set("Cookie", challenged.headers["set-cookie"])
      .expect(401);
    await request(app)
      .post("/api/v1/sessions/revoke")
      .set("Cookie", verifiedCookie)
      .send({ sessionId: activeSession.body.session.id })
      .expect(200);
    await request(app)
      .get("/api/v1/session")
      .set("Cookie", verifiedCookie)
      .expect(401);
  });
  it("snapshots future-only workflow versions and recalculates dependent dates while preserving overrides", async () => {
    const definition = {
      steps: [
        {
          key: "inspection_due",
          title: "Inspection deadline",
          kind: "checklist",
          visibility: "agent",
          rule: {
            anchor: "Closing date",
            offsetDays: -3,
            businessDays: false,
            skipDates: [],
          },
        },
      ],
    };
    const template = await createWorkflowTemplate(owner, {
      name: `Synthetic rules ${suffix}`,
      side: "seller",
      packageCode: "full_listing",
      definition,
    });
    workflowTemplateIds.push(template.id);
    const first = await createMatter(owner, {
      title: `Page-${suffix}-first`,
      propertyAddress: "Synthetic workflow first",
      side: "seller",
      packageCode: "full_listing",
      agentId: agent.id,
    });
    matterIds.push(first.id);
    expect(
      (first.details as { workflow: { templateId: string } }).workflow
        .templateId,
    ).toBe(template.id);
    const anchor = await addDeadline(owner, first.id, {
      label: "Closing date",
      date: "2026-12-20",
      status: "confirmed",
    });
    let dependent = await prisma.deadline.findFirstOrThrow({
      where: { matterId: first.id, label: "Inspection deadline" },
    });
    expect(dependent.date).toBe("2026-12-17");
    await updateDeadline(owner, first.id, anchor.id, {
      expectedRevision: 1,
      date: "2026-12-25",
    });
    dependent = await prisma.deadline.findUniqueOrThrow({
      where: { id: dependent.id },
    });
    expect(dependent.date).toBe("2026-12-22");
    await updateDeadline(owner, first.id, dependent.id, {
      expectedRevision: dependent.revision,
      date: "2026-12-19",
    });
    await updateDeadline(owner, first.id, anchor.id, {
      expectedRevision: 2,
      date: "2026-12-30",
    });
    expect(
      (await prisma.deadline.findUniqueOrThrow({ where: { id: dependent.id } }))
        .date,
    ).toBe("2026-12-19");
    await updateWorkflowTemplate(owner, template.id, {
      expectedRevision: 1,
      definition: {
        steps: [
          {
            ...definition.steps[0],
            rule: { ...definition.steps[0].rule, offsetDays: -7 },
          },
        ],
      },
    });
    const second = await createMatter(owner, {
      title: `Page-${suffix}-second`,
      propertyAddress: "Synthetic workflow second",
      side: "seller",
      packageCode: "full_listing",
      agentId: agent.id,
    });
    matterIds.push(second.id);
    expect(
      (second.details as { workflow: { templateRevision: number } }).workflow
        .templateRevision,
    ).toBe(2);
    expect(
      (
        (await prisma.matter.findUniqueOrThrow({ where: { id: first.id } }))
          .details as { workflow: { templateRevision: number } }
      ).workflow.templateRevision,
    ).toBe(1);
    const page1 = await listMatters(agent, { q: `Page-${suffix}`, limit: 1 });
    const page2 = await listMatters(agent, {
      q: `Page-${suffix}`,
      limit: 1,
      cursor: page1[0].id,
    });
    expect(page1).toHaveLength(1);
    expect(page2).toHaveLength(1);
    expect(page1[0].id).not.toBe(page2[0].id);
  });
});
