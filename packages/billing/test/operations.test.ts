import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { prisma } from "@weatherly/db";
import { type Principal } from "@weatherly/platform";
import {
  quoteGift,
  fulfillGift,
  refundPayment,
  reconcilePayment,
} from "../src/operations";
import { createCheckout } from "../src/service";
const id = `gift-test-${randomUUID()}`;
const actor: Principal = {
  id,
  name: "Synthetic",
  email: `${id}@example.test`,
  role: "coordinator",
  sessionId: "test",
};
let orderId: string;
beforeAll(async () => {
  await prisma.matter.create({
    data: {
      id,
      title: "Synthetic gift",
      propertyAddress: "1 Test Lane",
      side: "buyer",
      packageCode: "complete",
    },
  });
  await prisma.giftOrder.create({
    data: {
      id,
      matterId: id,
      selection: { requested: true },
      status: "awaiting_catalog",
    },
  });
});
afterAll(async () => {
  await prisma.giftOrder.deleteMany({ where: { matterId: id } });
  await prisma.paymentOrder.deleteMany({ where: { matterId: id } });
  await prisma.auditEvent.deleteMany({
    where: { OR: [{ actorId: id }, { matterId: id }] },
  });
  await prisma.matter.delete({ where: { id } });
});
const create = vi.fn(async () => ({
  id: `cs_${id}`,
  url: "https://checkout.stripe.com/synthetic",
  status: "open",
}));
const refunds = vi.fn(async () => ({ id: `re_${id}`, status: "succeeded" }));
const provider = async () =>
  ({
    checkout: {
      sessions: {
        create,
        retrieve: async () => ({
          id: `cs_${id}`,
          url: "https://checkout.stripe.com/synthetic",
          status: "open",
        }),
      },
    },
    refunds: { create: refunds },
  }) as unknown as Stripe;
it("requires an explicit reviewed quote and refuses premature fulfillment", async () => {
  await expect(
    createCheckout(
      actor,
      {
        matterId: id,
        kind: "gift",
        giftOrderId: id,
        idempotencyKey: "test-gift",
      },
      provider,
    ),
  ).rejects.toMatchObject({ code: "GIFT_UNAPPROVED" });
  await expect(
    fulfillGift(actor, id, { revision: 1, status: "ordered", note: "Attempt" }),
  ).rejects.toMatchObject({ code: "GIFT_PAYMENT_REQUIRED" });
  await quoteGift(actor, id, {
    revision: 1,
    description: "Synthetic approved gift",
    amountCents: 6500,
    currency: "USD",
    policy: "Synthetic explicit fulfillment and refund policy.",
    approved: true,
  });
  await expect(
    quoteGift(actor, id, {
      revision: 1,
      description: "Stale",
      amountCents: 1,
      currency: "USD",
      policy: "Synthetic policy",
      approved: true,
    }),
  ).rejects.toBeDefined();
});
it("snapshots the approved quote, reuses checkout and locks paid quotes", async () => {
  const order = await createCheckout(
    actor,
    {
      matterId: id,
      kind: "gift",
      giftOrderId: id,
      idempotencyKey: "test-gift",
    },
    provider,
  );
  orderId = order.id;
  const repeated = await createCheckout(
    actor,
    {
      matterId: id,
      kind: "gift",
      giftOrderId: id,
      idempotencyKey: "repeated-key",
    },
    provider,
  );
  expect(repeated.id).toBe(orderId);
  expect(create).toHaveBeenCalledTimes(1);
  const saved = await prisma.paymentOrder.findUniqueOrThrow({
    where: { id: orderId },
  });
  expect(saved.amountCents).toBe(6500);
  expect(saved.snapshot).toMatchObject({ giftOrderId: id, amountCents: 6500 });
  await expect(
    quoteGift(actor, id, {
      revision: 3,
      description: "Changed",
      amountCents: 7000,
      currency: "USD",
      policy: "Synthetic policy",
      approved: true,
    }),
  ).rejects.toMatchObject({ code: "GIFT_CHANGED" });
});
it("requires verified payment and ordered-before-delivered with revision protection", async () => {
  await expect(
    fulfillGift(actor, id, { revision: 3, status: "ordered", note: "Attempt" }),
  ).rejects.toMatchObject({ code: "GIFT_PAYMENT_REQUIRED" });
  await prisma.paymentOrder.update({
    where: { id: orderId },
    data: { status: "paid", stripePaymentIntentId: `pi_${id}` },
  });
  await expect(
    fulfillGift(actor, id, {
      revision: 3,
      status: "delivered",
      note: "Attempt",
    }),
  ).rejects.toMatchObject({ code: "GIFT_TRANSITION" });
  const ordered = await fulfillGift(actor, id, {
    revision: 3,
    status: "ordered",
    note: "Placed with approved supplier",
  });
  expect(ordered.status).toBe("ordered");
  await expect(
    fulfillGift(actor, id, { revision: 3, status: "delivered", note: "Stale" }),
  ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  expect(
    (
      await fulfillGift(actor, id, {
        revision: 4,
        status: "delivered",
        note: "Delivery confirmed",
      })
    ).status,
  ).toBe("delivered");
});
it("enforces refund authorization/amount and idempotency without inventing settled state", async () => {
  await expect(
    refundPayment(
      { ...actor, role: "agent" },
      orderId,
      {
        amountCents: 100,
        reason: "Test",
        idempotencyKey: "refund-test",
        confirmed: true,
      },
      provider,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    refundPayment(
      actor,
      orderId,
      {
        amountCents: 7000,
        reason: "Test",
        idempotencyKey: "refund-test",
        confirmed: true,
      },
      provider,
    ),
  ).rejects.toMatchObject({ code: "REFUND_UNAVAILABLE" });
  await refundPayment(
    actor,
    orderId,
    {
      amountCents: 100,
      reason: "Test",
      idempotencyKey: "refund-test",
      confirmed: true,
    },
    provider,
  );
  await refundPayment(
    actor,
    orderId,
    {
      amountCents: 100,
      reason: "Test",
      idempotencyKey: "refund-test",
      confirmed: true,
    },
    provider,
  );
  expect(refunds).toHaveBeenCalledTimes(1);
  expect(
    (await prisma.paymentOrder.findUniqueOrThrow({ where: { id: orderId } }))
      .status,
  ).toBe("paid");
});
