import type Stripe from "stripe";
import { paymentDetails } from "./checkout-policy";

type CheckoutOrder = {
  id: string;
  amountCents: number;
  currency: string;
  details: unknown;
  snapshot: unknown;
};

// Stripe may prune v1 idempotency keys after 24 hours. Leave a margin for
// provider verification and the SDK's network retries.
const replayWindowMs = 23 * 60 * 60 * 1000;

function providerAccount() {
  return process.env.STRIPE_ACCOUNT_ID ?? null;
}

export function newCheckoutRequest(order: CheckoutOrder) {
  const origin = process.env.WEB_ORIGIN!;
  const snapshot = order.snapshot as { name: string };
  const parameters = {
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
  } as const;
  return {
    idempotencyKey: `checkout:${order.id}`,
    accountId: providerAccount(),
    parameters,
  };
}

export function replayableCheckoutRequest(order: CheckoutOrder) {
  const details = paymentDetails(order.details);
  const started = details.checkoutCreationStartedAt;
  const saved = paymentDetails(details.checkoutCreationRequest);
  if (
    typeof started !== "string" ||
    saved.accountId !== providerAccount() ||
    saved.idempotencyKey !== `checkout:${order.id}`
  )
    return null;
  const age = Date.now() - Date.parse(started);
  if (!Number.isFinite(age) || age < 0 || age >= replayWindowMs) return null;
  const parameters = paymentDetails(saved.parameters);
  if (
    parameters.mode !== "payment" ||
    parameters.client_reference_id !== order.id ||
    paymentDetails(parameters.metadata).paymentOrderId !== order.id
  )
    return null;
  return { idempotencyKey: saved.idempotencyKey, parameters };
}

export function issueSavedCheckout(
  stripe: Stripe,
  request: NonNullable<ReturnType<typeof replayableCheckoutRequest>>,
) {
  // This is the server-owned JSON saved before the original request. Use
  // it unchanged because Stripe compares parameters on an idempotent retry.
  return stripe.checkout.sessions.create(
    request.parameters as Stripe.Checkout.SessionCreateParams,
    { idempotencyKey: request.idempotencyKey },
  );
}
