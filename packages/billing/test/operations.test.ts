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
  await expect(
    refundPayment(
      actor,
      orderId,
      {
        amountCents: 200,
        reason: "Test",
        idempotencyKey: "refund-test",
        confirmed: true,
      },
      provider,
    ),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect(
    (await prisma.paymentOrder.findUniqueOrThrow({ where: { id: orderId } }))
      .status,
  ).toBe("paid");
});
it("reserves before dispatch and keeps ambiguous refunds from fulfillment or over-refunding", async () => {
  const payment = await prisma.paymentOrder.create({
    data: {
      matterId: id,
      createdById: id,
      idempotencyKey: `reserve-${id}`,
      amountCents: 6500,
      currency: "USD",
      status: "paid",
      stripePaymentIntentId: `pi_reserve_${id}`,
      snapshot: {},
      details: { paymentEnvironment: "test" },
    },
  });
  const gift = await prisma.giftOrder.create({
    data: {
      matterId: id,
      paymentOrderId: payment.id,
      selection: {},
      status: "paid",
    },
  });
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  const uncertain = vi.fn(async () => {
    entered();
    await gate;
    throw new Error("Response lost after acceptance");
  });
  const fake = async () =>
    ({ refunds: { create: uncertain } }) as unknown as Stripe;
  const pending = refundPayment(
    actor,
    payment.id,
    {
      amountCents: 4000,
      reason: "Synthetic",
      idempotencyKey: "uncertain-refund",
      confirmed: true,
    },
    fake,
  ).catch((e) => e);
  await started;
  await expect(
    fulfillGift(actor, gift.id, {
      revision: 1,
      status: "ordered",
      note: "Attempt during refund",
    }),
  ).rejects.toMatchObject({ code: "REFUND_HOLD" });
  await expect(
    refundPayment(
      actor,
      payment.id,
      {
        amountCents: 4000,
        reason: "Synthetic",
        idempotencyKey: "second-refund",
        confirmed: true,
      },
      fake,
    ),
  ).rejects.toMatchObject({ code: "REFUND_UNAVAILABLE" });
  release();
  expect(await pending).toMatchObject({ code: "REFUND_UNCERTAIN" });
  const repeat = await refundPayment(
    actor,
    payment.id,
    {
      amountCents: 4000,
      reason: "Synthetic",
      idempotencyKey: "uncertain-refund",
      confirmed: true,
    },
    fake,
  );
  expect(repeat.status).toBe("reserved");
  expect(uncertain).toHaveBeenCalledTimes(1);
  await expect(
    fulfillGift(actor, gift.id, {
      revision: 1,
      status: "ordered",
      note: "Attempt after uncertain refund",
    }),
  ).rejects.toMatchObject({ code: "REFUND_HOLD" });
});
it("separately reserves Dashboard and local refunds until provider evidence proves overlap", async () => {
  const payment = await prisma.paymentOrder.create({
    data: {
      matterId: id,
      createdById: id,
      idempotencyKey: `mixed-${id}`,
      amountCents: 6500,
      currency: "USD",
      status: "partially_refunded",
      stripeSessionId: `cs_mixed_${id}`,
      stripePaymentIntentId: `pi_mixed_${id}`,
      snapshot: {},
      details: { refundedCents: 1000, paymentEnvironment: "test" },
    },
  });
  const session = {
    id: payment.stripeSessionId,
    status: "complete",
    payment_status: "paid",
    amount_total: 6500,
    currency: "usd",
    livemode: false,
    metadata: { paymentOrderId: payment.id },
    payment_intent: payment.stripePaymentIntentId,
  };
  const charge = {
    id: `ch_mixed_${id}`,
    payment_intent: payment.stripePaymentIntentId,
    amount_refunded: 2000,
    refunded: false,
    livemode: false,
  };
  const accepted: unknown[] = [];
  const createRefund = vi.fn(
    async (input: { amount: number; metadata: object }) => {
      const result = {
        id: `re_mixed_${accepted.length}_${id}`,
        amount: input.amount,
        metadata: input.metadata,
        status: "succeeded",
      };
      accepted.push(result);
      return result;
    },
  );
  const fake = async () =>
    ({
      checkout: { sessions: { retrieve: async () => session } },
      paymentIntents: { retrieve: async () => ({ latest_charge: charge }) },
      refunds: {
        create: createRefund,
        list: async () => ({
          has_more: false,
          data: [
            {
              id: `re_dashboard_${id}`,
              amount: 1000,
              status: "succeeded",
              metadata: {},
            },
            ...accepted,
          ],
        }),
      },
    }) as unknown as Stripe;
  await refundPayment(
    actor,
    payment.id,
    {
      amountCents: 1000,
      reason: "Distinct local refund",
      idempotencyKey: "mixed-local-refund",
      confirmed: true,
    },
    fake,
  );
  await expect(
    refundPayment(
      actor,
      payment.id,
      {
        amountCents: 5000,
        reason: "Would exceed combined refunds",
        idempotencyKey: "mixed-over-refund",
        confirmed: true,
      },
      fake,
    ),
  ).rejects.toMatchObject({ code: "REFUND_UNAVAILABLE" });
  expect(createRefund).toHaveBeenCalledTimes(1);
  const reconciled = await reconcilePayment(actor, payment.id, fake);
  expect(reconciled.details).toMatchObject({
    refundedCents: 2000,
    refundRequests: [{ amountCents: 1000, accounted: true }],
  });
  await refundPayment(
    actor,
    payment.id,
    {
      amountCents: 4500,
      reason: "Exact remaining balance",
      idempotencyKey: "mixed-remaining-refund",
      confirmed: true,
    },
    fake,
  );
  expect(createRefund).toHaveBeenCalledTimes(2);
});
it("expires unpaid gift checkout before cancelling and refuses later URL reuse", async () => {
  const gift = await prisma.giftOrder.create({
    data: { matterId: id, selection: {}, status: "awaiting_catalog" },
  });
  await quoteGift(actor, gift.id, {
    revision: 1,
    description: "Synthetic cancellation",
    amountCents: 6500,
    currency: "USD",
    policy: "Synthetic cancellation policy",
    approved: true,
  });
  const session = {
    id: `cs_cancel_${id}`,
    url: "https://checkout.stripe.com/synthetic",
    status: "open",
  };
  const expire = vi.fn(async () => ({ ...session, status: "expired" }));
  const fake = async () =>
    ({
      checkout: {
        sessions: {
          create: async () => session,
          retrieve: async () => session,
          expire,
        },
      },
    }) as unknown as Stripe;
  await createCheckout(
    actor,
    {
      matterId: id,
      kind: "gift",
      giftOrderId: gift.id,
      idempotencyKey: "cancel-gift",
    },
    fake,
  );
  const result = await fulfillGift(
    actor,
    gift.id,
    { revision: 3, status: "cancelled", note: "Cancellation before payment" },
    fake,
  );
  expect(result.status).toBe("cancelled");
  expect(expire).toHaveBeenCalledTimes(1);
  await expect(
    createCheckout(
      actor,
      {
        matterId: id,
        kind: "gift",
        giftOrderId: gift.id,
        idempotencyKey: "cancelled-retry",
      },
      fake,
    ),
  ).rejects.toMatchObject({ code: "GIFT_CLOSED" });
});
