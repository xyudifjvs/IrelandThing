import { z } from "zod";
import type Stripe from "stripe";
import { prisma, Prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import { audit, requireMatter } from "@weatherly/matters";
import { verifiedStripe } from "./service";
import { paymentMode, savedPaymentEnvironment } from "./mode";

const object = (value: unknown): Record<string, Prisma.InputJsonValue> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Prisma.InputJsonValue>)
    : {};
const protectedStatuses = new Set([
  "paid",
  "refunded",
  "partially_refunded",
  "disputed",
]);
const payloadInput = z
  .object({ paymentOrderId: z.string().min(1).max(200) })
  .strict();
const jobKey = (id: string, session: string) =>
  `billing-expire-checkout:${id}:${session}`;
export function isPreClosingTermination(matter: {
  stage: string;
  details: unknown;
}) {
  return (
    ["terminated", "archived"].includes(matter.stage) &&
    object(object(matter.details).termination).beforeClosing === true
  );
}

/** Compose with the existing matter-change hook. No external call occurs in this transaction. */
export async function queueTerminatedServiceCheckouts(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
) {
  assertCoordinator(actor);
  const matter = await requireMatter(actor, matterId, true, tx);
  if (!isPreClosingTermination(matter))
    return { queued: 0, cancelledLocally: 0 };
  const orders = await tx.paymentOrder.findMany({
    where: { matterId, kind: "service" },
    select: { id: true },
  });
  let queued = 0,
    cancelledLocally = 0;
  for (const { id } of orders) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${id}`}))`;
    const order = await tx.paymentOrder.findUniqueOrThrow({ where: { id } });
    if (
      protectedStatuses.has(order.status) ||
      ["expired", "failed", "requires_reconciliation"].includes(order.status)
    )
      continue;
    const details = object(order.details);
    const previous = object(details.terminationVoid);
    if (!order.stripeSessionId) {
      if (order.status === "cancelled") continue;
      await tx.paymentOrder.update({
        where: { id },
        data: {
          status: "cancelled",
          details: {
            ...details,
            terminationVoid: {
              ...previous,
              state: "no_session_saved",
              requestedById: actor.id,
              requestedAt: new Date().toISOString(),
              ...(details.checkoutCreationStartedAt
                ? { creationOutcomeUncertain: true }
                : {}),
            },
          },
        },
      });
      await audit(
        tx,
        actor,
        "payment.termination_cancelled_locally",
        "PaymentOrder",
        id,
        matterId,
        { providerSessionSaved: false },
      );
      cancelledLocally++;
      continue;
    }
    if (previous.state === "expired") continue;
    if (order.status !== "void_pending") {
      await tx.paymentOrder.update({
        where: { id },
        data: {
          status: "void_pending",
          details: {
            ...details,
            terminationVoid: {
              ...previous,
              state: "pending",
              creationOutcomeUncertain: false,
              requestedById: actor.id,
              requestedAt: new Date().toISOString(),
              stripeSessionId: order.stripeSessionId,
            },
          },
        },
      });
      await audit(
        tx,
        actor,
        "payment.termination_expiration_queued",
        "PaymentOrder",
        id,
        matterId,
        {},
      );
    }
    await tx.outboxJob.upsert({
      where: { idempotencyKey: jobKey(id, order.stripeSessionId) },
      create: {
        topic: "billing.expire_checkout",
        idempotencyKey: jobKey(id, order.stripeSessionId),
        payload: { paymentOrderId: id },
      },
      update: {},
    });
    queued++;
  }
  return { queued, cancelledLocally };
}

async function lockedOrder(id: string) {
  return prisma.$transaction(async (tx) => {
    const initial = await tx.paymentOrder.findUnique({ where: { id } });
    if (!initial || initial.kind !== "service")
      throw new HttpError(
        404,
        "SERVICE_ORDER_NOT_FOUND",
        "Service payment request not found.",
      );
    await tx.$queryRaw`SELECT id FROM "Matter" WHERE id=${initial.matterId} FOR UPDATE`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${id}`}))`;
    const order = await tx.paymentOrder.findUniqueOrThrow({ where: { id } });
    const matter = await tx.matter.findUniqueOrThrow({
      where: { id: order.matterId },
    });
    return { order, matter };
  });
}
async function outcome(
  id: string,
  sessionId: string,
  state: "expired" | "requires_reconciliation",
  reason: string,
) {
  return prisma.$transaction(async (tx) => {
    const initial = await tx.paymentOrder.findUniqueOrThrow({ where: { id } });
    await tx.$queryRaw`SELECT id FROM "Matter" WHERE id=${initial.matterId} FOR UPDATE`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${id}`}))`;
    const current = await tx.paymentOrder.findUniqueOrThrow({ where: { id } });
    if (current.stripeSessionId !== sessionId)
      throw new HttpError(
        409,
        "CHECKOUT_CHANGED",
        "The saved checkout changed during termination reconciliation.",
      );
    const paid = protectedStatuses.has(current.status);
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
  if (!isPreClosingTermination(matter))
    return { skipped: "TERMINATION_NOT_CONFIRMED" };
  if (!order.stripeSessionId) return { skipped: "NO_SAVED_CHECKOUT" };
  const sessionId = order.stripeSessionId;
  if (protectedStatuses.has(order.status))
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
  if (!isPreClosingTermination(matter))
    return outcome(
      order.id,
      sessionId,
      "requires_reconciliation",
      "termination_changed_before_expiration",
    );
  if (protectedStatuses.has(order.status))
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
