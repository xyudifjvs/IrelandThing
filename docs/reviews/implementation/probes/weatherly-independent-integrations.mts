import "./_review-safety.mjs";
import {
  checkoutRoot,
  checkerDatabaseUrl,
  apiBase,
  webBase,
} from "./_review-safety.mjs";
import { prisma } from "../../../../packages/db/src/index.ts";
import { processReview } from "../../../../packages/ai/src/service.ts";
import { applyStripeEvent } from "../../../../packages/billing/src/service.ts";
Object.assign(process.env, {
  OPENROUTER_API_KEY: "synthetic-not-a-key",
  OPENROUTER_MODEL: "synthetic/model",
  OPENROUTER_APPROVED_PROVIDERS: "synthetic/zdr",
  OPENROUTER_ZDR_APPROVED: "true",
  STRIPE_MODE: "test",
  OPENROUTER_ACCOUNT_PRIVACY_VERIFIED: "true",
});
const doc = await prisma.document.findFirstOrThrow({
  where: { matterId: "demo-oak", name: "review-contract.pdf" },
  include: { versions: { orderBy: { version: "desc" }, take: 1 } },
});
const version = doc.versions[0];
const matter = await prisma.matter.findUniqueOrThrow({
  where: { id: "demo-oak" },
});
const p = await prisma.aIProposal.create({
  data: {
    matterId: matter.id,
    kind: "contract",
    status: "queued",
    result: {},
    sourceRefs: [
      { documentId: doc.id, versionId: version.id, checksum: version.checksum },
    ],
    sourceRevision: matter.revision,
    requestedById: "owner-local",
  },
});
const original = globalThis.fetch;
globalThis.fetch = (async () =>
  Response.json({
    choices: [
      {
        message: {
          content: JSON.stringify({
            summary: "Synthetic evidence",
            deadlines: [
              {
                label: "Closing",
                date: "2026-11-25",
                sourceQuote: "Independent amended contract",
                page: 999,
                confidence: "high",
                uncertainty: "",
              },
            ],
            facts: [],
            warnings: [],
          }),
        },
      },
    ],
    model: "synthetic/model",
    provider: "synthetic/zdr",
  })) as any;
await processReview(p.id);
globalThis.fetch = original;
const saved = await prisma.aIProposal.findUniqueOrThrow({
  where: { id: p.id },
});
const result = saved.result as any;
console.log(
  JSON.stringify({
    check: "Cited page must match actual stored page",
    pass: result.deadlines.every((d: any) => d.page !== 999),
    storedPage: result.deadlines[0]?.page,
    actualPages: version.pages,
  }),
);
const stamp = Date.now().toString();
const order = await prisma.paymentOrder.create({
  data: {
    matterId: "demo-oak",
    createdById: "owner-local",
    idempotencyKey: "checker-refund-" + stamp,
    kind: "service",
    amountCents: 37500,
    currency: "USD",
    status: "paid",
    snapshot: { synthetic: true },
    stripePaymentIntentId: "pi_checker_" + stamp,
  },
});
function event(id: string, created: number, refunded: boolean, amount: number) {
  return {
    id,
    object: "event",
    livemode: false,
    created,
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_checker_" + stamp,
        object: "charge",
        payment_intent: order.stripePaymentIntentId,
        refunded,
        amount: 37500,
        amount_refunded: amount,
        currency: "usd",
      },
    },
  } as any;
}
await applyStripeEvent(event("evt_checker_full_" + stamp, 200, true, 37500));
await applyStripeEvent(
  event("evt_checker_old_partial_" + stamp, 100, false, 10000),
);
const after = await prisma.paymentOrder.findUniqueOrThrow({
  where: { id: order.id },
});
console.log(
  JSON.stringify({
    check: "Older partial refund cannot downgrade full refund",
    pass: after.status === "refunded",
    actualStatus: after.status,
  }),
);
await prisma.$disconnect();
