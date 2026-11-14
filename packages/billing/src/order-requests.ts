import { z } from "zod";
import { prisma, type Prisma } from "@weatherly/db";
import { HttpError, type Principal } from "@weatherly/platform";
import { audit, requireMatter, fileReviewPending } from "@weatherly/matters";
import { checkoutInput } from "./contracts";
import {
  assertServiceCheckoutAllowed,
  replaceableServiceOrderStatuses,
} from "./checkout-policy";
import { paymentMode } from "./mode";

const serviceTerms = z.object({
  code: z.enum(["essentials", "complete"]),
  name: z.string().trim().min(1).max(200),
  revision: z.number().int().positive(),
  priceCents: z.number().int().positive(),
  currency: z.literal("USD"),
});

export async function findOrCreatePaymentOrder(
  actor: Principal,
  input: z.output<typeof checkoutInput>,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.kind}-payment:${input.matterId}`}))`;
    const matter = await requireMatter(actor, input.matterId, true, tx);
    if (input.kind === "service") assertServiceCheckoutAllowed(matter);
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
    // Earlier releases could store a dispatched but unverified creation as
    // cancelled. It still blocks a replacement until Stripe evidence resolves it.
    const unresolved = await tx.paymentOrder.findFirst({
      where: {
        matterId: matter.id,
        kind: "service",
        stripeSessionId: null,
        details: {
          path: ["terminationVoid", "creationOutcomeUncertain"],
          equals: true,
        },
      },
    });
    if (unresolved) return unresolved;
    const existing = await tx.paymentOrder.findFirst({
      where: {
        matterId: matter.id,
        kind: "service",
        status: { notIn: replaceableServiceOrderStatuses },
      },
      orderBy: { createdAt: "desc" },
    });
    const key = `service:${matter.id}:${input.idempotencyKey}`;
    const previous = await tx.paymentOrder.findUnique({
      where: { idempotencyKey: key },
    });
    const retained = previous || existing;
    if (retained) return retained;
    if (matter.packageCode === "full_listing")
      throw new HttpError(
        409,
        "SERVICE_COMING_SOON",
        "Full Listing is coming soon and cannot receive a new payment request.",
      );
    const explicit = input.closingPaymentConfirmed === true;
    const eligibleStage = explicit
      ? ["under_contract", "closing", "closed"].includes(matter.stage)
      : matter.checklistVersion === null &&
        ["closing", "closed"].includes(matter.stage);
    if (fileReviewPending(matter) || !eligibleStage)
      throw new HttpError(
        409,
        "SERVICE_NOT_DUE",
        "Confirm that the service fee is due at closing before requesting payment.",
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
          closingPaymentConfirmed: explicit,
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
}
