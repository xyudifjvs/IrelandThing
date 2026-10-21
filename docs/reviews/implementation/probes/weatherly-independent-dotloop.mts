import "./_review-safety.mjs";
import {
  checkoutRoot,
  checkerDatabaseUrl,
  apiBase,
  webBase,
} from "./_review-safety.mjs";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../../packages/db/src/index.ts";
import {
  connectDotloop,
  finishDotloop,
  syncDotloop,
  listDotloopLinks,
} from "../../../../packages/dotloop/src/index.ts";
import { decryptSecret } from "../../../../packages/platform/src/index.ts";
const id = "checker-dotloop-" + randomUUID(),
  actor = {
    id,
    email: id + "@example.test",
    name: "Independent Synthetic",
    role: "coordinator" as const,
    sessionId: "independent-dotloop",
  },
  checks = [];
const check = (name, pass, extra = {}) => checks.push({ name, pass, ...extra });
async function denied(name, fn, code) {
  try {
    await fn();
    check(name, false);
  } catch (e) {
    check(name, e.code === code, { code: e.code });
  }
}
let calls = [];
const originalFetch = globalThis.fetch;
let mode = "json";
globalThis.fetch = async (url, options) => {
  calls.push(String(url));
  if (String(url).includes("/oauth/token"))
    return new Response(
      JSON.stringify({
        access_token: "synthetic-token-never-live",
        refresh_token: "synthetic-refresh-never-live",
        expires_in: 3600,
      }),
    );
  if (String(url).endsWith("/folder"))
    return new Response(
      JSON.stringify({ data: [{ id: 3, name: "Synthetic folder" }] }),
      { headers: { "Content-Type": "application/json" } },
    );
  if (String(url).endsWith("/document"))
    return new Response(
      JSON.stringify({
        data: [
          { id: 4, filename: "Synthetic contract.pdf", updated: "2026-10-20" },
        ],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  if (mode === "denied") return new Response("{}", { status: 403 });
  return new Response("Synthetic unauthorized HTML response", {
    headers: { "Content-Type": "text/html" },
  });
};
try {
  await prisma.user.create({
    data: { id, name: actor.name, email: actor.email, role: "coordinator" },
  });
  await prisma.matter.create({
    data: {
      id,
      title: "Independent Dotloop fixture",
      propertyAddress: "Synthetic Review Lane",
      side: "buyer",
      packageCode: "complete",
    },
  });
  process.env.DOTLOOP_ENABLED = "false";
  await denied(
    "Unconfigured Dotloop blocked",
    () => connectDotloop(actor),
    "DOTLOOP_NOT_CONFIGURED",
  );
  check("Unconfigured makes zero provider calls", calls.length === 0);
  Object.assign(process.env, {
    DOTLOOP_ENABLED: "true",
    DOTLOOP_CLIENT_ID: "synthetic-id",
    DOTLOOP_CLIENT_SECRET: "synthetic-secret",
    DOTLOOP_REDIRECT_URI: "http://127.0.0.1/callback",
    CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    DOTLOOP_BINARY_DOWNLOAD_VERIFIED: "false",
  });
  await denied(
    "Noncoordinator cannot initiate provider OAuth",
    () => connectDotloop({ ...actor, role: "agent" }),
    "FORBIDDEN",
  );
  const auth = await connectDotloop(actor),
    state = new URL(auth.url).searchParams.get("state");
  await denied(
    "OAuth state bound to initiating coordinator",
    () =>
      finishDotloop(
        { ...actor, id: "unrelated" },
        { state, code: "synthetic-code" },
      ),
    "INVALID_OAUTH_STATE",
  );
  check(
    "Wrong coordinator state caused no provider request",
    calls.length === 0,
  );
  await finishDotloop(actor, { state, code: "synthetic-code" });
  await denied(
    "OAuth state cannot be reused",
    () => finishDotloop(actor, { state, code: "synthetic-code" }),
    "INVALID_OAUTH_STATE",
  );
  const conn = await prisma.integrationConnection.findUniqueOrThrow({
    where: { provider_ownerId: { provider: "dotloop", ownerId: id } },
  });
  check(
    "Stored token encrypted and decrypts correctly",
    !conn.credentials.includes("synthetic-token") &&
      JSON.parse(decryptSecret(conn.credentials)).access_token ===
        "synthetic-token-never-live",
  );
  const link = await prisma.dotloopLink.create({
    data: { matterId: id, ownerId: id, profileId: "1", loopId: "2" },
  });
  const count = calls.length;
  await syncDotloop(link.id);
  const row = await prisma.dotloopLink.findUniqueOrThrow({
    where: { id: link.id },
  });
  check(
    "Unverified binary capability retains manual-upload status",
    row.status === "manual_upload_required" &&
      row.metadata.documents[0].status === "manual_upload_required",
  );
  check(
    "Binary gate made only metadata requests",
    calls.length - count === 2 &&
      !calls.slice(count).some((u) => u.endsWith("/document/4")),
  );
  check(
    "Metadata-only sync created no fake local document",
    (await prisma.document.count({ where: { matterId: id } })) === 0,
  );
  check(
    "Unrelated client cannot enumerate link",
    (
      await listDotloopLinks({ ...actor, id: "client-local", role: "client" })
    ).every((l) => l.id !== link.id),
  );
  process.env.DOTLOOP_BINARY_DOWNLOAD_VERIFIED = "true";
  await denied(
    "HTML content is rejected instead of importing as PDF",
    () => syncDotloop(link.id),
    "DOTLOOP_BINARY_UNAVAILABLE",
  );
  check(
    "Rejected source leaves link in actionable error",
    (await prisma.dotloopLink.findUniqueOrThrow({ where: { id: link.id } }))
      .status === "error",
  );
  await prisma.auditEvent.create({
    data: {
      actorId: id,
      action: "identity.access_revoked",
      entityType: "User",
      entityId: id,
    },
  });
  const before = calls.length;
  await denied(
    "Revoked owner cannot run queued provider work",
    () => syncDotloop(link.id),
    "ACCESS_REVOKED",
  );
  check(
    "Revoked owner failure occurs before provider fetch",
    calls.length === before,
  );
  console.log(
    JSON.stringify(
      {
        candidate: "2859d65",
        checks: checks.length,
        failed: checks.filter((x) => !x.pass).length,
        provider: "in-process stub only",
        results: checks,
      },
      null,
      2,
    ),
  );
} finally {
  globalThis.fetch = originalFetch;
  await prisma.dotloopLink.deleteMany({ where: { ownerId: id } });
  await prisma.oAuthState.deleteMany({ where: { userId: id } });
  await prisma.integrationConnection.deleteMany({ where: { ownerId: id } });
  await prisma.auditEvent.deleteMany({ where: { actorId: id } });
  await prisma.matter.deleteMany({ where: { id } });
  await prisma.user.deleteMany({ where: { id } });
  await prisma.$disconnect();
}
