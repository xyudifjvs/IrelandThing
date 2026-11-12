import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import { HttpError, type Principal } from "@weatherly/platform";
import {
  fileReviewPending,
  matterScope,
  requireMatter,
} from "@weatherly/matters";
import {
  paymentDetails,
  savedPaidAt,
  serviceCheckoutCancellation,
  settledStatuses,
} from "./checkout-policy";
import { savedPaymentEnvironment } from "./mode";

export type FeeSummary = {
  name: string;
  amountCents: number | null;
  currency: string | null;
  status: string;
  paidAt: string | null;
};

const options = z
  .object({
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
const serviceSnapshot = z.object({
  code: z.enum(["essentials", "complete"]),
  name: z.string().trim().min(1).max(200),
  priceCents: z.number().int().positive(),
  currency: z.literal("USD"),
});
const giftQuote = z.object({
  description: z.string().trim().min(1).max(500),
  amountCents: z.number().int().positive(),
  currency: z.literal("USD"),
});
const inProgress = new Set([
  "creating",
  "pending",
  "void_pending",
  "requires_reconciliation",
]);
type File = Pick<
  Prisma.MatterGetPayload<object>,
  "id" | "propertyAddress" | "business" | "stage" | "details" | "packageCode"
>;

function assertAccountAccess(actor: Principal) {
  if (actor.role !== "agent" && actor.role !== "coordinator")
    throw new HttpError(
      403,
      "ACCOUNT_HISTORY_FORBIDDEN",
      "Payment summaries are available to agents and Ireland.",
    );
}

type Payment = {
  kind: string;
  status: string;
  snapshot: unknown;
  details: unknown;
  amountCents: number;
  currency: string;
};

function fromOrder(order: Payment, name: string): FeeSummary {
  const savedName = paymentDetails(order.snapshot).name;
  const known = savedPaymentEnvironment(order.details) !== "unknown";
  return {
    name: typeof savedName === "string" && savedName.trim() ? savedName : name,
    amountCents: order.amountCents,
    currency: order.currency,
    status: known ? order.status : "requires_reconciliation",
    paidAt: known ? savedPaidAt(order.details) : null,
  };
}

async function summarize(
  tx: Prisma.TransactionClient,
  files: readonly File[],
  obligationsOnly: boolean,
) {
  const scope = files.map(({ id }) => id);
  const [orders, gifts] = await Promise.all([
    tx.paymentOrder.findMany({
      where: { matterId: { in: scope }, kind: { in: ["service", "gift"] } },
      select: {
        id: true,
        matterId: true,
        kind: true,
        status: true,
        snapshot: true,
        details: true,
        amountCents: true,
        currency: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    tx.giftOrder.findMany({
      where: { matterId: { in: scope }, status: { not: "cancelled" } },
      select: { matterId: true, paymentOrderId: true, selection: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      distinct: ["matterId"],
    }),
  ]);
  const environment = process.env.STRIPE_MODE === "live" ? "live" : "test";
  const byMatter = new Map<string, typeof orders>();
  for (const order of orders) {
    const saved = savedPaymentEnvironment(order.details);
    if (saved !== environment && saved !== "unknown") continue;
    const group = byMatter.get(order.matterId) ?? [];
    group.push(order);
    byMatter.set(order.matterId, group);
  }
  const giftByMatter = new Map(gifts.map((gift) => [gift.matterId, gift]));
  return files.map((file) => {
    const current = byMatter.get(file.id) ?? [];
    const serviceOrders = current.filter((order) => order.kind === "service");
    const serviceOrder =
      serviceOrders.find((order) => settledStatuses.includes(order.status)) ??
      serviceOrders.find((order) => inProgress.has(order.status));
    const terms = serviceSnapshot.safeParse(
      paymentDetails(file.details).serviceSnapshot,
    );
    const eligibleService =
      !fileReviewPending(file) &&
      !serviceCheckoutCancellation(file) &&
      ["essentials", "complete"].includes(file.packageCode);
    let service: FeeSummary | null = null;
    if (eligibleService && (!obligationsOnly || !serviceOrder)) {
      if (serviceOrder)
        service = fromOrder(serviceOrder, "Transaction coordination");
      else if (terms.success && terms.data.code === file.packageCode)
        service = {
          name: terms.data.name,
          amountCents: terms.data.priceCents,
          currency: terms.data.currency,
          status: "due_at_closing",
          paidAt: null,
        };
    }
    const giftRequest = giftByMatter.get(file.id);
    const giftOrder = current.find(
      (order) =>
        order.kind === "gift" && order.id === giftRequest?.paymentOrderId,
    );
    let gift: FeeSummary | null = null;
    if (giftRequest && (!obligationsOnly || !giftOrder)) {
      const quote = giftQuote.safeParse(
        paymentDetails(giftRequest.selection).approvedQuote,
      );
      gift = giftOrder
        ? fromOrder(giftOrder, "Closing gift")
        : {
            name: quote.success ? quote.data.description : "Closing gift",
            amountCents: quote.success ? quote.data.amountCents : null,
            currency: quote.success ? quote.data.currency : null,
            status: quote.success ? "quoted" : "awaiting_quote",
            paidAt: null,
          };
    }
    return {
      matterId: file.id,
      propertyAddress: file.propertyAddress,
      service,
      gift,
    };
  });
}

export async function accountFileSummary(actor: Principal, raw: unknown) {
  assertAccountAccess(actor);
  const { matterId } = z
    .object({ matterId: z.string().min(1).max(200) })
    .strict()
    .parse(raw);
  return prisma.$transaction(
    async (tx) => {
      const file = await requireMatter(actor, matterId, false, tx);
      const [summary] = await summarize(tx, [file], false);
      return summary;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function listAccountObligations(actor: Principal, raw: unknown) {
  assertAccountAccess(actor);
  const page = options.parse(raw);
  return prisma.$transaction(
    async (tx) => {
      const scope = matterScope(actor);
      const anchor = page.cursor
        ? await requireMatter(actor, page.cursor, false, tx)
        : null;
      const rows = await tx.matter.findMany({
        where: {
          AND: [
            scope,
            anchor
              ? {
                  OR: [
                    { createdAt: { lt: anchor.createdAt } },
                    { createdAt: anchor.createdAt, id: { lt: anchor.id } },
                  ],
                }
              : {},
          ],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: page.limit + 1,
      });
      const items = await summarize(tx, rows.slice(0, page.limit), true);
      return {
        items: items.filter((row) => row.service || row.gift),
        nextCursor: rows.length > page.limit ? rows[page.limit - 1].id : null,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
