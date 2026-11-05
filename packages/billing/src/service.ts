import Stripe from "stripe";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import {
  HttpError,
  assertCoordinator,
  type Principal,
} from "@weatherly/platform";
import {
  audit,
  requireMatter,
  matterScope,
  fileReviewPending,
} from "@weatherly/matters";
import { checkoutInput } from "./contracts";
import {
  isPreClosingTermination,
  queueTerminatedServiceCheckouts,
} from "./termination";
import {
  paymentMode,
  assertPaymentKey,
  assertPaymentEvent,
  assertSavedPaymentEnvironment,
  savedPaymentEnvironment,
} from "./mode";

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
const serviceTerms = z.object({
  code: z.enum(["essentials", "complete"]),
  name: z.string().trim().min(1).max(200),
  revision: z.number().int().positive(),
  priceCents: z.number().int().positive(),
  currency: z.literal("USD"),
});

export async function createCheckout(
  actor: Principal,
  raw: unknown,
  provider = verifiedStripe,
) {
  // Service fees are due at closing. Only an explicit Ireland action issues
  // checkout; intake/agent reads never create or release a payment request.
  assertCoordinator(actor);
  const input = checkoutInput.parse(raw);
  const stripe = await provider();
  const order = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.kind}-payment:${input.matterId}`}))`;
    const matter = await requireMatter(actor, input.matterId, true, tx);
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
          details: { paymentEnvironment: paymentMode() },
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
    const existing = await tx.paymentOrder.findFirst({
      where: {
        matterId: matter.id,
        kind: "service",
        status: { notIn: ["expired", "failed", "refunded"] },
      },
      orderBy: { createdAt: "desc" },
    });
    const key = `service:${matter.id}:${input.idempotencyKey}`;
    const previous = await tx.paymentOrder.findUnique({
      where: { idempotencyKey: key },
    });
    const retained = existing || previous;
    if (
      (matter.stage === "terminated" || isPreClosingTermination(matter)) &&
      (!retained ||
        !["paid", "refunded", "partially_refunded", "disputed"].includes(
          retained.status,
        ))
    )
      throw new HttpError(
        409,
        "SERVICE_NOT_DUE_TERMINATED",
        "No service fee is due for a transaction that terminates before closing. Existing payments require Ireland's review; no refund is automatic.",
      );
    if (retained) return retained;
    if (matter.packageCode === "full_listing")
      throw new HttpError(
        409,
        "SERVICE_COMING_SOON",
        "Full Listing is coming soon and cannot receive a new payment request.",
      );
    if (
      fileReviewPending(matter) ||
      !["closing", "closed"].includes(matter.stage)
    )
      throw new HttpError(
        409,
        "SERVICE_NOT_DUE",
        "Confirm the file and move it to Closing before issuing a new service payment request. The service fee is due at closing.",
      );
    const catalog = await tx.catalogItem.findUnique({
      where: { code: matter.packageCode },
    });
    if (!catalog?.approved)
      throw new HttpError(
        409,
        "CATALOG_UNAPPROVED",
        "Approve the service price before requesting payment.",
      );
    const matterDetails =
      matter.details &&
      typeof matter.details === "object" &&
      !Array.isArray(matter.details)
        ? (matter.details as Record<string, Prisma.JsonValue>)
        : {};
    const savedTerms = matterDetails.serviceSnapshot;
    const parsedTerms = serviceTerms.safeParse(
      savedTerms === undefined ? catalog : savedTerms,
    );
    if (!parsedTerms.success)
      throw new HttpError(
        409,
        "INVALID_SERVICE_SNAPSHOT",
        "Review this transaction's approved service and price before requesting payment.",
      );
    const approvedService = parsedTerms.data;
    if (approvedService.code !== matter.packageCode)
      throw new HttpError(
        409,
        "SERVICE_PACKAGE_MISMATCH",
        "The transaction package differs from its approved service snapshot. Ireland must review the package before requesting payment.",
      );
    if (
      input.catalogRevision &&
      input.catalogRevision !== approvedService.revision
    )
      throw new HttpError(
        409,
        "STALE_CATALOG",
        "The approved service terms changed. Review this transaction's saved service and price.",
      );
    const result = await tx.paymentOrder.create({
      data: {
        matterId: matter.id,
        createdById: actor.id,
        idempotencyKey: key,
        kind: "service",
        amountCents: approvedService.priceCents,
        currency: approvedService.currency,
        status: "creating",
        details: {
          paymentEnvironment: paymentMode(),
          dueAtClosing: true,
          noFeeIfTerminatedBeforeClosing: true,
          requestInitiatedBy: "coordinator",
          requestedById: actor.id,
          matterStageAtRequest: matter.stage,
        },
        snapshot: {
          ...approvedService,
          dueAtClosing: true,
          noFeeIfTerminatedBeforeClosing: true,
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
  assertSavedPaymentEnvironment(order.details, paymentMode());
  if (
    ["paid", "refunded", "partially_refunded", "disputed"].includes(
      order.status,
    )
  )
    return { id: order.id, status: order.status, url: null };
  if (savedPaymentEnvironment(order.details) === "unknown")
    throw new HttpError(
      409,
      "PAYMENT_ENVIRONMENT_UNKNOWN",
      "Reconcile this request in its original payment environment before opening checkout.",
    );
  if (
    order.kind === "service" &&
    ["void_pending", "cancelled", "requires_reconciliation"].includes(
      order.status,
    )
  )
    throw new HttpError(
      409,
      "PAYMENT_CLOSED",
      "This service request is closed or requires Ireland's reconciliation.",
    );
  if (order.stripeSessionId) {
    const session = await stripe.checkout.sessions.retrieve(
      order.stripeSessionId,
    );
    if (order.kind === "service") {
      await prisma.$transaction(async (tx) => {
        const matter = await requireMatter(actor, order.matterId, true, tx);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${order.id}`}))`;
        const current = await tx.paymentOrder.findUniqueOrThrow({
          where: { id: order.id },
        });
        if (
          matter.stage === "terminated" ||
          isPreClosingTermination(matter) ||
          current.status !== "pending"
        )
          throw new HttpError(
            409,
            "PAYMENT_CLOSED",
            "This request changed while checkout was opening; review the current payment record.",
          );
        if (
          current.stripeSessionId !== session.id ||
          session.metadata?.paymentOrderId !== current.id ||
          session.livemode !== (paymentMode() === "live") ||
          session.amount_total !== current.amountCents ||
          session.currency?.toUpperCase() !== current.currency
        )
          throw new HttpError(
            409,
            "PAYMENT_MISMATCH",
            "The provider checkout does not match this approved service request.",
          );
      });
    }
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
  if (order.kind === "service")
    await prisma.$transaction(async (tx) => {
      const matter = await requireMatter(actor, order.matterId, true, tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${order.id}`}))`;
      const current = await tx.paymentOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      if (
        matter.stage === "terminated" ||
        isPreClosingTermination(matter) ||
        current.status !== "creating"
      )
        throw new HttpError(
          409,
          "PAYMENT_CLOSED",
          "The transaction changed before checkout was issued.",
        );
      await tx.paymentOrder.update({
        where: { id: current.id },
        data: {
          details: {
            ...(current.details as Record<string, Prisma.InputJsonValue>),
            checkoutCreationStartedAt: new Date().toISOString(),
          },
        },
      });
    });
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
  if (order.kind === "service") {
    const blocked = await prisma.$transaction(async (tx) => {
      const matter = await requireMatter(actor, order.matterId, true, tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${order.id}`}))`;
      const current = await tx.paymentOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      if (current.stripeSessionId && current.stripeSessionId !== session.id)
        throw new HttpError(
          409,
          "CHECKOUT_CHANGED",
          "A different checkout was recorded while the provider responded.",
        );
      const terminated =
        matter.stage === "terminated" || isPreClosingTermination(matter);
      const protectedStatus = [
        "paid",
        "refunded",
        "partially_refunded",
        "disputed",
      ].includes(current.status);
      const changed =
        terminated ||
        ["cancelled", "void_pending", "requires_reconciliation"].includes(
          current.status,
        );
      await tx.paymentOrder.update({
        where: { id: current.id },
        data: {
          stripeSessionId: session.id,
          status: protectedStatus
            ? current.status
            : changed
              ? "void_pending"
              : "pending",
        },
      });
      if (terminated)
        await queueTerminatedServiceCheckouts(tx, actor, matter.id);
      return changed || protectedStatus;
    });
    if (blocked)
      throw new HttpError(
        409,
        "PAYMENT_CLOSED",
        "Checkout was withheld because the transaction changed. Ireland must review any settlement; unpaid checkout expiration is queued for confirmed pre-closing termination.",
      );
  } else {
    await prisma.paymentOrder.updateMany({
      where: { id: order.id, stripeSessionId: null },
      data: { stripeSessionId: session.id, status: "pending" },
    });
  }
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
      assertSavedPaymentEnvironment(
        order.details,
        event.livemode ? "live" : "test",
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
            paymentEnvironment: event.livemode ? "live" : "test",
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
          assertSavedPaymentEnvironment(
            current.details,
            event.livemode ? "live" : "test",
          );
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
              details: {
                ...details,
                refundedCents,
                paymentEnvironment: event.livemode ? "live" : "test",
                lastStripeEvent: event.id,
              },
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
