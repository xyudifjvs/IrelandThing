import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
const execute = promisify(execFile);
const checks: string[] = [];
async function port() {
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const value = (server.address() as net.AddressInfo).port;
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  return value;
}
const supplied = process.env.DATABASE_URL;
if (!supplied)
  throw new Error(
    "DATABASE_URL is required for the isolated acceptance server.",
  );
const source = new URL(supplied);
if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname))
  throw new Error("Acceptance execution refuses a non-local database host.");
const database = `weatherly_acceptance_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: source.href });
await admin.connect();
await admin.query(`CREATE DATABASE "${database}"`);
source.pathname = "/" + database;
const temporary = await mkdtemp(
  path.join(os.tmpdir(), "weatherly-acceptance-"),
);
const apiPort = await port(),
  origin = `http://127.0.0.1:${apiPort}`;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: source.href,
  APP_ENV: "local",
  NODE_ENV: "development",
  PORT: String(apiPort),
  WEB_ORIGIN: origin,
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: randomBytes(40).toString("base64url"),
  CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  OBJECT_STORAGE_DIR: path.join(temporary, "objects"),
  S3_BUCKET: "",
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
  OPENROUTER_API_KEY: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  DOTLOOP_CLIENT_ID: "",
  DOTLOOP_CLIENT_SECRET: "",
  RESEND_API_KEY: "",
};
let server: ReturnType<typeof spawn> | undefined;
async function request(
  route: string,
  body?: unknown,
  cookie = "",
  method = body === undefined ? "GET" : "POST",
) {
  const res = await fetch(origin + route, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => null);
  return { res, data };
}
async function login(email: string) {
  const { res } = await request("/api/auth/sign-in/email", {
    email,
    password: "Weatherly-Local-2026!",
  });
  assert.equal(res.status, 200, `Synthetic sign-in failed: ${email}`);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}
try {
  await execute(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env, maxBuffer: 1024 * 1024 },
  );
  await execute(
    process.execPath,
    ["--import", "tsx", "packages/db/src/seed.ts"],
    { env, maxBuffer: 1024 * 1024 },
  );
  server = spawn(
    process.execPath,
    ["--import", "tsx", "apps/api/src/main.ts"],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  server.stdout?.on("data", (d) => {
    output = (output + d).slice(-10000);
  });
  server.stderr?.on("data", (d) => {
    output = (output + d).slice(-10000);
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(origin + "/health");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null)
      throw new Error("Acceptance API exited before readiness: " + output);
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "Acceptance API did not become ready.");
  checks.push("isolated migrated PostgreSQL and API readiness");
  const owner = await login("ireland@example.test"),
    agent = await login("alex.agent@example.test"),
    client = await login("avery.client@example.test");
  assert.equal(
    (await request("/api/v1/session", undefined, owner)).data.user.role,
    "coordinator",
  );
  assert.equal((await request("/api/v1/matters")).res.status, 401);
  checks.push("real cookie sign-in and unauthenticated denial");
  const payload = {
    packageCode: "full_listing",
    side: "seller",
    propertyAddress: "123 Synthetic Acceptance Lane, Columbus, OH",
    purchaseType: "financed",
    contractSource: "not_yet_executed",
    documentIds: [],
    clients: [
      {
        name: "Synthetic Seller",
        email: "seller@example.test",
        phone: "555-0102",
        relationship: "owner",
      },
    ],
    directContact: "through_agent",
    title: { choice: "mls" },
    lender: { choice: "buyers_agent" },
    hoa: "seller_will_email",
    priorPolicy: "request_sellers",
    broker: {
      name: "Synthetic Broker",
      email: "broker@example.test",
      pre1978: true,
      ownChecklist: true,
    },
    notes: "Synthetic acceptance record only.",
    gift: { requested: false },
  };
  const draft = await request("/api/v1/intake/drafts", { payload }, owner);
  assert.equal(
    draft.res.status,
    201,
    "The singular intake UI endpoint must be mounted.",
  );
  const key = randomUUID();
  const submitted = await request(
    `/api/v1/intake/drafts/${draft.data.id}/submit`,
    { expectedRevision: draft.data.revision, idempotencyKey: key },
    owner,
  );
  assert.equal(submitted.res.status, 200, JSON.stringify(submitted.data));
  const matterId = submitted.data.matter.id;
  const again = await request(
    `/api/v1/intake/drafts/${draft.data.id}/submit`,
    { expectedRevision: draft.data.revision, idempotencyKey: key },
    owner,
  );
  assert.equal(again.data.matter.id, matterId);
  let matter = (await request(`/api/v1/matters/${matterId}`, undefined, owner))
    .data;
  assert.ok(matter.tasks.length > 5);
  const states = new Set([
    "pending",
    "received",
    "proposed",
    "completed",
    "signed",
    "not_applicable",
  ]);
  assert.ok(
    matter.tasks.every((t: { status: string }) => states.has(t.status)),
    "Generated tasks must use canonical workflow states.",
  );
  checks.push(
    "full-listing branch submission, canonical follow-ups and duplicate-submit idempotency",
  );
  const invalid = await request(
    "/api/v1/intake/drafts",
    { payload: { ...payload, side: "buyer" } },
    owner,
  );
  assert.equal(
    (
      await request(
        `/api/v1/intake/drafts/${invalid.data.id}/submit`,
        {
          expectedRevision: invalid.data.revision,
          idempotencyKey: randomUUID(),
        },
        owner,
      )
    ).res.status,
    422,
  );
  checks.push("unsupported buyer Full Listing branch rejected");
  const task = matter.tasks[0];
  const completed = await request(
    `/api/v1/matters/${matterId}/tasks/${task.id}`,
    { expectedRevision: task.revision, status: "completed" },
    owner,
    "PATCH",
  );
  assert.equal(completed.res.status, 200);
  assert.equal(
    (
      await request(
        `/api/v1/matters/${matterId}/tasks/${task.id}`,
        { expectedRevision: task.revision, status: "pending" },
        owner,
        "PATCH",
      )
    ).res.status,
    409,
  );
  checks.push("task completion and stale revision conflict");
  const privateNote = await request(
    `/api/v1/matters/${matterId}/notes`,
    { body: "Coordinator private acceptance note", visibility: "coordinator" },
    owner,
  );
  assert.equal(privateNote.res.status, 201);
  const visibleNote = await request(
    `/api/v1/matters/${matterId}/notes`,
    { body: "Shared acceptance update", visibility: "client" },
    owner,
  );
  assert.equal(visibleNote.res.status, 201);
  matter = (await request(`/api/v1/matters/${matterId}`, undefined, owner))
    .data;
  assert.equal(
    (
      await request(
        `/api/v1/matters/${matterId}`,
        { expectedRevision: matter.revision, agentId: "agent-local" },
        owner,
        "PATCH",
      )
    ).res.status,
    200,
  );
  assert.equal(
    (
      await request(
        `/api/v1/matters/${matterId}/participants`,
        { userId: "client-local", role: "client" },
        owner,
      )
    ).res.status,
    201,
  );
  for (const cookie of [agent, client]) {
    const projected = await request(
      `/api/v1/matters/${matterId}`,
      undefined,
      cookie,
    );
    assert.equal(projected.res.status, 200);
    assert.ok(
      !projected.data.notes.some(
        (n: { id: string }) => n.id === privateNote.data.id,
      ),
    );
    assert.ok(
      projected.data.notes.some(
        (n: { id: string }) => n.id === visibleNote.data.id,
      ),
    );
  }
  assert.equal(
    (await request("/api/v1/intake/drafts", { payload }, client)).res.status,
    403,
  );
  checks.push(
    "agent/client shared projections and private-note/intake isolation",
  );
  const deadline = await request(
    `/api/v1/matters/${matterId}/deadlines`,
    { label: "Closing", date: "2026-12-15", status: "confirmed" },
    owner,
  );
  assert.equal(deadline.res.status, 201);
  assert.equal(
    (
      await request(
        `/api/v1/matters/${matterId}/deadlines/${deadline.data.id}`,
        {
          expectedRevision: deadline.data.revision,
          date: "2026-12-16",
          status: "confirmed",
        },
        owner,
        "PATCH",
      )
    ).res.status,
    200,
  );
  checks.push("real deadline create and correction");
  const inquiry = await request("/api/v1/onboarding/inquiries", {
    name: "Synthetic Inquiry",
    email: "inquiry@example.test",
    kind: "meeting",
    payload: {
      meetingTime: "2026-12-01T15:00:00.000Z",
      timezone: "America/New_York",
      message: "Synthetic meeting request; no message delivery.",
    },
  });
  assert.equal(inquiry.res.status, 201);
  const inquiries = await request(
    "/api/v1/onboarding/inquiries",
    undefined,
    owner,
  );
  assert.ok(
    inquiries.data.some((i: { id: string }) => i.id === inquiry.data.id),
  );
  checks.push("public meeting request persisted for coordinator review");
  const catalog = await request("/api/v1/billing/catalog", undefined, owner);
  assert.equal(catalog.res.status, 200);
  assert.deepEqual(
    catalog.data
      .filter((c: { code: string }) =>
        ["essentials", "complete", "full_listing"].includes(c.code),
      )
      .map((c: { priceCents: number }) => c.priceCents)
      .sort((a: number, b: number) => a - b),
    [37500, 47500, 62500],
  );
  assert.equal(
    (
      await request(
        "/api/v1/billing/checkout",
        { matterId, kind: "service", idempotencyKey: randomUUID() },
        owner,
      )
    ).res.status,
    503,
  );
  assert.equal(
    (await request("/api/v1/communications/connect", {}, owner)).res.status,
    503,
  );
  checks.push("approved catalog and unconfigured money/mail fail-closed gates");
  if (process.env.ACCEPTANCE_WEB_URL) {
    for (const route of [
      "/",
      "/services",
      "/process",
      "/onboarding",
      "/testimonials",
      "/faq",
      "/agent-portal",
      "/contact",
      "/login",
    ]) {
      const r: Response = await fetch(
        new URL(route, process.env.ACCEPTANCE_WEB_URL),
      );
      assert.equal(r.status, 200, `Public page failed: ${route}`);
      const html = await r.text();
      assert.ok(html.includes("Weatherly") || html.includes("WEATHERLY"));
    }
    checks.push("eight public pages and sign-in HTTP render");
  }
  console.log(
    JSON.stringify(
      {
        status: "passed",
        checks,
        providerCalls: "none",
        databaseIsolation: true,
      },
      null,
      2,
    ),
  );
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((r) => server!.once("exit", () => r())),
      new Promise<void>((r) =>
        setTimeout(() => {
          server!.kill("SIGKILL");
          r();
        }, 3000),
      ),
    ]);
  }
  await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.end();
  await rm(temporary, { recursive: true, force: true });
}
