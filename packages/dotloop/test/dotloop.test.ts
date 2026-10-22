import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@weatherly/db";
import { type Principal, encryptSecret } from "@weatherly/platform";
import { connectDotloop, finishDotloop, syncDotloop } from "../src/index";
const id = `dotloop-test-${randomUUID()}`;
const actor: Principal = {
  id,
  name: "Synthetic owner",
  email: `${id}@example.test`,
  role: "coordinator",
  sessionId: "test",
};
beforeAll(async () => {
  await prisma.user.create({
    data: { id, name: actor.name, email: actor.email, role: actor.role },
  });
  await prisma.matter.create({
    data: {
      id,
      title: "Synthetic Dotloop",
      propertyAddress: "1 Test Lane",
      packageCode: "complete",
      side: "buyer",
    },
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await prisma.dotloopLink.deleteMany({ where: { ownerId: id } });
  await prisma.oAuthState.deleteMany({ where: { userId: id } });
  await prisma.integrationConnection.deleteMany({ where: { ownerId: id } });
  await prisma.auditEvent.deleteMany({ where: { actorId: id } });
  await prisma.matter.delete({ where: { id } });
  await prisma.user.delete({ where: { id } });
});
function configure() {
  vi.stubEnv("DOTLOOP_ENABLED", "true");
  vi.stubEnv("DOTLOOP_CLIENT_ID", "test-id");
  vi.stubEnv("DOTLOOP_CLIENT_SECRET", "test-secret");
  vi.stubEnv("DOTLOOP_REDIRECT_URI", "http://127.0.0.1/callback");
  vi.stubEnv(
    "CREDENTIAL_ENCRYPTION_KEY",
    Buffer.alloc(32, 7).toString("base64"),
  );
}
it("blocks unconfigured access without making provider requests", async () => {
  vi.stubEnv("DOTLOOP_ENABLED", "false");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(connectDotloop(actor)).rejects.toMatchObject({
    code: "DOTLOOP_NOT_CONFIGURED",
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it("binds one-use authorization to its coordinator and encrypts the returned token", async () => {
  configure();
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          access_token: "synthetic-access",
          refresh_token: "synthetic-refresh",
          expires_in: 3600,
        }),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const auth = await connectDotloop(actor);
  const state = new URL(auth.url).searchParams.get("state")!;
  await expect(
    finishDotloop(
      { ...actor, id: "different-owner" },
      { state, code: "test-code" },
    ),
  ).rejects.toMatchObject({ code: "INVALID_OAUTH_STATE" });
  expect(fetcher).not.toHaveBeenCalled();
  await finishDotloop(actor, { state, code: "test-code" });
  await expect(
    finishDotloop(actor, { state, code: "test-code" }),
  ).rejects.toMatchObject({ code: "INVALID_OAUTH_STATE" });
  const connection = await prisma.integrationConnection.findUniqueOrThrow({
    where: { provider_ownerId: { provider: "dotloop", ownerId: id } },
  });
  expect(connection.credentials).not.toContain("synthetic-access");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("saves inventory with manual-upload status until binary access is verified", async () => {
  configure();
  vi.stubEnv("DOTLOOP_BINARY_DOWNLOAD_VERIFIED", "false");
  await prisma.integrationConnection.update({
    where: { provider_ownerId: { provider: "dotloop", ownerId: id } },
    data: {
      credentials: encryptSecret(
        JSON.stringify({
          access_token: "synthetic-access",
          refresh_token: "synthetic-refresh",
          expires_in: 3600,
        }),
      ),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const link = await prisma.dotloopLink.create({
    data: { matterId: id, ownerId: id, profileId: "1", loopId: "2" },
  });
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify({
          data: url.endsWith("/folder")
            ? [{ id: 3, name: "Contracts" }]
            : [{ id: 4, name: "Purchase contract" }],
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  await syncDotloop(link.id);
  const saved = await prisma.dotloopLink.findUniqueOrThrow({
    where: { id: link.id },
  });
  expect(saved.status).toBe("manual_upload_required");
  expect(saved.metadata).toMatchObject({
    documents: [{ id: "4", status: "manual_upload_required" }],
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await prisma.document.count({ where: { matterId: id } })).toBe(0);
  await prisma.auditEvent.create({
    data: {
      actorId: id,
      action: "identity.access_revoked",
      entityType: "User",
      entityId: id,
    },
  });
  await expect(syncDotloop(link.id)).rejects.toMatchObject({
    code: "ACCESS_REVOKED",
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
