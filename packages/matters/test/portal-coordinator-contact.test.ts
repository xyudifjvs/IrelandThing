import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import { getMatter } from "../src/projections/matters";
const prefix = `portal-contact-${randomUUID()}`;
const owner = {
  id: prefix,
  name: "Synthetic coordinator",
  email: prefix + "@example.test",
  role: "coordinator",
};
const agent: Principal = {
  id: prefix + "agent",
  name: "Synthetic agent",
  email: prefix + "agent@example.test",
  role: "agent",
  sessionId: prefix,
};
const client: Principal = {
  ...agent,
  id: prefix + "client",
  email: prefix + "client@example.test",
  role: "client",
};
const files: string[] = [];
beforeAll(async () => {
  await prisma.user.createMany({
    data: [owner, agent, client].map(({ id, name, email, role }) => ({
      id,
      name,
      email,
      role,
    })),
  });
});
afterAll(async () => {
  await prisma.creationReview.deleteMany({ where: { ownerId: owner.id } });
  await prisma.matter.deleteMany({ where: { id: { in: files } } });
  await prisma.user.deleteMany({
    where: { id: { in: [owner.id, agent.id, client.id] } },
  });
});
async function file(details: object = {}) {
  const m = await prisma.matter.create({
    data: {
      title: "Synthetic file",
      propertyAddress: "1 Synthetic Lane",
      side: "buyer",
      packageCode: "essentials",
      agentId: agent.id,
      checklistVersion: 1,
      details,
    },
  });
  files.push(m.id);
  await prisma.matterParticipant.create({
    data: { matterId: m.id, userId: client.id, role: "client" },
  });
  return m;
}
it("resolves current Settings profile email from the file owner, omits it for clients, and keeps file authorization", async () => {
  const m = await file();
  await prisma.creationReview.create({
    data: {
      ownerId: owner.id,
      startRequestId: prefix,
      confirmedMatterId: m.id,
      confirmationRequestId: prefix,
      confirmationFingerprint: "synthetic-confirmation-fingerprint",
      confirmedAt: new Date(),
      state: "confirmed",
    },
  });
  expect(await getMatter(agent, m.id)).toHaveProperty(
    "coordinatorEmail",
    owner.email,
  );
  await prisma.user.update({
    where: { id: owner.id },
    data: { email: prefix + "updated@example.test" },
  });
  expect(await getMatter(agent, m.id)).toHaveProperty(
    "coordinatorEmail",
    prefix + "updated@example.test",
  );
  expect(await getMatter(client, m.id)).not.toHaveProperty("coordinatorEmail");
  await expect(
    getMatter({ ...agent, id: "unrelated-agent" }, m.id),
  ).rejects.toMatchObject({ status: 404 });
  await prisma.user.update({
    where: { id: owner.id },
    data: { email: owner.email },
  });
});
it("uses the recorded confirming coordinator for older files and never picks an arbitrary other account", async () => {
  const m = await file({
    fileReview: { status: "confirmed", confirmedById: owner.id },
  });
  expect(await getMatter(agent, m.id)).toHaveProperty(
    "coordinatorEmail",
    owner.email,
  );
  const old = await file({
    fileReview: { status: "confirmed", confirmedById: agent.id },
  });
  const other = await prisma.user.create({
    data: {
      id: prefix + "other",
      name: "Other coordinator",
      email: prefix + "other@example.test",
      role: "coordinator",
    },
  });
  try {
    expect(await getMatter(agent, old.id)).toHaveProperty(
      "coordinatorEmail",
      "ireland@weatherlytc.com",
    );
  } finally {
    await prisma.user.delete({ where: { id: other.id } });
  }
});
