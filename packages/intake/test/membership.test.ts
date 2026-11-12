import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import { submitIntake } from "../src";
import { startCreationReview } from "../src/creation-review/storage";
import { completedReference } from "./reference-fixture";

async function actor(role: Principal["role"]): Promise<Principal> {
  const id = randomUUID();
  const user = { id, name: "Synthetic", email: `${id}@example.test`, role };
  await prisma.user.create({ data: user });
  return { ...user, sessionId: id };
}

it("resolves HTO intake from the submitting agent and preserves the receipt and gift", async () => {
  const agent = await actor("agent");
  const coordinator = await actor("coordinator");
  const roster = await prisma.rosterAgent.create({
    data: { name: agent.name, userId: agent.id, business: "hto" },
  });
  const reference = completedReference("buyer");
  const { service, ...fields } = reference.fields;
  const gift = { requested: true, tier: "classic", choice: "Gift Option 1" };
  const draft = await prisma.intakeDraft.create({
    data: {
      userId: agent.id,
      payload: {
        packageCode: "essentials",
        side: "buyer",
        propertyAddress: "100 Synthetic Road",
        purchaseType: "cash",
        contractSource: "upload",
        documentIds: [],
        clients: [],
        directContact: "copy_agent",
        title: { choice: "have" },
        hoa: "none",
        gift,
        referenceIntake: {
          ...reference,
          fields: {
            ...fields,
            contractLocation: "Synthetic contract location",
            gift: "yes",
            tier: "Classic",
            giftOpt: "Gift Option 1",
            giftAgree: true,
          },
        },
      },
    },
  });
  const input = { expectedRevision: 1, idempotencyKey: randomUUID() };
  const result = await submitIntake(agent, draft.id, input);
  expect(result.matter).toMatchObject({
    stage: "pending_review",
    business: "hto",
    packageCode: "hto_included",
    agentRosterId: roster.id,
  });
  expect(result.submission).toMatchObject({
    processedAt: null,
    business: "hto",
    matterId: result.matter.id,
    snapshot: { business: "hto", packageCode: "hto_included", gift },
  });
  expect(result.submission.snapshot).not.toHaveProperty("serviceSnapshot");
  const review = await startCreationReview(coordinator, {
    intakeId: result.submission.id,
    requestId: randomUUID(),
  });
  expect(review).toMatchObject({
    business: { business: "hto", packageCode: "hto_included" },
    facts: { agentId: agent.id, agentRosterId: roster.id },
  });
  await prisma.rosterAgent.update({
    where: { id: roster.id },
    data: { archivedAt: new Date() },
  });
  const replay = await submitIntake(agent, draft.id, input);
  expect(replay.submission.id).toBe(result.submission.id);
  expect(replay.submission.snapshot).toEqual(result.submission.snapshot);
});

it("rejects an HTO classification supplied in a Weatherly draft body", async () => {
  const agent = await actor("agent");
  const draft = await prisma.intakeDraft.create({
    data: {
      userId: agent.id,
      payload: { packageCode: "hto_included", business: "hto" },
    },
  });
  await expect(
    submitIntake(agent, draft.id, {
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({
    issues: expect.arrayContaining([
      expect.objectContaining({ path: ["packageCode"] }),
    ]),
  });
  expect(
    await prisma.intakeSubmission.count({ where: { draftId: draft.id } }),
  ).toBe(0);
});
