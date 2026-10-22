import { Router } from "express";
import { asyncHandler, principal, HttpError } from "@weatherly/platform";
import {
  createCheckout,
  listCatalog,
  listGifts,
  listPayments,
  verifyStripeWebhook,
  applyStripeEvent,
} from "./service";
import {
  quoteGift,
  fulfillGift,
  refundPayment,
  reconcilePayment,
} from "./operations";
import {
  listAccountTransactions,
  listAccountPayments,
  resumeAccountPayment,
} from "./account";
export function createBillingRouter() {
  const router = Router();
  const historyQuery = (query: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(query).map(([key, value]) => [
        key,
        key === "limit" && typeof value === "string" ? Number(value) : value,
      ]),
    );
  router.get(
    "/account/transactions",
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "private, no-store");
      res.json(
        await listAccountTransactions(principal(req), historyQuery(req.query)),
      );
    }),
  );
  router.get(
    "/account/payments",
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "private, no-store");
      res.json(
        await listAccountPayments(principal(req), historyQuery(req.query)),
      );
    }),
  );
  router.post(
    "/account/payments/:id/checkout",
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "private, no-store");
      res.json(
        await resumeAccountPayment(principal(req), String(req.params.id)),
      );
    }),
  );
  router.post(
    "/gifts/:id/quote",
    asyncHandler(async (req, res) =>
      res.json(
        await quoteGift(principal(req), String(req.params.id), req.body),
      ),
    ),
  );
  router.post(
    "/gifts/:id/fulfill",
    asyncHandler(async (req, res) =>
      res.json(
        await fulfillGift(principal(req), String(req.params.id), req.body),
      ),
    ),
  );
  router.post(
    "/payments/:id/refund",
    asyncHandler(async (req, res) =>
      res.json(
        await refundPayment(principal(req), String(req.params.id), req.body),
      ),
    ),
  );
  router.post(
    "/payments/:id/reconcile",
    asyncHandler(async (req, res) =>
      res.json(await reconcilePayment(principal(req), String(req.params.id))),
    ),
  );
  router.get(
    "/catalog",
    asyncHandler(async (req, res) => {
      principal(req);
      res.json(await listCatalog());
    }),
  );
  router.get(
    "/payments",
    asyncHandler(async (req, res) =>
      res.json(
        await listPayments(
          principal(req),
          typeof req.query.matterId === "string"
            ? req.query.matterId
            : undefined,
          {
            cursor:
              typeof req.query.cursor === "string"
                ? req.query.cursor
                : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
          },
        ),
      ),
    ),
  );
  router.get(
    "/gifts",
    asyncHandler(async (req, res) =>
      res.json(
        await listGifts(
          principal(req),
          typeof req.query.matterId === "string"
            ? req.query.matterId
            : undefined,
          {
            cursor:
              typeof req.query.cursor === "string"
                ? req.query.cursor
                : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
          },
        ),
      ),
    ),
  );
  router.post(
    "/checkout",
    asyncHandler(async (req, res) =>
      res.status(201).json(await createCheckout(principal(req), req.body)),
    ),
  );
  return router;
}
export const stripeWebhook = asyncHandler(async (req, res) => {
  const signature = req.get("stripe-signature");
  if (!signature || !Buffer.isBuffer(req.body))
    throw new HttpError(
      400,
      "INVALID_SIGNATURE",
      "A signed Stripe event is required.",
    );
  let event;
  try {
    event = verifyStripeWebhook(req.body, signature);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      400,
      "INVALID_SIGNATURE",
      "The Stripe signature is invalid.",
    );
  }
  await applyStripeEvent(event);
  res.json({ received: true });
});
