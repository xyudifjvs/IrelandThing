import Stripe from "stripe";
import { HttpError } from "@weatherly/platform";
import { paymentMode, assertPaymentKey, assertPaymentEvent } from "./mode";

export function billingConfigured() {
  try {
    paymentMode();
    if (process.env.STRIPE_SECRET_KEY)
      assertPaymentKey(process.env.STRIPE_SECRET_KEY);
  } catch {
    return false;
  }
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_WEBHOOK_SECRET &&
    process.env.STRIPE_ACCOUNT_ID &&
    process.env.STRIPE_ACCOUNT_OWNER === "ireland",
  );
}
function stripeClient() {
  paymentMode();
  if (process.env.STRIPE_SECRET_KEY)
    assertPaymentKey(process.env.STRIPE_SECRET_KEY);
  if (!billingConfigured())
    throw new HttpError(
      503,
      "STRIPE_NOT_CONFIGURED",
      "Ireland must configure her own Stripe account before payments can be requested.",
    );
  const key = process.env.STRIPE_SECRET_KEY!;
  assertPaymentKey(key);
  return new Stripe(key, { maxNetworkRetries: 2, timeout: 20000 });
}
export async function verifiedStripe() {
  const stripe = stripeClient();
  const account = await stripe.accounts.retrieve(null);
  if (account.id !== process.env.STRIPE_ACCOUNT_ID)
    throw new HttpError(
      503,
      "STRIPE_ACCOUNT_MISMATCH",
      "The payment credentials do not match Ireland’s configured Stripe account.",
    );
  return stripe;
}

export function verifyStripeWebhook(body: Buffer, signature: string) {
  const event = stripeClient().webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!,
  );
  assertPaymentEvent(event);
  return event;
}
