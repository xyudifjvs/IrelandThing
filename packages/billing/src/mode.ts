import { HttpError } from "@weatherly/platform";
/** Payment permission is deliberately independent of production authentication/build settings. */
export function paymentMode(
  env: Record<string, string | undefined> = process.env,
): "test" | "live" {
  const mode = env.STRIPE_MODE === undefined ? "test" : env.STRIPE_MODE;
  if (mode !== "test" && mode !== "live")
    throw new HttpError(
      503,
      "INVALID_PAYMENT_MODE",
      "Configure an explicit test or live payment mode.",
    );
  if (
    mode === "live" &&
    (env.PAYMENT_LIVE_APPROVED !== "true" ||
      env.DEPLOYMENT_ENV !== "production" ||
      env.APP_ENV !== "production")
  )
    throw new HttpError(
      503,
      "LIVE_PAYMENTS_FORBIDDEN",
      "Live payments require explicit approval in the production deployment.",
    );
  return mode;
}
export function assertPaymentKey(
  key: string,
  env: Record<string, string | undefined> = process.env,
) {
  const mode = paymentMode(env);
  if (!new RegExp(`^(sk|rk)_${mode}_[A-Za-z0-9]+$`).test(key))
    throw new HttpError(
      503,
      "PAYMENT_KEY_MODE_MISMATCH",
      "Payment credentials must match the approved payment environment.",
    );
}
export function assertPaymentEvent(
  event: { livemode: boolean; data?: { object?: unknown } },
  env: Record<string, string | undefined> = process.env,
) {
  const live = paymentMode(env) === "live";
  const object = event.data?.object as { livemode?: boolean } | undefined;
  if (
    event.livemode !== live ||
    (object?.livemode !== undefined && object.livemode !== live)
  )
    throw new HttpError(
      400,
      "WRONG_STRIPE_MODE",
      "Unexpected payment environment.",
    );
}

/** Missing legacy provenance stays unknown until verified provider evidence arrives. */
export function savedPaymentEnvironment(
  details: unknown,
): "test" | "live" | "unknown" {
  const value =
    details && typeof details === "object" && !Array.isArray(details)
      ? (details as { paymentEnvironment?: unknown }).paymentEnvironment
      : undefined;
  return value === "test" || value === "live" ? value : "unknown";
}

export function assertSavedPaymentEnvironment(
  details: unknown,
  environment: "test" | "live",
) {
  const saved = savedPaymentEnvironment(details);
  if (saved !== "unknown" && saved !== environment)
    throw new HttpError(
      400,
      "PAYMENT_ENVIRONMENT_MISMATCH",
      "The event does not match this payment request's saved environment.",
    );
}
