import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "@weatherly/platform";

const db = vi.hoisted(() => ({
  assistantGrant: { findUnique: vi.fn() },
  assistantClient: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  auditEvent: { findFirst: vi.fn() },
}));
vi.mock("@weatherly/db", () => ({ prisma: db }));
vi.mock("@weatherly/matters", () => ({ audit: vi.fn() }));
import { grantPrincipal } from "../src/access";

const evidence =
  "Synthetic independently approved assistant compliance evidence";
const redirectUris = ["https://assistant.example.test/callback"];

describe("assistant coordinator grant access", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("MCP_ENABLED", "true");
    vi.stubEnv(
      "MCP_APPROVED_CLIENTS_JSON",
      JSON.stringify([
        { id: "approved", redirectUris, evidenceHash: hashToken(evidence) },
      ]),
    );
    db.assistantGrant.findUnique.mockResolvedValue({
      id: "grant",
      clientId: "approved",
      approvedClient: true,
      userId: "owner",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      scopes: ["weatherly:read"],
    });
    db.assistantClient.findUnique.mockResolvedValue({
      id: "approved",
      approved: true,
      redirectUris,
      complianceEvidence: evidence,
    });
    db.user.findUnique.mockResolvedValue({
      id: "owner",
      email: "owner@example.test",
      name: "Owner",
      role: "coordinator",
      twoFactorEnabled: false,
    });
    db.auditEvent.findFirst.mockResolvedValue(null);
  });
  it("permits an approved read grant without authenticator enrollment in production", async () => {
    expect((await grantPrincipal("synthetic-token")).actor).toMatchObject({
      id: "owner",
      role: "coordinator",
      sessionId: "mcp:grant",
    });
  });
  it("still rejects revoked coordinator access", async () => {
    db.auditEvent.findFirst.mockResolvedValue({
      action: "identity.access_revoked",
    });
    await expect(grantPrincipal("synthetic-token")).rejects.toMatchObject({
      code: "ACCESS_REVOKED",
    });
  });
  it("still rejects a user who is no longer a coordinator", async () => {
    db.user.findUnique.mockResolvedValue({
      id: "owner",
      role: "agent",
      twoFactorEnabled: true,
    });
    await expect(grantPrincipal("synthetic-token")).rejects.toMatchObject({
      code: "ACCESS_REVOKED",
    });
  });
  it("still rejects revoked grants", async () => {
    db.assistantGrant.findUnique.mockResolvedValue({ revokedAt: new Date() });
    await expect(grantPrincipal("synthetic-token")).rejects.toMatchObject({
      code: "INVALID_TOKEN",
    });
  });
});
