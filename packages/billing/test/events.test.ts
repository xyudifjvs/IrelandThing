import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { prisma } from "@weatherly/db";
import { applyStripeEvent } from "../src/service";
const id = "billing-test-" + randomUUID();
const eventIds: string[] = [];
function event(type: string, object: unknown): Stripe.Event {
  const eventId = id + "-" + randomUUID();
  eventIds.push(eventId);
  return {
    id: eventId,
    type,
    livemode: false,
    created: Date.now() / 1000,
    data: { object },
  } as Stripe.Event;
}
beforeAll(async () => {
  if (process.env.APP_ENV === "production")
    throw new Error("Tests require an isolated development database");
  vi.stubEnv("STRIPE_MODE", "test");
  await prisma.paymentOrder.create({
    data: {
      id,
      matterId: id,
      createdById: id,
      idempotencyKey: id,
      kind: "service",
      amountCents: 47500,
      currency: "USD",
      status: "pending",
      snapshot: {},
      stripeSessionId: id + "-session",
      stripePaymentIntentId: id + "-intent",
    },
  });
});
afterAll(async () => {
  await prisma.webhookReceipt.deleteMany({
    where: { eventId: { in: eventIds } },
  });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: eventIds } } });
  await prisma.paymentOrder.deleteMany({ where: { id } });
  vi.unstubAllEnvs();
});
describe("payment reconciliation", () => {
  it("deduplicates simultaneous paid events and ignores late expiry", async () => {
    const paid = event("checkout.session.completed", {
      id: id + "-session",
      metadata: { paymentOrderId: id },
      amount_total: 47500,
      currency: "usd",
      payment_status: "paid",
      payment_intent: id + "-intent",
    });
    await Promise.all([applyStripeEvent(paid), applyStripeEvent(paid)]);
    expect(
      await prisma.webhookReceipt.count({ where: { eventId: paid.id } }),
    ).toBe(1);
    await applyStripeEvent(
      event("checkout.session.expired", {
        id: id + "-session",
        metadata: { paymentOrderId: id },
        amount_total: 47500,
        currency: "usd",
        payment_status: "unpaid",
      }),
    );
    expect(
      (await prisma.paymentOrder.findUniqueOrThrow({ where: { id } })).status,
    ).toBe("paid");
  });
  it("rejects tampered amounts without recording receipt", async () => {
    const bad = event("checkout.session.completed", {
      id: id + "-session",
      metadata: { paymentOrderId: id },
      amount_total: 1,
      currency: "usd",
      payment_status: "paid",
    });
    await expect(applyStripeEvent(bad)).rejects.toMatchObject({
      code: "PAYMENT_AMOUNT_MISMATCH",
    });
    expect(
      await prisma.webhookReceipt.count({ where: { eventId: bad.id } }),
    ).toBe(0);
  });
  it("never downgrades a full refund when an old partial refund arrives", async () => {
    await applyStripeEvent(
      event("charge.refunded", {
        id: id + "-charge",
        payment_intent: id + "-intent",
        amount_refunded: 47500,
        refunded: true,
      }),
    );
    await applyStripeEvent(
      event("charge.refunded", {
        id: id + "-charge",
        payment_intent: id + "-intent",
        amount_refunded: 1000,
        refunded: false,
      }),
    );
    const order = await prisma.paymentOrder.findUniqueOrThrow({
      where: { id },
    });
    expect(order.status).toBe("refunded");
    expect((order.details as { refundedCents: number }).refundedCents).toBe(
      47500,
    );
  });
});
