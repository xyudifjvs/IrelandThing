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
export async function fulfillGift(
  actor: Principal,
  id: string,
  raw: unknown,
  provider = verifiedStripe,
) {
  assertCoordinator(actor);
  const input = z
    .object({
      revision: z.number().int().positive(),
      status: z.enum(["ordered", "delivered", "cancelled"]),
      note: z.string().trim().min(1).max(2000),
    })
    .strict()
    .parse(raw);
  const snapshot = await prisma.giftOrder.findUnique({ where: { id } });
  return prisma.$transaction(
    async (tx) => {
      if (snapshot?.paymentOrderId)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${snapshot.paymentOrderId}`}))`;
      await tx.$queryRaw`SELECT id FROM "GiftOrder" WHERE id=${id} FOR UPDATE`;
      const gift = await tx.giftOrder.findUnique({ where: { id } });
      if (!gift)
        throw new HttpError(404, "NOT_FOUND", "Gift request not found.");
      await requireMatter(actor, gift.matterId, false, tx);
      if (gift.paymentOrderId !== snapshot?.paymentOrderId)
        throw new HttpError(
          409,
          "REVISION_CONFLICT",
          "The payment association changed. Reload this gift.",
        );
      if (gift.revision !== input.revision)
        throw new HttpError(
          409,
          "REVISION_CONFLICT",
          "This gift changed. Reload it.",
        );
      const payment = gift.paymentOrderId
        ? await tx.paymentOrder.findUnique({
            where: { id: gift.paymentOrderId },
          })
        : null;
      if (input.status !== "cancelled" && payment?.status !== "paid")
        throw new HttpError(
          409,
          "GIFT_PAYMENT_REQUIRED",
          "A verified full payment is required before ordering or delivery.",
        );
      if (
        input.status !== "cancelled" &&
        payment &&
        refundIntents(payment.details).some(reservesFunds)
      )
        throw new HttpError(
          409,
          "REFUND_HOLD",
          "A refund is reserved or unresolved. This gift cannot be fulfilled.",
        );
      if (
        input.status === "cancelled" &&
        payment &&
        ["creating", "pending"].includes(payment.status)
      ) {
        if (!payment.stripeSessionId)
          throw new HttpError(
            409,
            "PAYMENT_CREATING",
            "The checkout is still being created. Refresh before cancelling.",
          );
        const stripe = await provider();
        const current = await stripe.checkout.sessions.retrieve(
          payment.stripeSessionId,
        );
        if (current.status === "complete")
          throw new HttpError(
            409,
            "PAYMENT_CHANGED",
            "Payment completed. Reconcile it before cancelling this gift.",
          );
        const expired =
          current.status === "open"
            ? await stripe.checkout.sessions.expire(payment.stripeSessionId)
            : current;
        if (expired.status !== "expired")
          throw new HttpError(
            409,
            "PAYMENT_NOT_CANCELLED",
            "Checkout expiry is not confirmed; the gift remains active.",
          );
        await tx.paymentOrder.update({
          where: { id: payment.id },
          data: { status: "expired" },
        });
      }
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
        throw new HttpError(
          409,
          "GIFT_CLOSED",
          "This gift has already closed.",
        );
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
    },
    { timeout: 75000 },
  );
}
type RefundIntent = {
  key: string;
  amountCents: number;
  reason: string;
  status: string;
  createdAt: string;
  refundId?: string;
  accounted?: boolean;
};
function refundIntents(details: Prisma.JsonValue): RefundIntent[] {
  const value = details as { refundRequests?: unknown };
  return Array.isArray(value.refundRequests)
    ? (value.refundRequests as RefundIntent[])
    : [];
}
const reservesFunds = (r: RefundIntent) =>
  !["failed", "canceled"].includes(r.status);
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
  // Reserve durably before crossing the network boundary. A crash or uncertain
  // response must not make the paid balance available for ordering/refunding again.
  const reserved = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${id}`}))`;
    const order = await tx.paymentOrder.findUnique({ where: { id } });
    if (!order) throw new HttpError(404, "NOT_FOUND", "Payment not found.");
    await requireMatter(actor, order.matterId, false, tx);
    const intents = refundIntents(order.details),
      prior = intents.find((r) => r.key === input.idempotencyKey);
    if (prior) {
      if (
        prior.amountCents !== input.amountCents ||
        prior.reason !== input.reason
      )
        throw new HttpError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "This refund key belongs to different request details.",
        );
      return { order, intent: prior, dispatch: false };
    }
    const details = order.details as Record<string, Prisma.InputJsonValue>;
    // Provider-confirmed refunds may include Dashboard requests absent locally.
    // A succeeded local request overlaps that total only after explicit provider
    // reconciliation. Otherwise Dashboard refunds could hide a distinct request.
    const settled = Number(details.refundedCents || 0);
    const unaccounted = intents
      .filter((r) => reservesFunds(r) && !r.accounted)
      .reduce((n, r) => n + r.amountCents, 0);
    const unavailable = settled + unaccounted;
    if (
      !order.stripePaymentIntentId ||
      !["paid", "partially_refunded"].includes(order.status) ||
      input.amountCents > order.amountCents - unavailable
    )
      throw new HttpError(
        409,
        "REFUND_UNAVAILABLE",
        "The paid balance is already refunded or reserved. Reconcile unresolved refunds first.",
      );
    if (intents.length >= 100)
      throw new HttpError(
        409,
        "REFUND_LIMIT",
        "Review this payment in Ireland’s Stripe account.",
      );
    const intent: RefundIntent = {
      key: input.idempotencyKey,
      amountCents: input.amountCents,
      reason: input.reason,
      status: "reserved",
      createdAt: new Date().toISOString(),
    };
    await tx.paymentOrder.update({
      where: { id },
      data: { details: { ...details, refundRequests: [...intents, intent] } },
    });
    await audit(
      tx,
      actor,
      "payment.refund_reserved",
      "PaymentOrder",
      id,
      order.matterId,
      {
        idempotencyKey: input.idempotencyKey,
        amountCents: input.amountCents,
        reason: input.reason,
      },
    );
    return { order, intent, dispatch: true };
  });
  if (!reserved.dispatch)
    return {
      requested: true,
      refundId: reserved.intent.refundId || null,
      status: reserved.intent.status,
      awaitingVerifiedState: true,
    };
  let refund: Stripe.Refund;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: reserved.order.stripePaymentIntentId!,
        amount: input.amountCents,
        metadata: {
          paymentOrderId: id,
          weatherlyRefundKey: input.idempotencyKey,
        },
      },
      { idempotencyKey: `refund:${id}:${input.idempotencyKey}` },
    );
  } catch {
    // Keep the committed reservation. Only verified provider evidence may release it.
    throw new HttpError(
      502,
      "REFUND_UNCERTAIN",
      "The refund result is uncertain. Funds remain reserved; reconcile before any new request or fulfillment.",
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${id}`}))`;
    const current = await tx.paymentOrder.findUniqueOrThrow({ where: { id } });
    const intents = refundIntents(current.details).map((r) =>
      r.key === input.idempotencyKey
        ? { ...r, refundId: refund.id, status: refund.status || "pending" }
        : r,
    );
    await tx.paymentOrder.update({
      where: { id },
      data: {
        details: {
          ...(current.details as Record<string, Prisma.InputJsonValue>),
          refundRequests: intents,
        },
      },
    });
    await audit(
      tx,
      actor,
      "payment.refund_requested",
      "PaymentOrder",
      id,
      current.matterId,
      {
        idempotencyKey: input.idempotencyKey,
        refundId: refund.id,
        amountCents: input.amountCents,
        reason: input.reason,
        providerStatus: refund.status || "pending",
      },
    );
  });
  return {
    requested: true,
    refundId: refund.id,
    status: refund.status,
    awaitingVerifiedState: true,
  };
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
    if (refundIntents(order.details).length) {
      // Match only provider evidence bearing this exact local request key. A
      // missing result remains reserved: absence is not proof of failure.
      const verified: Stripe.Refund[] = [];
      let cursor: string | undefined;
      let complete = false;
      for (let page = 0; page < 20; page++) {
        const result = await stripe.refunds.list({
          payment_intent: intentId,
          limit: 100,
          ...(cursor ? { starting_after: cursor } : {}),
        });
        verified.push(...result.data);
        if (!result.has_more) {
          complete = true;
          break;
        }
        cursor = result.data.at(-1)?.id;
        if (!cursor) break;
      }
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${id}`}))`;
        const current = await tx.paymentOrder.findUniqueOrThrow({
          where: { id },
        });
        const settled = Number(
          (current.details as Record<string, Prisma.JsonValue>).refundedCents ||
            0,
        );
        // Only a complete, consistent provider snapshot proves that a matched
        // succeeded request is included in the already-deducted charge total.
        const correlated = Boolean(
          complete &&
          charge &&
          settled >= charge.amount_refunded &&
          verified
            .filter((r) => r.status === "succeeded")
            .reduce((sum, r) => sum + r.amount, 0) === charge.amount_refunded,
        );
        const intents = refundIntents(current.details).map((request) => {
          const evidence = verified.find(
            (r) =>
              r.metadata?.paymentOrderId === id &&
              r.metadata?.weatherlyRefundKey === request.key &&
              r.amount === request.amountCents,
          );
          return evidence
            ? {
                ...request,
                refundId: evidence.id,
                status: evidence.status || "pending",
                accounted:
                  request.accounted ||
                  (correlated && evidence.status === "succeeded"),
              }
            : request;
        });
        await tx.paymentOrder.update({
          where: { id },
          data: {
            details: {
              ...(current.details as Record<string, Prisma.InputJsonValue>),
              refundRequests: intents,
            },
          },
        });
      });
    }
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
