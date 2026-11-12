import { prisma } from "@weatherly/db";
import {
  HttpError,
  assertCoordinator,
  type Principal,
} from "@weatherly/platform";
import { requireMatter } from "@weatherly/matters";
import { checkoutInput } from "./contracts";
import {
  assertServiceCheckoutAllowed,
  lockPaymentMatter,
  lockPaymentOrder,
  paymentDetails,
  savedCheckoutCancellation,
  serviceCheckoutCancellation,
  settledStatuses,
  verifiedCheckoutUrl,
} from "./checkout-policy";
import {
  paymentMode,
  assertSavedPaymentEnvironment,
  savedPaymentEnvironment,
} from "./mode";
import { findOrCreatePaymentOrder } from "./order-requests";
import { verifiedStripe } from "./provider";
import { queuePaymentCancellation } from "./termination";

function closedPayment() {
  return new HttpError(
    409,
    "PAYMENT_CLOSED",
    "This request changed while checkout was opening. Review the current payment record.",
  );
}

export async function createCheckout(
  actor: Principal,
  raw: unknown,
  provider = verifiedStripe,
) {
  assertCoordinator(actor);
  const input = checkoutInput.parse(raw);
  const initial = await requireMatter(actor, input.matterId);
  if (input.kind === "service") {
    if (serviceCheckoutCancellation(initial) === "termination") {
      const retained = await prisma.paymentOrder.findFirst({
        where: {
          matterId: initial.id,
          kind: "service",
          status: { in: settledStatuses },
        },
        orderBy: { createdAt: "desc" },
      });
      if (retained) {
        assertSavedPaymentEnvironment(retained.details, paymentMode());
        return { id: retained.id, status: retained.status, url: null };
      }
    }
    assertServiceCheckoutAllowed(initial);
  }

  // Preserve the provider account check before creating a payable order. The
  // order transaction rechecks the file under its lock.
  const stripe = await provider();
  const order = await findOrCreatePaymentOrder(actor, input);
  const environment = paymentMode();
  assertSavedPaymentEnvironment(order.details, environment);
  if (settledStatuses.includes(order.status))
    return { id: order.id, status: order.status, url: null };
  if (savedPaymentEnvironment(order.details) === "unknown")
    throw new HttpError(
      409,
      "PAYMENT_ENVIRONMENT_UNKNOWN",
      "Reconcile this request in its original payment environment before opening checkout.",
    );
  if (
    ["void_pending", "cancelled", "requires_reconciliation"].includes(
      order.status,
    ) ||
    savedCheckoutCancellation(order.details)
  )
    throw closedPayment();

  if (order.stripeSessionId) {
    const session = await stripe.checkout.sessions.retrieve(
      order.stripeSessionId,
    );
    const current = await prisma.$transaction(async (tx) => {
      const matter = await lockPaymentMatter(tx, order.matterId);
      const payment = await lockPaymentOrder(tx, order.id);
      if (
        !matter ||
        payment.status !== "pending" ||
        savedCheckoutCancellation(payment.details) ||
        (payment.kind === "service" && serviceCheckoutCancellation(matter))
      )
        throw closedPayment();
      if (
        payment.stripeSessionId !== session.id ||
        session.metadata?.paymentOrderId !== payment.id ||
        session.livemode !== (environment === "live") ||
        session.amount_total !== payment.amountCents ||
        session.currency?.toUpperCase() !== payment.currency
      ) {
        throw new HttpError(
          409,
          "PAYMENT_MISMATCH",
          "The provider checkout does not match this saved payment request.",
        );
      }
      return payment;
    });
    return {
      id: current.id,
      status: current.status,
      url:
        session.status === "open" && session.url
          ? verifiedCheckoutUrl(session.url)
          : null,
    };
  }

  await prisma.$transaction(async (tx) => {
    const matter = await lockPaymentMatter(tx, order.matterId);
    const current = await lockPaymentOrder(tx, order.id);
    if (
      !matter ||
      current.status !== "creating" ||
      savedCheckoutCancellation(current.details) ||
      (current.kind === "service" && serviceCheckoutCancellation(matter))
    )
      throw closedPayment();
    const details = paymentDetails(current.details);
    if (!details.checkoutCreationStartedAt) {
      await tx.paymentOrder.update({
        where: { id: current.id },
        data: {
          details: {
            ...details,
            checkoutCreationStartedAt: new Date().toISOString(),
          },
        },
      });
    }
  });

  const origin = process.env.WEB_ORIGIN!;
  const snapshot = order.snapshot as { name: string };
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: order.id,
      metadata: { paymentOrderId: order.id },
      payment_intent_data: { metadata: { paymentOrderId: order.id } },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: order.currency.toLowerCase(),
            unit_amount: order.amountCents,
            product_data: { name: `Weatherly ${snapshot.name}` },
          },
        },
      ],
      success_url: `${origin}/portal?payment=received`,
      cancel_url: `${origin}/portal?payment=cancelled`,
      integration_identifier: "weatherly_service_hqazmwrp",
    },
    { idempotencyKey: `checkout:${order.id}` },
  );

  // A file can be terminated, converted or deleted while Stripe creates the
  // session. Persist the ID and enqueue cancellation even after Matter deletion.
  const blocked = await prisma.$transaction(async (tx) => {
    const matter = await lockPaymentMatter(tx, order.matterId);
    const current = await lockPaymentOrder(tx, order.id);
    if (current.stripeSessionId && current.stripeSessionId !== session.id)
      throw new HttpError(
        409,
        "CHECKOUT_CHANGED",
        "A different checkout was recorded while the provider responded.",
      );
    const trigger =
      savedCheckoutCancellation(current.details) ??
      (!matter
        ? "file_deleted"
        : current.kind === "service"
          ? serviceCheckoutCancellation(matter)
          : null);
    const stillPayable =
      ["creating", "pending"].includes(current.status) && trigger === null;
    const saved = await tx.paymentOrder.update({
      where: { id: current.id },
      data: {
        stripeSessionId: session.id,
        status: stillPayable ? "pending" : current.status,
      },
    });
    if (trigger) await queuePaymentCancellation(tx, actor.id, saved, trigger);
    return !stillPayable;
  });
  if (blocked) throw closedPayment();
  return {
    id: order.id,
    status: "pending",
    url:
      session.status === "open" && session.url
        ? verifiedCheckoutUrl(session.url)
        : null,
  };
}
