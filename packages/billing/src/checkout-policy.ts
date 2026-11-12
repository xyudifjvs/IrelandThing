import type { Prisma } from "@weatherly/db";
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
