import { createHash } from "node:crypto";
import Stripe from "stripe";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import { requireMatter, audit } from "@weatherly/matters";
import { verifiedStripe, applyStripeEvent } from "./service";

export async function quoteGift(actor: Principal, id: string, raw: unknown) {
  assertCoordinator(actor);
  const input = z
    .object({
      revision: z.number().int().positive(),
      description: z.string().trim().min(1).max(500),
      amountCents: z.number().int().min(50).max(1000000),
      currency: z.literal("USD"),
      policy: z.string().trim().min(10).max(3000),
      approved: z.literal(true),
    })
    .strict()
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "GiftOrder" WHERE id=${id} FOR UPDATE`;
    const gift = await tx.giftOrder.findUnique({ where: { id } });
    if (!gift) throw new HttpError(404, "NOT_FOUND", "Gift request not found.");
    await requireMatter(actor, gift.matterId, false, tx);
    if (
      gift.revision !== input.revision ||
      gift.paymentOrderId ||
      !["requested", "awaiting_catalog", "quoted"].includes(gift.status)
    )
      throw new HttpError(
        409,
        "GIFT_CHANGED",
        "A quoted payment or changed gift must be reviewed before editing.",
      );
    const { revision, approved, ...quote } = input;
    const result = await tx.giftOrder.update({
      where: { id },
      data: {
        status: "quoted",
        revision: { increment: 1 },
        selection: {
          ...(gift.selection as Record<string, Prisma.InputJsonValue>),
          approvedQuote: {
            ...quote,
            approvedById: actor.id,
            approvedAt: new Date().toISOString(),
          },
        },
      },
    });
    await audit(
      tx,
      actor,
      "gift.quote_approved",
      "GiftOrder",
      id,
      gift.matterId,
      { amountCents: quote.amountCents, revision: result.revision },
    );
    return result;
  });
}
export async function fulfillGift(actor: Principal, id: string, raw: unknown) {
  assertCoordinator(actor);
  const input = z
    .object({
      revision: z.number().int().positive(),
      status: z.enum(["ordered", "delivered", "cancelled"]),
      note: z.string().trim().min(1).max(2000),
    })
    .strict()
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "GiftOrder" WHERE id=${id} FOR UPDATE`;
    const gift = await tx.giftOrder.findUnique({ where: { id } });
    if (!gift) throw new HttpError(404, "NOT_FOUND", "Gift request not found.");
    await requireMatter(actor, gift.matterId, false, tx);
    if (gift.revision !== input.revision)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "This gift changed. Reload it.",
      );
    const payment = gift.paymentOrderId
      ? await tx.paymentOrder.findUnique({ where: { id: gift.paymentOrderId } })
      : null;
    if (input.status !== "cancelled" && payment?.status !== "paid")
      throw new HttpError(
        409,
        "GIFT_PAYMENT_REQUIRED",
        "A verified full payment is required before ordering or delivery.",
      );
    if (
      input.status === "ordered" &&
      !["awaiting_payment", "paid"].includes(gift.status)
    )
      throw new HttpError(
        409,
        "GIFT_TRANSITION",
        "This gift cannot be ordered from its current state.",
      );
    if (input.status === "delivered" && gift.status !== "ordered")
      throw new HttpError(
        409,
        "GIFT_TRANSITION",
        "Mark the gift ordered before delivery.",
      );
    if (["delivered", "cancelled"].includes(gift.status))
      throw new HttpError(409, "GIFT_CLOSED", "This gift has already closed.");
    const result = await tx.giftOrder.update({
      where: { id },
      data: {
        status: input.status,
        revision: { increment: 1 },
        selection: {
          ...(gift.selection as Record<string, Prisma.InputJsonValue>),
          fulfillment: {
            status: input.status,
            note: input.note,
            updatedAt: new Date().toISOString(),
          },
        },
      },
    });
    await audit(
      tx,
      actor,
      `gift.${input.status}`,
      "GiftOrder",
      id,
      gift.matterId,
      { note: input.note },
    );
    return result;
  });
}
export async function refundPayment(
  actor: Principal,
  id: string,
  raw: unknown,
  provider = verifiedStripe,
) {
  assertCoordinator(actor);
  const input = z
    .object({
      amountCents: z.number().int().positive(),
      reason: z.string().trim().min(1).max(1000),
      idempotencyKey: z.string().min(8).max(120),
      confirmed: z.literal(true),
    })
    .strict()
    .parse(raw);
  const stripe = await provider();
  // Keep a database lock during the bounded provider call: two partial refunds
  // cannot both pass the same remaining-balance check. Stripe also validates it.
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${id}`}))`;
      const order = await tx.paymentOrder.findUnique({ where: { id } });
      if (!order) throw new HttpError(404, "NOT_FOUND", "Payment not found.");
      await requireMatter(actor, order.matterId, false, tx);
      const details = order.details as Record<string, Prisma.InputJsonValue>;
      const prior = await tx.auditEvent.findFirst({
        where: {
          entityId: id,
          action: "payment.refund_requested",
          details: { path: ["idempotencyKey"], equals: input.idempotencyKey },
        },
      });
      if (prior) return { requested: true, receipt: prior.id };
      if (
        !order.stripePaymentIntentId ||
        !["paid", "partially_refunded"].includes(order.status) ||
        input.amountCents >
          order.amountCents - Number(details.refundedCents || 0)
      )
        throw new HttpError(
          409,
          "REFUND_UNAVAILABLE",
          "Review the paid balance before requesting this refund.",
        );
      const refund = await stripe.refunds.create(
        {
          payment_intent: order.stripePaymentIntentId,
          amount: input.amountCents,
          metadata: { paymentOrderId: id },
        },
        { idempotencyKey: `refund:${id}:${input.idempotencyKey}` },
      );
      await audit(
        tx,
        actor,
        "payment.refund_requested",
        "PaymentOrder",
        id,
        order.matterId,
        {
          idempotencyKey: input.idempotencyKey,
          refundId: refund.id,
          amountCents: input.amountCents,
          reason: input.reason,
          providerStatus: refund.status || "unknown",
        },
      );
      return {
        requested: true,
        refundId: refund.id,
        status: refund.status,
        awaitingVerifiedState: true,
      };
    },
    { timeout: 75000 },
  );
}
export async function reconcilePayment(
  actor: Principal,
  id: string,
  provider = verifiedStripe,
) {
  assertCoordinator(actor);
  const order = await prisma.paymentOrder.findUnique({ where: { id } });
  if (!order?.stripeSessionId)
    throw new HttpError(
      404,
      "NOT_FOUND",
      "A Stripe checkout is required before reconciliation.",
    );
  await requireMatter(actor, order.matterId);
  const stripe = await provider();
  const session = await stripe.checkout.sessions.retrieve(
    order.stripeSessionId,
  );
  if (session.metadata?.paymentOrderId !== id)
    throw new HttpError(
      409,
      "PAYMENT_MISMATCH",
      "Stripe metadata does not match this payment.",
    );
  const evidenceId = (data: unknown) =>
    "reconcile-" +
    createHash("sha256").update(JSON.stringify(data)).digest("hex");
  const envelope = {
    object: "event" as const,
    api_version: null,
    created: Math.floor(Date.now() / 1000),
    pending_webhooks: 0,
    request: null,
  };
  await applyStripeEvent({
    ...envelope,
    id: evidenceId(session),
    type:
      session.status === "expired"
        ? "checkout.session.expired"
        : "checkout.session.completed",
    livemode: session.livemode,
    data: { object: session },
  } as Stripe.Event);
  const intentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (intentId) {
    const intent = await stripe.paymentIntents.retrieve(intentId, {
      expand: ["latest_charge"],
    });
    const charge =
      typeof intent.latest_charge === "object" ? intent.latest_charge : null;
    if (charge && charge.amount_refunded > 0)
      await applyStripeEvent({
        ...envelope,
        id: evidenceId(charge),
        type: "charge.refunded",
        livemode: charge.livemode,
        data: { object: charge },
      } as Stripe.Event);
  }
  await audit(
    prisma,
    actor,
    "payment.reconciled",
    "PaymentOrder",
    id,
    order.matterId,
  );
  return prisma.paymentOrder.findUniqueOrThrow({ where: { id } });
}
