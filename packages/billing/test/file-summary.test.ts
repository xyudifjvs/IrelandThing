import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import {
  accountFileSummary,
  listAccountObligations,
} from "../src/file-summary";
import { listAccountPayments } from "../src/account";
import { listGifts, listPayments } from "../src/records";
import { applyStripeEvent } from "../src/webhooks";

const nonce = randomUUID();
const actor = (role: Principal["role"], label: string): Principal => ({
  id: `${label}-${nonce}`,
  email: `${label}-${nonce}@example.test`,
  name: label,
  role,
  sessionId: nonce,
});
const agent = actor("agent", "agent"),
  owner = actor("coordinator", "coordinator"),
  other = actor("agent", "other");
const weatherlyId = "file-weatherly-" + nonce;
const htoId = "file-hto-" + nonce;
const terminatedId = "file-terminated-" + nonce;
const orderId = "service-" + nonce;
const giftOrderId = "gift-" + nonce;
const eventId = "evt_file_summary_" + nonce;
const files = [weatherlyId, htoId, terminatedId];
const terms = {
  code: "essentials",
  name: "Frozen Essentials",
  priceCents: 42500,
  currency: "USD",
  revision: 1,
  internalEvidence: "hidden",
};

beforeAll(async () => {
  vi.stubEnv("STRIPE_MODE", "test");
  await prisma.user.createMany({
    data: [agent, owner, other].map(({ id, email, role, name }) => ({
      id,
      email,
      role,
      name,
    })),
  });
  await prisma.matter.createMany({
    data: files.map((id, index) => ({
      id,
      agentId: agent.id,
      propertyAddress: `${index + 1} Synthetic Lane`,
      title: "Synthetic file",
      side: "buyer",
      stage: id === terminatedId ? "terminated" : "under_contract",
      packageCode: id === htoId ? "hto_included" : "essentials",
      business: id === htoId ? "hto" : "weatherly",
      checklistVersion: 1,
      details: { serviceSnapshot: terms },
      createdAt: new Date(2027, 0, index + 1),
    })),
  });
  await prisma.giftOrder.create({
    data: {
      id: giftOrderId,
      matterId: htoId,
      status: "quoted",
      selection: {
        privateRecipientAddress: "Hidden",
        approvedQuote: {
          description: "Synthetic gift",
          amountCents: 6800,
          currency: "USD",
          policy: "Private terms",
          approvedById: owner.id,
        },
      },
    },
  });
});

afterAll(async () => {
  await prisma.webhookReceipt.deleteMany({ where: { eventId } });
  await prisma.giftOrder.deleteMany({ where: { matterId: { in: files } } });
  await prisma.paymentOrder.deleteMany({ where: { matterId: { in: files } } });
  await prisma.matter.deleteMany({ where: { id: { in: files } } });
  await prisma.user.deleteMany({
    where: { id: { in: [agent.id, owner.id, other.id] } },
  });
  vi.unstubAllEnvs();
});

it("shows frozen terms and approved gifts under scoped authorization and paginates past fee-free files", async () => {
  await expect(
    accountFileSummary(other, { matterId: weatherlyId }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    accountFileSummary({ ...agent, role: "client" }, { matterId: weatherlyId }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    listAccountObligations(other, { cursor: htoId }),
  ).rejects.toMatchObject({ status: 404 });
  const summary = await accountFileSummary(agent, { matterId: weatherlyId });
  expect(summary).toEqual({
    matterId: weatherlyId,
    propertyAddress: "1 Synthetic Lane",
    service: {
      name: "Frozen Essentials",
      amountCents: 42500,
      currency: "USD",
      status: "due_at_closing",
      paidAt: null,
    },
    gift: null,
  });
  expect(await accountFileSummary(agent, { matterId: htoId })).toEqual({
    matterId: htoId,
    propertyAddress: "2 Synthetic Lane",
    service: null,
    gift: {
      name: "Synthetic gift",
      amountCents: 6800,
      currency: "USD",
      status: "quoted",
      paidAt: null,
    },
  });
  expect(JSON.stringify(await listGifts(agent, htoId))).not.toMatch(
    /privateRecipientAddress|approvedById|Private terms/,
  );
  expect(await listAccountObligations(agent, { limit: "1" })).toEqual({
    items: [],
    nextCursor: terminatedId,
  });
  expect(
    (
      await listAccountObligations(agent, { cursor: terminatedId, limit: 1 })
    ).items.map(({ matterId }) => matterId),
  ).toEqual([htoId]);
});

it("shows verified paid dates and excludes a represented fee from the obligations list", async () => {
  const order = await prisma.paymentOrder.create({
    data: {
      id: orderId,
      matterId: weatherlyId,
      createdById: owner.id,
      idempotencyKey: nonce,
      status: "pending",
      kind: "service",
      amountCents: 42500,
      currency: "USD",
      snapshot: terms,
      stripeSessionId: "cs_test_summary_" + nonce,
      details: { paymentEnvironment: "test" },
    },
  });
  const confirmedAt = Math.floor(Date.now() / 1000) - 10;
  const event = {
    id: eventId,
    created: confirmedAt,
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: order.stripeSessionId,
        payment_status: "paid",
        metadata: { paymentOrderId: orderId },
        amount_total: 42500,
        currency: "usd",
        status: "complete",
        payment_intent: "pi_summary_" + nonce,
      },
    },
  } as unknown as Stripe.Event;
  await applyStripeEvent(event);
  await applyStripeEvent(event);
  const paidAt = new Date(confirmedAt * 1000).toISOString();
  expect(
    (await accountFileSummary(agent, { matterId: weatherlyId })).service,
  ).toMatchObject({ status: "paid", paidAt });
  expect(
    (await listAccountPayments(agent)).items.find(({ id }) => id === orderId)
      ?.paidAt,
  ).toBe(paidAt);
  expect(JSON.stringify(await listPayments(agent, weatherlyId))).not.toMatch(
    /stripeSessionId|idempotencyKey|internalEvidence/,
  );
  expect(
    (await listAccountObligations(agent, {})).items.map(
      ({ matterId }) => matterId,
    ),
  ).toEqual([htoId]);
});
