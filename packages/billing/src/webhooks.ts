import type Stripe from "stripe";
import { prisma, type Prisma } from "@weatherly/db";
import { HttpError } from "@weatherly/platform";
import { assertPaymentEvent, assertSavedPaymentEnvironment } from "./mode";
import {
  lockPaymentMatter,
  lockPaymentOrder,
  paymentDetails,
  savedPaidAt,
  savedCheckoutCancellation,
  serviceCheckoutCancellation,
  settledStatuses,
} from "./checkout-policy";
import { queuePaymentCancellation } from "./termination";

export async function applyStripeEvent(event: Stripe.Event) {
  assertPaymentEvent(event);
  const checkoutTypes = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
  ];
  if (
    !checkoutTypes.includes(event.type) &&
    event.type !== "charge.refunded" &&
    event.type !== "charge.dispute.created"
  )
    return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stripe-event:${event.id}`}))`;
    if (
      await tx.webhookReceipt.findUnique({
        where: { provider_eventId: { provider: "stripe", eventId: event.id } },
      })
    )
      return;
    if (checkoutTypes.includes(event.type)) {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.paymentOrderId;
      if (!orderId) return;
      const initial = await tx.paymentOrder.findUnique({
        where: { id: orderId },
      });
      if (!initial)
        throw new HttpError(
          400,
          "PAYMENT_MISMATCH",
          "Unknown checkout session.",
        );
      const matter = await lockPaymentMatter(tx, initial.matterId);
      const order = await lockPaymentOrder(tx, orderId);
      if (order.stripeSessionId && order.stripeSessionId !== session.id)
        throw new HttpError(
          400,
          "PAYMENT_MISMATCH",
          "Unknown checkout session.",
        );
      assertSavedPaymentEnvironment(
        order.details,
        event.livemode ? "live" : "test",
      );
      if (
        session.amount_total !== order.amountCents ||
        session.currency?.toUpperCase() !== order.currency
      )
        throw new HttpError(
          400,
          "PAYMENT_AMOUNT_MISMATCH",
          "Checkout total does not match the saved order.",
        );
      const trigger =
        savedCheckoutCancellation(order.details) ??
        (matter && order.kind === "service"
          ? serviceCheckoutCancellation(matter)
          : null);
      const details = paymentDetails(order.details);
      const previousCancellation = paymentDetails(details.terminationVoid);
      if (
        trigger &&
        !order.stripeSessionId &&
        !details.checkoutCreationStartedAt &&
        previousCancellation.creationOutcomeUncertain !== true
      )
        throw new HttpError(
          400,
          "PAYMENT_MISMATCH",
          "No checkout was issued for this closed request.",
        );
      const expired = event.type === "checkout.session.expired";
      const failed = event.type === "checkout.session.async_payment_failed";
      let status = order.status;
      if (!["refunded", "partially_refunded", "disputed"].includes(status)) {
        if (session.payment_status === "paid") status = "paid";
        else if (status !== "paid" && (expired || failed))
          status = trigger ? "cancelled" : expired ? "expired" : "failed";
        else if (
          !trigger &&
          ["creating", "requires_reconciliation"].includes(status) &&
          session.status === "open" &&
          session.payment_status === "unpaid"
        )
          status = "pending";
      }
      const reconciliation = Boolean(
        trigger && session.payment_status === "paid",
      );
      const resolvedCreation =
        (previousCancellation.creationOutcomeUncertain === true &&
          (expired || failed)) ||
        (!trigger &&
          !order.stripeSessionId &&
          Boolean(details.checkoutCreationStartedAt) &&
          ["pending", "paid", "expired", "failed"].includes(status));
      const firstPaidAt =
        session.payment_status === "paid" &&
        [
          "checkout.session.completed",
          "checkout.session.async_payment_succeeded",
        ].includes(event.type) &&
        !event.id.startsWith("reconcile-") &&
        !savedPaidAt(details) &&
        Number.isSafeInteger(event.created) &&
        event.created > 0 &&
        event.created <= Date.now() / 1000
          ? new Date(event.created * 1000).toISOString()
          : null;
      const saved = await tx.paymentOrder.update({
        where: { id: order.id },
        data: {
          status,
          stripeSessionId: session.id,
          stripePaymentIntentId:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id,
          details: {
            ...details,
            paymentEnvironment: event.livemode ? "live" : "test",
            lastStripeEvent: event.id,
            ...(firstPaidAt ? { paidAt: firstPaidAt } : {}),
            ...(reconciliation ||
            (details.requiresReconciliation === true && resolvedCreation)
              ? { requiresReconciliation: reconciliation }
              : {}),
            ...(trigger &&
            (reconciliation ||
              (!settledStatuses.includes(status) && (expired || failed)))
              ? {
                  terminationVoid: {
                    ...previousCancellation,
                    trigger,
                    creationOutcomeUncertain: false,
                    state: reconciliation
                      ? "requires_reconciliation"
                      : expired
                        ? "expired"
                        : "provider_failed",
                    stripeSessionId: session.id,
                  },
                }
              : {}),
          },
        },
      });
      if (trigger && !expired && !failed && !settledStatuses.includes(status))
        await queuePaymentCancellation(tx, "stripe-webhook", saved, trigger);
      if (status === "paid")
        await tx.giftOrder.updateMany({
          where: { paymentOrderId: order.id, status: "awaiting_payment" },
          data: { status: "paid", revision: { increment: 1 } },
        });
    } else {
      const object = event.data.object as Stripe.Charge | Stripe.Dispute;
      const intent =
        typeof object.payment_intent === "string"
          ? object.payment_intent
          : object.payment_intent?.id;
      if (intent) {
        const order = await tx.paymentOrder.findFirst({
          where: {
            OR: [
              { stripePaymentIntentId: intent },
              ...(object.metadata?.paymentOrderId
                ? [{ id: object.metadata.paymentOrderId }]
                : []),
            ],
          },
        });
        if (order) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${order.id}`}))`;
          const current = await tx.paymentOrder.findUniqueOrThrow({
            where: { id: order.id },
          });
          assertSavedPaymentEnvironment(
            current.details,
            event.livemode ? "live" : "test",
          );
          const details = current.details as Record<
            string,
            Prisma.InputJsonValue
          >;
          const refundedCents = Math.max(
            Number(details.refundedCents || 0),
            event.type === "charge.refunded"
              ? (object as Stripe.Charge).amount_refunded
              : 0,
          );
          const status =
            event.type === "charge.dispute.created" ||
            current.status === "disputed"
              ? "disputed"
              : current.status === "refunded" ||
                  refundedCents >= current.amountCents ||
                  (object as Stripe.Charge).refunded
                ? "refunded"
                : "partially_refunded";
          await tx.paymentOrder.update({
            where: { id: order.id },
            data: {
              status,
              details: {
                ...details,
                refundedCents,
                paymentEnvironment: event.livemode ? "live" : "test",
                lastStripeEvent: event.id,
              },
            },
          });
        } else {
          throw new HttpError(
            409,
            "PAYMENT_NOT_YET_RECONCILED",
            "The checkout event must be reconciled before this payment update.",
          );
        }
      }
    }
    await tx.webhookReceipt.create({
      data: { provider: "stripe", eventId: event.id, processedAt: new Date() },
    });
    await tx.auditEvent.create({
      data: {
        actorId: "stripe-webhook",
        action: "payment.provider_event",
        entityType: "WebhookReceipt",
        entityId: event.id,
        details: { type: event.type },
      },
    });
  });
}
