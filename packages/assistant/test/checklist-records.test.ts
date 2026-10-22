import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@weatherly/db";
import { createMatter, createChecklistShare, revokeChecklistShare } from "@weatherly/matters";
import type { Principal } from "@weatherly/platform";
import { queryStoredRecords } from "../src/records";

const prefix = `checklist-records-${randomUUID()}`;
const actor = (role: "coordinator" | "agent" | "client"): Principal => ({
  id: `${prefix}-${role}`, email: `${prefix}-${role}@example.test`,
  name: "Synthetic checklist records", role, sessionId: "synthetic",
});
const owner = actor("coordinator"), agent = actor("agent"), client = actor("client");
const matters: string[] = [];
afterAll(async () => {
  await prisma.matter.deleteMany({ where: { id: { in: matters } } });
  await prisma.auditEvent.deleteMany({ where: { actorId: { startsWith: prefix } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.$disconnect();
});
describe("checklist sharing API/MCP record projection", () => {
  it("returns current safe metadata to authorized agents and no bearer material", async () => {
    for (const user of [owner, agent, client])
      await prisma.user.create({ data: { id: user.id, name: user.name, email: user.email, role: user.role, twoFactorEnabled: user.role === "coordinator" } });
    const matter = await createMatter(owner, {
      title: "Synthetic shared checklist", propertyAddress: "Synthetic Checklist Lane",
      side: "buyer", packageCode: "essentials", agentId: agent.id,
    });
    matters.push(matter.id);
    const link = await createChecklistShare(owner, matter.id);
    const token = link.url.split("#")[1];
    const result = await queryStoredRecords(agent, { kind: "checklist_shares", matterId: matter.id, limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ matterId: matter.id, active: true });
    const text = JSON.stringify(result);
    for (const secret of [token, "tokenHash", "issuedById", "url"])
      expect(text).not.toContain(secret);
    await revokeChecklistShare(owner, matter.id);
    expect((await queryStoredRecords(agent, { kind: "checklist_shares", matterId: matter.id })).items[0])
      .toMatchObject({ active: false });
  });
  it("denies client records and excludes unrelated matters", async () => {
    await expect(queryStoredRecords(client, { kind: "checklist_shares" })).rejects.toMatchObject({ status: 403 });
    const unrelated = await createMatter(owner, {
      title: "Synthetic unrelated", propertyAddress: "Other Synthetic Lane", side: "buyer", packageCode: "essentials",
    });
    matters.push(unrelated.id);
    await createChecklistShare(owner, unrelated.id);
    const result = await queryStoredRecords(agent, { kind: "checklist_shares", limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(false);
    expect(JSON.stringify(result)).not.toContain(unrelated.id);
    await expect(queryStoredRecords(agent, { kind: "checklist_shares", matterId: unrelated.id })).rejects.toMatchObject({ status: 404 });
  });
});
