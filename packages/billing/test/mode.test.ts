import { afterEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { assertPaymentEvent, assertPaymentKey, paymentMode } from "../src/mode";
import { verifyStripeWebhook } from "../src/service";
afterEach(() => vi.unstubAllEnvs());
const approved = {
  STRIPE_MODE: "live",
  PAYMENT_LIVE_APPROVED: "true",
  DEPLOYMENT_ENV: "production",
  APP_ENV: "production",
};
describe("independent payment deployment permission", () => {
  it.each(["local", "test", "production", undefined])(
    "defaults to test with APP_ENV=%s",
    (APP_ENV) => {
      const env = { APP_ENV };
      expect(paymentMode(env)).toBe("test");
      expect(() => assertPaymentKey("rk_test_synthetic", env)).not.toThrow();
      expect(() => assertPaymentKey("sk_live_synthetic", env)).toThrow();
      expect(() => assertPaymentEvent({ livemode: true }, env)).toThrow();
    },
  );
  it.each(["", "LIVE", "sandbox", "false", " test"])(
    "fails closed for invalid mode %s",
    (STRIPE_MODE) => {
      expect(() => paymentMode({ ...approved, STRIPE_MODE })).toThrow();
    },
  );
  it.each([
    "STRIPE_MODE",
    "PAYMENT_LIVE_APPROVED",
    "DEPLOYMENT_ENV",
    "APP_ENV",
  ])("requires independent live prerequisite %s", (key) => {
    const env = { ...approved, [key]: undefined };
    if (key === "STRIPE_MODE") expect(paymentMode(env)).toBe("test");
    else expect(() => paymentMode(env)).toThrow();
    expect(() => assertPaymentKey("sk_live_synthetic", env)).toThrow();
    expect(() => assertPaymentEvent({ livemode: true }, env)).toThrow();
  });
  it("rejects staging even with production auth/build configuration and approval", () => {
    expect(() =>
      paymentMode({
        ...approved,
        DEPLOYMENT_ENV: "staging",
        NODE_ENV: "production",
      }),
    ).toThrow();
  });
  it("binds both outbound keys and inbound envelope/object modes to approval", () => {
    expect(paymentMode(approved)).toBe("live");
    expect(() => assertPaymentKey("rk_live_synthetic", approved)).not.toThrow();
    expect(() => assertPaymentKey("sk_test_synthetic", approved)).toThrow();
    expect(() => assertPaymentKey("pk_live_synthetic", approved)).toThrow();
    expect(() =>
      assertPaymentEvent(
        { livemode: true, data: { object: { livemode: false } } },
        approved,
      ),
    ).toThrow();
    expect(() => assertPaymentEvent({ livemode: false }, approved)).toThrow();
  });
  it("rejects a correctly signed live webhook locally before any database operation", () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("STRIPE_MODE", "test");
    vi.stubEnv("STRIPE_SECRET_KEY", "rk_test_synthetic");
    vi.stubEnv("STRIPE_ACCOUNT_ID", "acct_synthetic");
    vi.stubEnv("STRIPE_ACCOUNT_OWNER", "ireland");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_synthetic");
    const payload = JSON.stringify({
      id: "evt_synthetic",
      livemode: true,
      type: "checkout.session.completed",
      data: { object: {} },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: "whsec_synthetic",
    });
    expect(() =>
      verifyStripeWebhook(Buffer.from(payload), signature),
    ).toThrowError(expect.objectContaining({ code: "WRONG_STRIPE_MODE" }));
  });
});
