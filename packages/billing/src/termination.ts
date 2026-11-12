import { z } from "zod";
import type Stripe from "stripe";
import { prisma, Prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import { requireMatter } from "@weatherly/matters";
import { verifiedStripe } from "./provider";
import { paymentMode, savedPaymentEnvironment } from "./mode";

import {
  type CheckoutCancellation,
  isPreClosingTermination,
  lockPaymentMatter,
  lockPaymentOrder,
  paymentDetails as object,
  savedCheckoutCancellation,
  settledStatuses,
} from "./checkout-policy";

export { isPreClosingTermination } from "./checkout-policy";

const payloadInput = z
  .object({ paymentOrderId: z.string().min(1).max(200) })
  .strict();
const jobKey = (id: string, session: string) =>
  `billing-expire-checkout:${id}:${session}`;

function fileCancellation(matter: {
  business: "hto" | "weatherly" | null;
  stage: string;
  details: unknown;
  checklistVersion: number | null;
}): CheckoutCancellation | null {
  if (matter.business === "hto") return "hto_exempt";
  if (
    isPreClosingTermination(matter) ||
    (matter.checklistVersion !== null && matter.stage === "terminated")
  )
    return "termination";
  return null;
}

/** Call with the Matter and payment order locks held. */
export async function queuePaymentCancellation(
  tx: Prisma.TransactionClient,
  actorId: string,
  order: Prisma.PaymentOrderGetPayload<object>,
  trigger: CheckoutCancellation,
) {
  if (
    settledStatuses.includes(order.status) ||
    ["expired", "failed", "requires_reconciliation"].includes(order.status)
  )
    return { queued: 0, cancelledLocally: 0 };

  const details = object(order.details);
  const previous = object(details.terminationVoid);
  if (!order.stripeSessionId) {
    if (order.status === "cancelled") return { queued: 0, cancelledLocally: 0 };
    await tx.paymentOrder.update({
      where: { id: order.id },
      data: {
        status: "cancelled",
        details: {
          ...details,
          terminationVoid: {
            ...previous,
            trigger,
            state: "no_session_saved",
            requestedById: actorId,
            requestedAt: new Date().toISOString(),
            ...(details.checkoutCreationStartedAt
              ? { creationOutcomeUncertain: true }
              : {}),
          },
        },
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        action: "payment.termination_cancelled_locally",
        entityType: "PaymentOrder",
        entityId: order.id,
        matterId: order.matterId,
        details: { providerSessionSaved: false, trigger },
      },
    });
    return { queued: 0, cancelledLocally: 1 };
  }

  if (previous.state === "expired") return { queued: 0, cancelledLocally: 0 };
  if (
    order.status !== "void_pending" ||
    savedCheckoutCancellation(details) === null
  ) {
    await tx.paymentOrder.update({
      where: { id: order.id },
      data: {
        status: "void_pending",
        details: {
          ...details,
          terminationVoid: {
            ...previous,
            trigger,
            state: "pending",
            creationOutcomeUncertain: false,
            requestedById: actorId,
            requestedAt: new Date().toISOString(),
            stripeSessionId: order.stripeSessionId,
          },
        },
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        action: "payment.termination_expiration_queued",
        entityType: "PaymentOrder",
        entityId: order.id,
        matterId: order.matterId,
        details: { trigger },
      },
    });
  }
  const idempotencyKey = jobKey(order.id, order.stripeSessionId);
  await tx.outboxJob.upsert({
    where: { idempotencyKey },
    create: {
      topic: "billing.expire_checkout",
      idempotencyKey,
      payload: { paymentOrderId: order.id },
    },
    update: {},
  });
  return { queued: 1, cancelledLocally: 0 };
}

async function queueFileCheckouts(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
  trigger: CheckoutCancellation,
) {
  const orders = await tx.paymentOrder.findMany({
    where: {
      matterId,
      ...(trigger === "file_deleted" ? {} : { kind: "service" }),
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const totals = { queued: 0, cancelledLocally: 0 };
  for (const { id } of orders) {
    const order = await lockPaymentOrder(tx, id);
    const result = await queuePaymentCancellation(tx, actor.id, order, trigger);
    totals.queued += result.queued;
    totals.cancelledLocally += result.cancelledLocally;
  }
  return totals;
}

/** Compose with legacy matter changes and explicit file transitions. */
export async function queueTerminatedServiceCheckouts(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
) {
  assertCoordinator(actor);
  const matter = await requireMatter(actor, matterId, true, tx);
  const trigger = fileCancellation(matter);
  return trigger
    ? queueFileCheckouts(tx, actor, matterId, trigger)
    : { queued: 0, cancelledLocally: 0 };
}

/** Call before deleting a file. Retained orders and outbox jobs outlive its Matter. */
export async function queueDeletedFileCheckouts(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
) {
  assertCoordinator(actor);
  await requireMatter(actor, matterId, true, tx);
  return queueFileCheckouts(tx, actor, matterId, "file_deleted");
}

async function lockedOrder(id: string) {
  return prisma.$transaction(async (tx) => {
    const initial = await tx.paymentOrder.findUnique({ where: { id } });
    if (
      !initial ||
      (initial.kind !== "service" &&
        savedCheckoutCancellation(initial.details) !== "file_deleted")
    )
      throw new HttpError(
        404,
        "SERVICE_ORDER_NOT_FOUND",
        "Payment request not found.",
      );
    const matter = await lockPaymentMatter(tx, initial.matterId);
    const order = await lockPaymentOrder(tx, id);
    return { order, matter };
  });
}
function canExpire(
  order: Prisma.PaymentOrderGetPayload<object>,
  matter: Awaited<ReturnType<typeof lockPaymentMatter>>,
) {
  return (
    savedCheckoutCancellation(order.details) !== null ||
    (matter !== null && fileCancellation(matter) !== null)
  );
}
async function outcome(
  id: string,
  sessionId: string,
  state: "expired" | "requires_reconciliation",
  reason: string,
) {
  return prisma.$transaction(async (tx) => {
    const initial = await tx.paymentOrder.findUniqueOrThrow({ where: { id } });
    await lockPaymentMatter(tx, initial.matterId);
    const current = await lockPaymentOrder(tx, id);
    if (current.stripeSessionId !== sessionId)
      throw new HttpError(
        409,
        "CHECKOUT_CHANGED",
        "The saved checkout changed during termination reconciliation.",
      );
    const paid = settledStatuses.includes(current.status);
    const details = object(current.details);
    const reconcile = paid || state === "requires_reconciliation";
    await tx.paymentOrder.update({
      where: { id },
      data: {
        status: paid
          ? current.status
          : reconcile
            ? "requires_reconciliation"
            : "cancelled",
        details: {
          ...details,
          ...(reconcile ? { requiresReconciliation: true } : {}),
          terminationVoid: {
            ...object(details.terminationVoid),
            state: reconcile ? "requires_reconciliation" : "expired",
            reason,
            checkedAt: new Date().toISOString(),
            stripeSessionId: sessionId,
          },
        },
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId: "billing-worker",
        entityType: "PaymentOrder",
        entityId: id,
        matterId: current.matterId,
        action: reconcile
          ? "payment.termination_reconciliation_required"
          : "payment.termination_checkout_expired",
        details: {
          stripeSessionId: sessionId,
          reason,
          originalStatus: current.status,
        },
      },
    });
    return { expired: !reconcile, requiresReconciliation: reconcile };
  });
}

/** Public provider contract: only an open Checkout Session can be expired.
 * https://docs.stripe.com/api/checkout/sessions/expire
 * Completed/paid and settlement races require Ireland's reconciliation, never a refund. */
export async function expireTerminatedServiceCheckout(
  payload: unknown,
  provider: () => Promise<Stripe> = verifiedStripe,
) {
  const { paymentOrderId } = payloadInput.parse(payload);
  let { order, matter } = await lockedOrder(paymentOrderId);
  if (!canExpire(order, matter))
    return { skipped: "TERMINATION_NOT_CONFIRMED" };
  if (!order.stripeSessionId) return { skipped: "NO_SAVED_CHECKOUT" };
  const sessionId = order.stripeSessionId;
  if (settledStatuses.includes(order.status))
    return outcome(
      order.id,
      sessionId,
      "requires_reconciliation",
      "payment_or_refund_record_exists",
    );
  if (object(object(order.details).terminationVoid).state === "expired")
    return { expired: true };
  const environment = savedPaymentEnvironment(order.details);
  if (environment === "unknown" || environment !== paymentMode())
    throw new HttpError(
      409,
      "PAYMENT_ENVIRONMENT_UNKNOWN",
      "Reconcile the request in its original payment environment before expiring checkout.",
    );
  const stripe = await provider(); // Existing adapter verifies Ireland's configured account.
  const matches = (session: Stripe.Checkout.Session) =>
    session.id === sessionId &&
    session.metadata?.paymentOrderId === order.id &&
    session.livemode === (environment === "live") &&
    session.amount_total === order.amountCents &&
    session.currency?.toUpperCase() === order.currency;
  let session = await stripe.checkout.sessions.retrieve(sessionId);
  if (!matches(session))
    return outcome(
      order.id,
      sessionId,
      "requires_reconciliation",
      "provider_session_mismatch",
    );
  if (session.payment_status !== "unpaid" || session.status === "complete")
    return outcome(
      order.id,
      sessionId,
      "requires_reconciliation",
      "provider_completed_or_payment_pending",
    );
  if (session.status === "expired")
    return outcome(order.id, sessionId, "expired", "provider_already_expired");
  if (session.status !== "open")
    throw new HttpError(
      503,
      "CHECKOUT_STATE_UNAVAILABLE",
      "Checkout state is unavailable; expiration will retry.",
    );
  // A payment webhook or coordinator correction may have arrived during retrieval.
  ({ order, matter } = await lockedOrder(paymentOrderId));
  if (!canExpire(order, matter))
    return outcome(
      order.id,
      sessionId,
      "requires_reconciliation",
      "termination_changed_before_expiration",
    );
  if (settledStatuses.includes(order.status))
    return outcome(
      order.id,
      sessionId,
      "requires_reconciliation",
      "payment_changed_before_expiration",
    );
  if (order.stripeSessionId !== sessionId)
    throw new HttpError(
      409,
      "CHECKOUT_CHANGED",
      "Checkout changed before expiration.",
    );
  try {
    session = await stripe.checkout.sessions.expire(
      sessionId,
      {},
      { idempotencyKey: `weatherly-terminate:${order.id}:${sessionId}` },
    );
  } catch {
    // Expiration also errors when the provider already closed/settled the session.
    // Re-read authoritative state; do not interpret an API error as expiration.
    session = await stripe.checkout.sessions.retrieve(sessionId);
    if (
      matches(session) &&
      session.status === "open" &&
      session.payment_status === "unpaid"
    )
      throw new HttpError(
        503,
        "CHECKOUT_EXPIRATION_FAILED",
        "Provider checkout expiration failed; it remains queued for retry.",
      );
  }
  if (!matches(session))
    return outcome(
      order.id,
      sessionId,
      "requires_reconciliation",
      "provider_session_mismatch",
    );
  if (session.status === "expired" && session.payment_status === "unpaid")
    return outcome(order.id, sessionId, "expired", "provider_expired");
  if (session.status === "complete" || session.payment_status !== "unpaid")
    return outcome(
      order.id,
      sessionId,
      "requires_reconciliation",
      "payment_settled_during_expiration",
    );
  throw new HttpError(
    503,
    "CHECKOUT_EXPIRATION_UNCONFIRMED",
    "Checkout expiration has not been confirmed; it remains queued for retry.",
  );
}
