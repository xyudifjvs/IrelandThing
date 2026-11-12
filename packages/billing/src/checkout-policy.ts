import type { Prisma } from "@weatherly/db";
import type Stripe from "stripe";
import { z } from "zod";
import { HttpError } from "@weatherly/platform";
import {
  serviceFeeApplies,
  type Business,
} from "@weatherly/platform/handoff-contracts";

type CheckoutMatter = {
  business: Business | null;
  stage: string;
  details: unknown;
};

export type CheckoutCancellation =
  "termination" | "hto_exempt" | "file_deleted";

export const settledStatuses = [
  "paid",
  "refunded",
  "partially_refunded",
  "disputed",
];

export function paymentDetails(value: unknown): Prisma.InputJsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Prisma.InputJsonObject)
    : {};
}

export function savedPaidAt(details: unknown) {
  const parsed = z.iso.datetime().safeParse(paymentDetails(details).paidAt);
  return parsed.success ? parsed.data : null;
}

export function paymentOrderForRead<T extends { details: unknown }>(order: T) {
  const { checkoutCreationRequest: _, ...details } = paymentDetails(
    order.details,
  );
  return { ...order, details };
}

export function isPreClosingTermination(matter: {
  stage: string;
  details: unknown;
}) {
  return (
    ["terminated", "archived"].includes(matter.stage) &&
    paymentDetails(paymentDetails(matter.details).termination).beforeClosing ===
      true
  );
}

export function serviceCheckoutCancellation(
  matter: CheckoutMatter,
): CheckoutCancellation | null {
  if (!serviceFeeApplies(matter)) return "hto_exempt";
  if (matter.stage === "terminated" || isPreClosingTermination(matter))
    return "termination";
  return null;
}

export function assertServiceCheckoutAllowed(matter: CheckoutMatter) {
  const cancellation = serviceCheckoutCancellation(matter);
  if (cancellation === "hto_exempt")
    throw new HttpError(
      409,
      "SERVICE_FEE_EXEMPT",
      "Home Team Ohio files have no service fee.",
    );
  if (cancellation === "termination")
    throw new HttpError(
      409,
      "SERVICE_NOT_DUE_TERMINATED",
      "This terminated file has no payable service request.",
    );
}

export function savedCheckoutCancellation(
  details: unknown,
): CheckoutCancellation | null {
  const cancellation = paymentDetails(paymentDetails(details).terminationVoid);
  const trigger = cancellation.trigger;
  if (
    trigger === "termination" ||
    trigger === "hto_exempt" ||
    trigger === "file_deleted"
  )
    return trigger;
  return typeof cancellation.state === "string" ? "termination" : null;
}

export function verifiedCheckoutUrl(value: string) {
  const url = URL.parse(value);
  if (
    !url ||
    url.protocol !== "https:" ||
    url.hostname !== "checkout.stripe.com" ||
    url.username ||
    url.password ||
    url.port
  )
    throw new HttpError(
      409,
      "PAYMENT_URL_INVALID",
      "The provider returned an invalid checkout address.",
    );
  return value;
}

export function checkoutSessionMatches(
  session: Stripe.Checkout.Session,
  order: {
    id: string;
    amountCents: number;
    currency: string;
    stripeSessionId: string | null;
  },
  environment: "live" | "test",
) {
  return (
    Boolean(session.id) &&
    (!order.stripeSessionId || session.id === order.stripeSessionId) &&
    session.metadata?.paymentOrderId === order.id &&
    session.livemode === (environment === "live") &&
    (session.mode === undefined || session.mode === "payment") &&
    session.amount_total === order.amountCents &&
    session.currency?.toUpperCase() === order.currency
  );
}

export async function lockPaymentOrder(
  tx: Prisma.TransactionClient,
  id: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${id}`}))`;
  return tx.paymentOrder.findUniqueOrThrow({ where: { id } });
}

export async function lockPaymentMatter(
  tx: Prisma.TransactionClient,
  id: string,
) {
  await tx.$queryRaw`SELECT id FROM "Matter" WHERE id = ${id} FOR UPDATE`;
  return tx.matter.findUnique({ where: { id } });
}
