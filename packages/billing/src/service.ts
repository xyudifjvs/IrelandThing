import Stripe from "stripe";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import {
  HttpError,
  assertCoordinator,
  type Principal,
} from "@weatherly/platform";
import { audit, requireMatter, matterScope } from "@weatherly/matters";
import { checkoutInput } from "./contracts";
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
export async function listCatalog() {
  return prisma.catalogItem.findMany({
    where: { code: { in: ["essentials", "complete", "full_listing"] } },
    orderBy: { priceCents: "asc" },
  });
}
const pageOptions = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(200),
});
export async function listPayments(
  actor: Principal,
  matterId?: string,
  options: { cursor?: string; limit?: number } = {},
) {
  const page = pageOptions.parse(options);
  if (matterId) await requireMatter(actor, matterId);
  if (actor.role === "client") return [];
  const matters = await prisma.matter.findMany({
    where: { ...matterScope(actor), ...(matterId ? { id: matterId } : {}) },
    select: { id: true },
  });
  return prisma.paymentOrder.findMany({
    where: { matterId: { in: matters.map((m) => m.id) } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: page.limit,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  });
}
export async function createCheckout(
  actor: Principal,
  raw: unknown,
  provider = verifiedStripe,
) {
  // Fee timing is intentionally explicit: only Ireland initiates a request.
  assertCoordinator(actor);
  const input = checkoutInput.parse(raw);
  const stripe = await provider();
  const order = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.kind}-payment:${input.matterId}`}))`;
    const matter = await requireMatter(actor, input.matterId, false, tx);
    if (input.kind === "gift") {
      if (!input.giftOrderId)
        throw new HttpError(
          422,
          "GIFT_REQUIRED",
          "Choose a saved gift request.",
        );
      await tx.$queryRaw`SELECT id FROM "GiftOrder" WHERE id=${input.giftOrderId} FOR UPDATE`;
      const gift = await tx.giftOrder.findUnique({
        where: { id: input.giftOrderId },
      });
      if (!gift || gift.matterId !== matter.id)
        throw new HttpError(404, "NOT_FOUND", "Gift request not found.");
      if (gift.status === "cancelled")
        throw new HttpError(
          409,
          "GIFT_CLOSED",
          "This gift was cancelled and cannot be paid.",
        );
      if (gift.paymentOrderId)
        return tx.paymentOrder.findUniqueOrThrow({
          where: { id: gift.paymentOrderId },
        });
      const quote = (gift.selection as Record<string, Prisma.JsonValue>)
        .approvedQuote as
        | {
            description?: string;
            amountCents?: number;
            currency?: string;
            policy?: string;
          }
        | undefined;
      if (
        gift.status !== "quoted" ||
        !quote?.description ||
        !Number.isSafeInteger(quote.amountCents) ||
        !quote.policy ||
        quote.currency !== "USD"
      )
        throw new HttpError(
          409,
          "GIFT_UNAPPROVED",
          "Ireland must approve the actual gift, total and fulfillment policy first.",
        );
      const result = await tx.paymentOrder.create({
        data: {
          matterId: matter.id,
          createdById: actor.id,
          idempotencyKey: `gift:${gift.id}:${input.idempotencyKey}`,
          kind: "gift",
          amountCents: quote.amountCents!,
          currency: "USD",
          status: "creating",
          snapshot: {
            ...quote,
            name: quote.description,
            giftOrderId: gift.id,
            giftRevision: gift.revision,
          },
        },
      });
      await tx.giftOrder.update({
        where: { id: gift.id },
        data: {
          paymentOrderId: result.id,
          status: "awaiting_payment",
          revision: { increment: 1 },
        },
      });
      await audit(
        tx,
        actor,
        "gift.payment_requested",
        "PaymentOrder",
        result.id,
        matter.id,
        { giftOrderId: gift.id, amountCents: result.amountCents },
      );
      return result;
    }
    const catalog = await tx.catalogItem.findUnique({
      where: { code: matter.packageCode },
    });
    if (!catalog?.approved)
      throw new HttpError(
        409,
        "CATALOG_UNAPPROVED",
        "Approve the service price before requesting payment.",
      );
    if (input.catalogRevision && input.catalogRevision !== catalog.revision)
      throw new HttpError(
        409,
        "STALE_CATALOG",
        "The price changed. Review the current catalog.",
      );
    const existing = await tx.paymentOrder.findFirst({
      where: {
        matterId: matter.id,
        kind: "service",
        status: { notIn: ["expired", "failed", "refunded"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return existing;
    const key = `service:${matter.id}:${input.idempotencyKey}`;
    const previous = await tx.paymentOrder.findUnique({
      where: { idempotencyKey: key },
    });
    if (previous) return previous;
    const result = await tx.paymentOrder.create({
      data: {
        matterId: matter.id,
        createdById: actor.id,
        idempotencyKey: key,
        kind: "service",
        amountCents: catalog.priceCents,
        currency: catalog.currency,
        status: "creating",
        snapshot: {
          code: catalog.code,
          name: catalog.name,
          revision: catalog.revision,
          priceCents: catalog.priceCents,
          currency: catalog.currency,
        },
      },
    });
    await audit(
      tx,
      actor,
      "payment.requested",
      "PaymentOrder",
      result.id,
      matter.id,
      { amountCents: result.amountCents, currency: result.currency },
    );
    return result;
  });
  if (
    ["paid", "refunded", "partially_refunded", "disputed"].includes(
      order.status,
    )
  )
    return { id: order.id, status: order.status, url: null };
  if (order.stripeSessionId) {
    const session = await stripe.checkout.sessions.retrieve(
      order.stripeSessionId,
    );
    return {
      id: order.id,
      status: order.status,
      url: session.status === "open" ? session.url : null,
    };
  }
  if (order.status !== "creating")
    throw new HttpError(
      409,
      "PAYMENT_CLOSED",
      "This request is closed. Create a new payment request.",
    );
  const origin = process.env.WEB_ORIGIN!;
  const snapshot = order.snapshot as { name: string };
  // Provider idempotency survives a crash after Stripe accepted the request.
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
  await prisma.paymentOrder.updateMany({
    where: { id: order.id, stripeSessionId: null },
    data: { stripeSessionId: session.id, status: "pending" },
  });
  return { id: order.id, status: "pending", url: session.url };
}

export async function applyStripeEvent(event: Stripe.Event) {
  assertPaymentEvent(event);
  const checkoutTypes = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
  ];
  if (
    !checkoutTypes.includes(event.type) &&
    event.type !== "charge.refunded" &&
    event.type !== "charge.dispute.created"
  )
    return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stripe-event:${event.id}`}))`;
    if (
      await tx.webhookReceipt.findUnique({
        where: { provider_eventId: { provider: "stripe", eventId: event.id } },
      })
    )
      return;
    if (checkoutTypes.includes(event.type)) {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.paymentOrderId;
      if (!orderId) return;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${orderId}`}))`;
      const order = await tx.paymentOrder.findUnique({
        where: { id: orderId },
      });
      if (
        !order ||
        (order.stripeSessionId && order.stripeSessionId !== session.id)
      )
        throw new HttpError(
          400,
          "PAYMENT_MISMATCH",
          "Unknown checkout session.",
        );
      if (
        session.amount_total !== order.amountCents ||
        session.currency?.toUpperCase() !== order.currency
      )
        throw new HttpError(
          400,
          "PAYMENT_AMOUNT_MISMATCH",
          "Checkout total does not match the saved order.",
        );
      let status = order.status;
      if (!["refunded", "partially_refunded", "disputed"].includes(status)) {
        if (session.payment_status === "paid") status = "paid";
        else if (status !== "paid" && event.type === "checkout.session.expired")
          status = "expired";
        else if (
          status !== "paid" &&
          event.type === "checkout.session.async_payment_failed"
        )
          status = "failed";
      }
      await tx.paymentOrder.update({
        where: { id: order.id },
        data: {
          status,
          stripeSessionId: session.id,
          stripePaymentIntentId:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id,
          details: {
            ...(order.details as Record<string, Prisma.InputJsonValue>),
            lastStripeEvent: event.id,
          },
        },
      });
      if (status === "paid")
        await tx.giftOrder.updateMany({
          where: { paymentOrderId: order.id, status: "awaiting_payment" },
          data: { status: "paid", revision: { increment: 1 } },
        });
    } else {
      const object = event.data.object as Stripe.Charge | Stripe.Dispute;
      const intent =
        typeof object.payment_intent === "string"
          ? object.payment_intent
          : object.payment_intent?.id;
      if (intent) {
        const order = await tx.paymentOrder.findFirst({
          where: {
            OR: [
              { stripePaymentIntentId: intent },
              ...(object.metadata?.paymentOrderId
                ? [{ id: object.metadata.paymentOrderId }]
                : []),
            ],
          },
        });
        if (order) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${order.id}`}))`;
          const current = await tx.paymentOrder.findUniqueOrThrow({
            where: { id: order.id },
          });
          const details = current.details as Record<
            string,
            Prisma.InputJsonValue
          >;
          const refundedCents = Math.max(
            Number(details.refundedCents || 0),
            event.type === "charge.refunded"
              ? (object as Stripe.Charge).amount_refunded
              : 0,
          );
          const status =
            event.type === "charge.dispute.created" ||
            current.status === "disputed"
              ? "disputed"
              : current.status === "refunded" ||
                  refundedCents >= current.amountCents ||
                  (object as Stripe.Charge).refunded
                ? "refunded"
                : "partially_refunded";
          await tx.paymentOrder.update({
            where: { id: order.id },
            data: {
              status,
              details: { ...details, refundedCents, lastStripeEvent: event.id },
            },
          });
        } else {
          throw new HttpError(
            409,
            "PAYMENT_NOT_YET_RECONCILED",
            "The checkout event must be reconciled before this payment update.",
          );
        }
      }
    }
    await tx.webhookReceipt.create({
      data: { provider: "stripe", eventId: event.id, processedAt: new Date() },
    });
    await tx.auditEvent.create({
      data: {
        actorId: "stripe-webhook",
        action: "payment.provider_event",
        entityType: "WebhookReceipt",
        entityId: event.id,
        details: { type: event.type },
      },
    });
  });
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
export async function listGifts(
  actor: Principal,
  matterId?: string,
  options: { cursor?: string; limit?: number } = {},
) {
  const page = pageOptions.parse(options);
  if (matterId) await requireMatter(actor, matterId);
  if (actor.role === "client") return [];
  const matters = await prisma.matter.findMany({
    where: { ...matterScope(actor), ...(matterId ? { id: matterId } : {}) },
    select: { id: true },
  });
  return prisma.giftOrder.findMany({
    where: { matterId: { in: matters.map((m) => m.id) } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: page.limit,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  });
}
export async function recordIntakeGift(matterId: string, submissionId: string) {
  const submission = await prisma.intakeSubmission.findUnique({
    where: { id: submissionId },
  });
  if (!submission || submission.matterId !== matterId)
    throw new Error("Intake submission missing");
  const snapshot = submission.snapshot as Record<string, unknown>;
  const gift = snapshot.gift;
  if (
    !gift ||
    typeof gift !== "object" ||
    (gift as { requested?: boolean }).requested === false
  )
    return;
  // Deterministic ID makes at-least-once outbox delivery safe. No fulfillment without a paid approved gift quote.
  await prisma.giftOrder.upsert({
    where: { id: `intake-gift-${submissionId}` },
    create: {
      id: `intake-gift-${submissionId}`,
      matterId,
      selection: gift as Prisma.InputJsonValue,
      status: "awaiting_catalog",
    },
    update: {},
  });
}
