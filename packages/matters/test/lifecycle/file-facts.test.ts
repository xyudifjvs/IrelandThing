import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import { registerMatterChangeHook } from "../../src/change-hook";
import { updateFileFacts } from "../../src/commands/file-facts";

async function user(role: Principal["role"]): Promise<Principal> {
  const id = randomUUID();
  const actor = { id, name: "Synthetic", email: `${id}@example.test`, role };
  await prisma.user.create({ data: actor });
  return { ...actor, sessionId: id };
}

async function matter(input: {
  stage: string;
  business: "hto" | "weatherly";
  agentId?: string;
}) {
  return prisma.matter.create({
    data: {
      ...input,
      title: "Old Address",
      propertyAddress: "Old Address",
      side: "buyer",
      packageCode: input.business === "hto" ? "hto_included" : "complete",
      purchasePriceCents: 12500000,
      checklistVersion: 1,
      details: {
        fileReview: { status: "confirmed" },
        checklistDateAnchors: { remedies: { date: "2026-12-01" } },
        referenceIntake: { fields: { notes: "original" } },
      },
    },
  });
}

it("updates canonical HTO facts while preserving the intake, checklist, and client audiences", async () => {
  const coordinator = await user("coordinator");
  const agent = await user("agent");
  const file = await matter({
    stage: "closed",
    business: "hto",
    agentId: agent.id,
  });
  const roster = await prisma.rosterAgent.create({
    data: { name: "Name only", business: "hto" },
  });
  const task = await prisma.task.create({
    data: {
      matterId: file.id,
      title: "Buyer closing",
      stepKey: "closing",
      dateCapable: true,
      dueDate: "2026-12-20",
      status: "completed",
      actualDate: "2026-12-21",
    },
  });
  const receipt = await prisma.intakeSubmission.create({
    data: {
      draftId: randomUUID(),
      idempotencyKey: randomUUID(),
      userId: agent.id,
      matterId: file.id,
      snapshot: { propertyAddress: file.propertyAddress, side: file.side },
      processedAt: new Date(),
    },
  });
  const retained = await prisma.matterContact.create({
    data: {
      matterId: file.id,
      role: "buyer",
      name: "Original Client",
      shareWithAgent: true,
    },
  });
  const retired = await prisma.matterContact.create({
    data: {
      matterId: file.id,
      role: "client",
      name: "Removed Client",
      shareWithClient: true,
    },
  });
  const lender = await prisma.matterContact.create({
    data: { matterId: file.id, role: "lender", name: "Lender" },
  });
  const address = {
    street: "21 New Address",
    city: "Columbus",
    state: "OH",
    zip: "43215",
  };
  const result = await prisma.$transaction((tx) =>
    updateFileFacts(tx, coordinator, file.id, {
      expectedRevision: file.revision,
      agentRosterId: roster.id,
      address,
      clients: [
        {
          id: retained.id,
          firstName: "Mary Ann",
          lastName: "Example",
          email: "mary@example.test",
          phone: "555-0191",
        },
        { firstName: "Name-only", lastName: "", email: "", phone: "" },
      ],
      side: "seller",
      purchasePriceCents: 0,
    }),
  );
  expect(result).toEqual({ matterId: file.id, revision: file.revision + 1 });
  const updated = await prisma.matter.findUniqueOrThrow({
    where: { id: file.id },
  });
  expect(updated).toMatchObject({
    stage: "closed",
    business: "hto",
    side: "seller",
    agentRosterId: roster.id,
    agentId: null,
    title: "21 New Address, Columbus, OH 43215",
    propertyAddress: "21 New Address, Columbus, OH 43215",
    details: {
      ...(file.details as Record<string, unknown>),
      structuredAddress: address,
      structuredClientNames: {
        [retained.id]: { firstName: "Mary Ann", lastName: "Example" },
      },
    },
  });
  expect(updated.purchasePriceCents?.toNumber()).toBe(0);
  expect(await prisma.task.findUnique({ where: { id: task.id } })).toEqual(
    task,
  );
  expect(
    await prisma.intakeSubmission.findUnique({ where: { id: receipt.id } }),
  ).toEqual(receipt);
  expect(
    await prisma.matterContact.findUnique({ where: { id: retained.id } }),
  ).toMatchObject({
    role: "buyer",
    name: "Mary Ann Example",
    shareWithAgent: true,
    shareWithClient: false,
  });
  expect(
    await prisma.matterContact.findUnique({ where: { id: retired.id } }),
  ).toMatchObject({
    name: "Removed Client",
    retiredAt: expect.any(Date),
    shareWithClient: true,
  });
  expect(
    await prisma.matterContact.findUnique({ where: { id: lender.id } }),
  ).toEqual(lender);
  expect(
    await prisma.matterContact.findFirst({
      where: { matterId: file.id, name: "Name-only" },
    }),
  ).toMatchObject({
    role: "client",
    shareWithAgent: false,
    shareWithClient: false,
  });
  expect(
    await prisma.auditEvent.findFirst({
      where: { matterId: file.id, action: "matter.facts_updated" },
    }),
  ).toMatchObject({
    details: { previousPurchasePriceCents: 12500000, purchasePriceCents: 0 },
  });
});

it("rejects a stale update, foreign client ID, and a non-HTO terminal file", async () => {
  const coordinator = await user("coordinator");
  const agent = await user("agent");
  const file = await matter({ stage: "under_contract", business: "hto" });
  const other = await matter({ stage: "closed", business: "weatherly" });
  const client = await prisma.matterContact.create({
    data: { matterId: other.id, role: "client", name: "Other Client" },
  });
  const patch = {
    expectedRevision: file.revision,
    purchasePriceCents: 18000000,
  };
  await expect(
    prisma.$transaction((tx) => updateFileFacts(tx, agent, file.id, patch)),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    prisma.$transaction((tx) =>
      updateFileFacts(tx, coordinator, file.id, {
        ...patch,
        clients: [
          {
            id: client.id,
            firstName: "Wrong",
            lastName: "Matter",
            email: "",
            phone: "",
          },
        ],
      }),
    ),
  ).rejects.toMatchObject({ code: "INVALID_FILE_CLIENT" });
  await expect(
    prisma.$transaction((tx) =>
      updateFileFacts(tx, coordinator, other.id, patch),
    ),
  ).rejects.toMatchObject({ code: "FILE_FACTS_UNAVAILABLE" });
  const outcomes = await Promise.allSettled([
    prisma.$transaction((tx) =>
      updateFileFacts(tx, coordinator, file.id, patch),
    ),
    prisma.$transaction((tx) =>
      updateFileFacts(tx, coordinator, file.id, patch),
    ),
  ]);
  expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(
    1,
  );
  expect(outcomes.filter(({ status }) => status === "rejected")).toEqual([
    expect.objectContaining({
      reason: expect.objectContaining({ code: "REVISION_CONFLICT" }),
    }),
  ]);
  expect(
    await prisma.auditEvent.count({
      where: { matterId: file.id, action: "matter.facts_updated" },
    }),
  ).toBe(1);
});

it("rolls back fact and contact changes if the transaction hook fails", async () => {
  const coordinator = await user("coordinator");
  const file = await matter({ stage: "under_contract", business: "hto" });
  registerMatterChangeHook(async () => {
    throw Error("test change hook");
  });
  try {
    await expect(
      prisma.$transaction((tx) =>
        updateFileFacts(tx, coordinator, file.id, {
          expectedRevision: file.revision,
          propertyAddress: "Changed Address",
          clients: [
            {
              firstName: "Synthetic",
              lastName: "Client",
              email: "",
              phone: "",
            },
          ],
        }),
      ),
    ).rejects.toThrow("test change hook");
    expect(await prisma.matter.findUnique({ where: { id: file.id } })).toEqual(
      file,
    );
    expect(
      await prisma.matterContact.count({ where: { matterId: file.id } }),
    ).toBe(0);
    expect(
      await prisma.auditEvent.count({ where: { matterId: file.id } }),
    ).toBe(0);
  } finally {
    registerMatterChangeHook();
  }
});
