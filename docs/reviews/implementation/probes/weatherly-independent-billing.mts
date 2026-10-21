import "./_review-safety.mjs";
import {
  checkoutRoot,
  checkerDatabaseUrl,
  apiBase,
  webBase,
} from "./_review-safety.mjs";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../../packages/db/src/index.ts";
import {
  quoteGift,
  fulfillGift,
  refundPayment,
  reconcilePayment,
} from "../../../../packages/billing/src/operations.ts";
import {
  createCheckout,
  applyStripeEvent,
} from "../../../../packages/billing/src/service.ts";
import { queryStoredRecords } from "../../../../packages/assistant/src/records.ts";
const suffix = randomUUID(),
  mid = "checker-billing-" + suffix,
  actor = {
    id: "owner-local",
    email: "ireland@example.test",
    name: "Ireland",
    role: "coordinator" as const,
    sessionId: "independent-billing",
  },
  checks = [];
const check = (name, pass, extra = {}) => checks.push({ name, pass, ...extra });
async function denied(name, fn, code) {
  try {
    await fn();
    check(name, false, { accepted: true });
  } catch (e) {
    check(name, Array.isArray(code) ? code.includes(e.code) : e.code === code, {
      code: e.code,
    });
  }
}
let creates = [],
  refunds = [],
  sessions = new Map(),
  refundCache = new Map(),
  retrievedSession: any,
  retrievedCharge: any;
const stripe: any = {
  checkout: {
    sessions: {
      create: async (body, opts) => {
        creates.push({ body, opts });
        const prior = sessions.get(opts.idempotencyKey);
        if (prior) return prior;
        const session = {
          id: "cs_" + randomUUID(),
          url: "https://checkout.stripe.com/synthetic",
          status: "open",
          metadata: body.metadata,
          amount_total: body.line_items[0].price_data.unit_amount,
          currency: "usd",
          payment_status: "unpaid",
          payment_intent: "pi_" + randomUUID(),
          livemode: false,
        };
        sessions.set(opts.idempotencyKey, session);
        return session;
      },
      retrieve: async (id) =>
        retrievedSession || [...sessions.values()].find((s) => s.id === id),
      expire: async (id) => {
        const session = [...sessions.values()].find((s) => s.id === id);
        if (!session) throw Error("Unknown synthetic checkout");
        session.status = "expired";
        return session;
      },
    },
  },
  refunds: {
    create: async (body, opts) => {
      refunds.push({ body, opts });
      if (refundCache.has(opts.idempotencyKey))
        return refundCache.get(opts.idempotencyKey);
      const r = {
        id: "re_" + randomUUID(),
        status: "succeeded",
        amount: body.amount,
        payment_intent: body.payment_intent,
        metadata: body.metadata,
      };
      refundCache.set(opts.idempotencyKey, r);
      return r;
    },
    list: async (input) => ({
      data: [...refundCache.values()].filter(
        (r) => r.payment_intent === input.payment_intent,
      ),
      has_more: false,
    }),
  },
  paymentIntents: {
    retrieve: async () => ({ latest_charge: retrievedCharge }),
  },
};
const provider = async () => stripe;
process.env.STRIPE_MODE = "test";
process.env.WEB_ORIGIN = "http://127.0.0.1:3100";
async function gift() {
  return prisma.giftOrder.create({
    data: {
      matterId: mid,
      selection: { requested: true },
      status: "awaiting_catalog",
    },
  });
}
async function quote(g) {
  return quoteGift(actor, g.id, {
    revision: g.revision,
    description: "Independent approved gift",
    amountCents: 6500,
    currency: "USD",
    policy: "Independent explicit ordering and refund policy.",
    approved: true,
  });
}
async function checkout(g, key = "checkout-" + randomUUID()) {
  return createCheckout(
    actor,
    { matterId: mid, kind: "gift", giftOrderId: g.id, idempotencyKey: key },
    provider,
  );
}
async function paid(orderId) {
  const order = await prisma.paymentOrder.findUniqueOrThrow({
    where: { id: orderId },
  });
  const s = [...sessions.values()].find((s) => s.id === order.stripeSessionId);
  await applyStripeEvent({
    id: "evt_" + randomUUID(),
    type: "checkout.session.completed",
    livemode: false,
    data: { object: { ...s, status: "complete", payment_status: "paid" } },
  } as any);
  return prisma.paymentOrder.findUniqueOrThrow({ where: { id: orderId } });
}
try {
  await prisma.matter.create({
    data: {
      id: mid,
      title: "Independent billing fixture",
      propertyAddress: "Synthetic Review Lane",
      side: "buyer",
      packageCode: "complete",
    },
  });
  let g = await gift();
  await denied(
    "Agent cannot approve gift quote",
    () =>
      quoteGift({ ...actor, role: "agent" }, g.id, {
        revision: 1,
        description: "X",
        amountCents: 6500,
        currency: "USD",
        policy: "Synthetic policy",
        approved: true,
      }),
    "FORBIDDEN",
  );
  await denied(
    "Unapproved gift cannot enter checkout",
    () => checkout(g),
    "GIFT_UNAPPROVED",
  );
  await denied(
    "Unpaid gift cannot be ordered",
    () =>
      fulfillGift(actor, g.id, {
        revision: 1,
        status: "ordered",
        note: "Synthetic attempt",
      }),
    "GIFT_PAYMENT_REQUIRED",
  );
  g = await quote(g);
  await denied(
    "Stale gift quote rejected",
    () => quote({ ...g, revision: 1 }),
    "GIFT_CHANGED",
  );
  const concurrent = await Promise.all([checkout(g), checkout(g)]);
  check(
    "Concurrent checkout binds one saved payment",
    concurrent[0].id === concurrent[1].id &&
      (await prisma.paymentOrder.count({
        where: { matterId: mid, kind: "gift" },
      })) === 1,
  );
  check(
    "Provider checkout retries use one stable idempotency key",
    new Set(creates.map((x) => x.opts.idempotencyKey)).size === 1,
  );
  check(
    "Provider amount derives from approved quote",
    creates.every((x) => x.body.line_items[0].price_data.unit_amount === 6500),
  );
  const orderId = concurrent[0].id;
  let current = await prisma.giftOrder.findUniqueOrThrow({
    where: { id: g.id },
  });
  await denied(
    "Checkout redirect does not confer paid state",
    () =>
      fulfillGift(actor, g.id, {
        revision: current.revision,
        status: "ordered",
        note: "Synthetic unpaid",
      }),
    "GIFT_PAYMENT_REQUIRED",
  );
  await paid(orderId);
  current = await prisma.giftOrder.findUniqueOrThrow({ where: { id: g.id } });
  await denied(
    "Paid gift cannot jump straight to delivered",
    () =>
      fulfillGift(actor, g.id, {
        revision: current.revision,
        status: "delivered",
        note: "Synthetic direct delivery",
      }),
    "GIFT_TRANSITION",
  );
  const fulfilled = await Promise.allSettled([
    fulfillGift(actor, g.id, {
      revision: current.revision,
      status: "ordered",
      note: "First synthetic order",
    }),
    fulfillGift(actor, g.id, {
      revision: current.revision,
      status: "ordered",
      note: "Concurrent duplicate order",
    }),
  ]);
  check(
    "Concurrent same-revision order has one winner",
    fulfilled.filter((x) => x.status === "fulfilled").length === 1 &&
      fulfilled.filter(
        (x) => x.status === "rejected" && x.reason.code === "REVISION_CONFLICT",
      ).length === 1,
  );
  current = await prisma.giftOrder.findUniqueOrThrow({ where: { id: g.id } });
  const delivered = await fulfillGift(actor, g.id, {
    revision: current.revision,
    status: "delivered",
    note: "Synthetic delivery evidence",
  });
  await denied(
    "Delivered gift cannot be cancelled",
    () =>
      fulfillGift(actor, g.id, {
        revision: delivered.revision,
        status: "cancelled",
        note: "Late cancellation",
      }),
    "GIFT_CLOSED",
  );
  const refundKey = "same-refund-" + suffix,
    refundInput = {
      amountCents: 1000,
      reason: "Synthetic approved partial refund",
      idempotencyKey: refundKey,
      confirmed: true,
    };
  await denied(
    "Agent cannot request refund",
    () =>
      refundPayment(
        { ...actor, role: "agent" },
        orderId,
        refundInput,
        provider,
      ),
    "FORBIDDEN",
  );
  await denied(
    "Over-balance refund denied",
    () =>
      refundPayment(
        actor,
        orderId,
        { ...refundInput, amountCents: 7000 },
        provider,
      ),
    "REFUND_UNAVAILABLE",
  );
  const before = refunds.length;
  const replays = await Promise.all([
    refundPayment(actor, orderId, refundInput, provider),
    refundPayment(actor, orderId, refundInput, provider),
  ]);
  check(
    "Concurrent identical refund requests call provider once",
    refunds.length - before === 1 && replays.every((x) => x.requested),
  );
  check(
    "Refund provider key binds payment and client key",
    refunds.at(-1).opts.idempotencyKey ===
      "refund:" + orderId + ":" + refundKey,
  );
  await denied(
    "Reusing refund key with a changed amount conflicts",
    () =>
      refundPayment(
        actor,
        orderId,
        { ...refundInput, amountCents: 2000 },
        provider,
      ),
    "IDEMPOTENCY_CONFLICT",
  );
  const ord = await prisma.paymentOrder.findUniqueOrThrow({
    where: { id: orderId },
  });
  const sess = [...sessions.values()].find((s) => s.id === ord.stripeSessionId);
  retrievedSession = {
    ...sess,
    status: "complete",
    payment_status: "paid",
    metadata: { paymentOrderId: "wrong-order" },
  };
  await denied(
    "Reconciliation refuses incorrect order metadata",
    () => reconcilePayment(actor, orderId, provider),
    "PAYMENT_MISMATCH",
  );
  retrievedSession = {
    ...sess,
    status: "complete",
    payment_status: "paid",
    amount_total: 6501,
  };
  await denied(
    "Reconciliation refuses incorrect amount",
    () => reconcilePayment(actor, orderId, provider),
    "PAYMENT_AMOUNT_MISMATCH",
  );
  retrievedSession = { ...sess, status: "complete", payment_status: "paid" };
  retrievedCharge = {
    id: "ch_" + suffix,
    payment_intent: sess.payment_intent,
    metadata: { paymentOrderId: orderId },
    amount: 6500,
    amount_refunded: 6500,
    refunded: true,
    livemode: false,
  };
  const reconciled = await reconcilePayment(actor, orderId, provider);
  check(
    "Retrieved Stripe refund evidence establishes refunded state",
    reconciled.status === "refunded" &&
      reconciled.details.refundedCents === 6500,
  );
  retrievedCharge = {
    ...retrievedCharge,
    amount_refunded: 1000,
    refunded: false,
  };
  const stale = await reconcilePayment(actor, orderId, provider);
  check(
    "Older partial refund evidence cannot downgrade full refund",
    stale.status === "refunded" && stale.details.refundedCents === 6500,
  );
  // Separate gift remains unpaid: cancellation must not advertise another usable checkout.
  retrievedSession = undefined;
  let cancelledGift = await quote(await gift());
  const cancelOrder = await checkout(cancelledGift);
  cancelledGift = await prisma.giftOrder.findUniqueOrThrow({
    where: { id: cancelledGift.id },
  });
  await fulfillGift(
    actor,
    cancelledGift.id,
    {
      revision: cancelledGift.revision,
      status: "cancelled",
      note: "Synthetic customer withdrew before paying",
    },
    provider,
  );
  try {
    const cancelledCheckout = await checkout(cancelledGift);
    check(
      "Cancelled gift cannot return an active payment URL",
      !cancelledCheckout.url,
      {
        status: cancelledCheckout.status,
        urlReturned: Boolean(cancelledCheckout.url),
      },
    );
  } catch (e) {
    check(
      "Cancelled gift cannot return an active payment URL",
      ["GIFT_CLOSED", "PAYMENT_CLOSED"].includes(e.code),
      { code: e.code },
    );
  }
  check(
    "Cancellation expires the previously issued provider checkout",
    [...sessions.values()].find(
      (s) => s.id === sessions.get("checkout:" + cancelOrder.id)?.id,
    )?.status === "expired",
  );
  // A successful refund request must prevent new fulfillment while webhook/reconciliation catches up.
  let refundGift = await quote(await gift());
  const refundable = await checkout(refundGift);
  await paid(refundable.id);
  await refundPayment(
    actor,
    refundable.id,
    {
      ...refundInput,
      amountCents: 6500,
      idempotencyKey: "full-refund-" + suffix,
    },
    provider,
  );
  refundGift = await prisma.giftOrder.findUniqueOrThrow({
    where: { id: refundGift.id },
  });
  await denied(
    "Acknowledged full refund blocks ordering before webhook arrives",
    () =>
      fulfillGift(actor, refundGift.id, {
        revision: refundGift.revision,
        status: "ordered",
        note: "Synthetic race after refund accepted",
      }),
    ["GIFT_PAYMENT_REQUIRED", "REFUND_HOLD"],
  );
  let reserveGift = await quote(await gift());
  const reserveOrder = await checkout(reserveGift);
  await paid(reserveOrder.id);
  await refundPayment(
    actor,
    reserveOrder.id,
    {
      ...refundInput,
      amountCents: 4000,
      idempotencyKey: "reserve-first-" + suffix,
    },
    provider,
  );
  await denied(
    "Acknowledged refund reservations reduce remaining refundable balance",
    () =>
      refundPayment(
        actor,
        reserveOrder.id,
        {
          ...refundInput,
          amountCents: 4000,
          idempotencyKey: "reserve-second-" + suffix,
        },
        provider,
      ),
    "REFUND_UNAVAILABLE",
  );
  let raceGift = await quote(await gift());
  const raceOrder = await checkout(raceGift);
  await paid(raceOrder.id);
  raceGift = await prisma.giftOrder.findUniqueOrThrow({
    where: { id: raceGift.id },
  });
  let release, entered;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  const normalRefund = stripe.refunds.create;
  stripe.refunds.create = async (body, opts) => {
    const accepted = await normalRefund(body, opts);
    entered();
    await gate;
    return accepted;
  };
  const inFlightRefund = refundPayment(
    actor,
    raceOrder.id,
    {
      ...refundInput,
      amountCents: 6500,
      idempotencyKey: "race-refund-" + suffix,
    },
    provider,
  );
  await started;
  let orderSettled = false;
  const inFlightFulfill = fulfillGift(actor, raceGift.id, {
    revision: raceGift.revision,
    status: "ordered",
    note: "Concurrent with accepted refund",
  }).then(
    (v) => {
      orderSettled = true;
      return { accepted: true, value: v };
    },
    (e) => {
      orderSettled = true;
      return { accepted: false, code: e.code };
    },
  );
  await new Promise((r) => setTimeout(r, 150));
  const serialized = !orderSettled;
  release();
  await inFlightRefund;
  const raceResult = await inFlightFulfill;
  stripe.refunds.create = normalRefund;
  check(
    "Fulfillment serializes with refund and rejects accepted refunded funds",
    !raceResult.accepted && (serialized || raceResult.code === "REFUND_HOLD"),
    { serialized, accepted: raceResult.accepted, code: raceResult.code },
  );
  let uncertainGift = await quote(await gift());
  const uncertainOrder = await checkout(uncertainGift);
  await paid(uncertainOrder.id);
  uncertainGift = await prisma.giftOrder.findUniqueOrThrow({
    where: { id: uncertainGift.id },
  });
  stripe.refunds.create = async (body, opts) => {
    await normalRefund(body, opts);
    throw Error("Synthetic response lost after provider accepted");
  };
  let lostResponse;
  try {
    lostResponse = await refundPayment(
      actor,
      uncertainOrder.id,
      {
        ...refundInput,
        amountCents: 6500,
        idempotencyKey: "response-lost-" + suffix,
      },
      provider,
    );
  } catch (e) {
    lostResponse = { error: e.message };
  }
  stripe.refunds.create = normalRefund;
  await denied(
    "Provider-accepted response loss leaves durable fulfillment hold",
    () =>
      fulfillGift(actor, uncertainGift.id, {
        revision: uncertainGift.revision,
        status: "ordered",
        note: "Attempt after refund response lost",
      }),
    ["GIFT_PAYMENT_REQUIRED", "REFUND_HOLD"],
  );
  retrievedSession = undefined;
  retrievedCharge = null;
  let releaseGift = await quote(await gift());
  const releaseOrder = await checkout(releaseGift);
  await paid(releaseOrder.id);
  await refundPayment(
    actor,
    releaseOrder.id,
    {
      ...refundInput,
      amountCents: 2500,
      idempotencyKey: "release-hold-" + suffix,
    },
    provider,
  );
  const providerRefund = refundCache.get(
    "refund:" + releaseOrder.id + ":release-hold-" + suffix,
  );
  providerRefund.status = "failed";
  const released = await reconcilePayment(actor, releaseOrder.id, provider);
  check(
    "Verified failed refund releases its matching reservation",
    released.details.refundRequests.some(
      (r) => r.key === "release-hold-" + suffix && r.status === "failed",
    ),
  );
  releaseGift = await prisma.giftOrder.findUniqueOrThrow({
    where: { id: releaseGift.id },
  });
  const afterFailed = await fulfillGift(actor, releaseGift.id, {
    revision: releaseGift.revision,
    status: "ordered",
    note: "Verified refund failed; original payment available",
  });
  check(
    "Verified failed refund permits original paid fulfillment",
    afterFailed.status === "ordered",
  );
  let missingGift = await quote(await gift());
  const missingOrder = await checkout(missingGift);
  await paid(missingOrder.id);
  await refundPayment(
    actor,
    missingOrder.id,
    {
      ...refundInput,
      amountCents: 2500,
      idempotencyKey: "missing-evidence-" + suffix,
    },
    provider,
  );
  const oldList = stripe.refunds.list;
  stripe.refunds.list = async () => ({ data: [], has_more: false });
  await reconcilePayment(actor, missingOrder.id, provider);
  stripe.refunds.list = oldList;
  missingGift = await prisma.giftOrder.findUniqueOrThrow({
    where: { id: missingGift.id },
  });
  await denied(
    "Missing provider refund evidence cannot release durable hold",
    () =>
      fulfillGift(actor, missingGift.id, {
        revision: missingGift.revision,
        status: "ordered",
        note: "Attempt with absent refund evidence",
      }),
    "REFUND_HOLD",
  );
  let mixedGift = await quote(await gift());
  const mixedOrder = await checkout(mixedGift);
  await paid(mixedOrder.id);
  await prisma.paymentOrder.update({
    where: { id: mixedOrder.id },
    data: {
      status: "partially_refunded",
      details: {
        refundedCents: 1000,
        externalRefundEvidence:
          "synthetic-dashboard-refund-distinct-from-local",
      },
    },
  });
  await refundPayment(
    actor,
    mixedOrder.id,
    {
      ...refundInput,
      amountCents: 1000,
      idempotencyKey: "mixed-local-" + suffix,
    },
    provider,
  );
  await denied(
    "Distinct prior external refund plus new local success both reduce balance",
    () =>
      refundPayment(
        actor,
        mixedOrder.id,
        {
          ...refundInput,
          amountCents: 5000,
          idempotencyKey: "mixed-overbalance-" + suffix,
        },
        provider,
      ),
    "REFUND_UNAVAILABLE",
  );
  const mixedStored = await prisma.paymentOrder.findUniqueOrThrow({
    where: { id: mixedOrder.id },
  });
  const localEvidence = refundCache.get(
    "refund:" + mixedOrder.id + ":mixed-local-" + suffix,
  );
  refundCache.set("dashboard:" + suffix, {
    id: "re_dashboard_" + suffix,
    status: "succeeded",
    amount: 1000,
    payment_intent: mixedStored.stripePaymentIntentId,
    metadata: {},
  });
  retrievedSession = undefined;
  retrievedCharge = {
    id: "ch_mixed_" + suffix,
    payment_intent: mixedStored.stripePaymentIntentId,
    metadata: { paymentOrderId: mixedOrder.id },
    amount: 6500,
    amount_refunded: 1000,
    refunded: false,
    livemode: false,
  };
  const inconsistent = await reconcilePayment(actor, mixedOrder.id, provider);
  check(
    "Inconsistent charge/list snapshots cannot mark local refund accounted",
    !inconsistent.details.refundRequests.find(
      (r) => r.key === "mixed-local-" + suffix,
    ).accounted,
  );
  retrievedCharge = { ...retrievedCharge, amount_refunded: 2000 };
  const realList = stripe.refunds.list;
  stripe.refunds.list = async () => ({ data: [localEvidence], has_more: true });
  const incomplete = await reconcilePayment(actor, mixedOrder.id, provider);
  check(
    "Incomplete refund pagination preserves unaccounted reservation",
    !incomplete.details.refundRequests.find(
      (r) => r.key === "mixed-local-" + suffix,
    ).accounted,
  );
  stripe.refunds.list = realList;
  const correlated = await reconcilePayment(actor, mixedOrder.id, provider);
  check(
    "Complete matching refund list proves local refund is already in aggregate",
    correlated.details.refundedCents === 2000 &&
      correlated.details.refundRequests.find(
        (r) => r.key === "mixed-local-" + suffix,
      ).accounted === true,
  );
  await denied(
    "Reconciled mixed refunds reject one cent above remaining balance",
    () =>
      refundPayment(
        actor,
        mixedOrder.id,
        {
          ...refundInput,
          amountCents: 4501,
          idempotencyKey: "post-correlation-over-" + suffix,
        },
        provider,
      ),
    "REFUND_UNAVAILABLE",
  );
  const exactRemaining = await refundPayment(
    actor,
    mixedOrder.id,
    {
      ...refundInput,
      amountCents: 4500,
      idempotencyKey: "post-correlation-exact-" + suffix,
    },
    provider,
  );
  check(
    "Reconciliation permits exact4500-cent remaining balance without double count",
    exactRemaining.requested === true,
  );
  await denied(
    "New reservation exhausts remaining balance exactly",
    () =>
      refundPayment(
        actor,
        mixedOrder.id,
        {
          ...refundInput,
          amountCents: 1,
          idempotencyKey: "post-correlation-empty-" + suffix,
        },
        provider,
      ),
    "REFUND_UNAVAILABLE",
  );
  const filtered = await queryStoredRecords(actor, {
    kind: "matters",
    matterId: mid,
    limit: 100,
  });
  check(
    "Primary matter filter is an authorized singleton",
    filtered.items.length === 1 && filtered.items[0].id === mid,
  );
  console.log(
    JSON.stringify(
      {
        candidate: "f3b1338",
        checks: checks.length,
        failed: checks.filter((x) => !x.pass).length,
        externalCalls: "none; injected fake provider only",
        results: checks,
      },
      null,
      2,
    ),
  );
} finally {
  const p = await prisma.paymentOrder.findMany({
    where: { matterId: mid },
    select: { id: true },
  });
  await prisma.auditEvent.deleteMany({ where: { matterId: mid } });
  await prisma.giftOrder.deleteMany({ where: { matterId: mid } });
  await prisma.paymentOrder.deleteMany({ where: { matterId: mid } });
  await prisma.matter.deleteMany({ where: { id: mid } });
  await prisma.$disconnect();
}
