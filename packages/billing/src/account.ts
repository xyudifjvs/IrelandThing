import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import { HttpError, type Principal } from "@weatherly/platform";
import { matterScope, requireMatter } from "@weatherly/matters";
import { billingConfigured, verifiedStripe } from "./service";
import { paymentMode, savedPaymentEnvironment } from "./mode";

const pagination = {
  cursor: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).default(""),
};
export const accountTransactionQuery = z
  .object({
    ...pagination,
    stage: z
      .enum([
        "all",
        "listing",
        "under_contract",
        "closing",
        "closed",
        "terminated",
        "archived",
      ])
      .default("all"),
    side: z.enum(["all", "buyer", "seller"]).default("all"),
  })
  .strict();
export const accountPaymentQuery = z
  .object({
    ...pagination,
    status: z
      .enum([
        "all",
        "creating",
        "pending",
        "paid",
        "failed",
        "expired",
        "refunded",
        "partially_refunded",
        "disputed",
      ])
      .default("all"),
    environment: z.enum(["all", "test", "live", "unknown"]).default("all"),
  })
  .strict();
export type AccountTransactionQuery = z.input<typeof accountTransactionQuery>;
export type AccountPaymentQuery = z.input<typeof accountPaymentQuery>;

function assertAccountReader(actor: Principal) {
  if (actor.role !== "agent" && actor.role !== "coordinator")
    throw new HttpError(
      403,
      "ACCOUNT_HISTORY_FORBIDDEN",
      "Transaction and payment history is available to agents and Ireland.",
    );
}
const transactionSelect = {
  id: true,
  title: true,
  propertyAddress: true,
  side: true,
  stage: true,
  packageCode: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MatterSelect;
function beforeCursor(anchor: { createdAt: Date; id: string }) {
  return {
    OR: [
      { createdAt: { lt: anchor.createdAt } },
      { createdAt: anchor.createdAt, id: { lt: anchor.id } },
    ],
  };
}

/** No stage is excluded by default: archived/terminated records remain in retained history. */
export async function listAccountTransactions(
  actor: Principal,
  raw: AccountTransactionQuery = {},
) {
  assertAccountReader(actor);
  const query = accountTransactionQuery.parse(raw);
  return prisma.$transaction(
    async (tx) => {
      const scope = matterScope(actor);
      const where: Prisma.MatterWhereInput = {
        AND: [
          scope,
          query.stage === "all" ? {} : { stage: query.stage },
          query.side === "all" ? {} : { side: query.side },
          query.q
            ? {
                OR: [
                  { title: { contains: query.q, mode: "insensitive" } },
                  {
                    propertyAddress: { contains: query.q, mode: "insensitive" },
                  },
                ],
              }
            : {},
        ],
      };
      const anchor = query.cursor
        ? await tx.matter.findFirst({
            where: { AND: [scope, { id: query.cursor }] },
            select: { id: true, createdAt: true },
          })
        : null;
      if (query.cursor && !anchor)
        throw new HttpError(
          404,
          "ACCOUNT_CURSOR_NOT_FOUND",
          "This history page is no longer available. Start again from the first page.",
        );
      const [rows, total, counts] = await Promise.all([
        tx.matter.findMany({
          where: { AND: [where, anchor ? beforeCursor(anchor) : {}] },
          select: transactionSelect,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: query.limit + 1,
        }),
        tx.matter.count({ where }),
        tx.matter.groupBy({
          by: ["stage"],
          where: scope,
          _count: { _all: true },
        }),
      ]);
      const items = rows.slice(0, query.limit);
      return {
        items,
        nextCursor: rows.length > query.limit ? items.at(-1)!.id : null,
        total,
        summary: {
          total: counts.reduce((sum, row) => sum + row._count._all, 0),
          stages: Object.fromEntries(
            counts.map((row) => [row.stage, row._count._all]),
          ),
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

function object(value: Prisma.JsonValue): Prisma.JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
function refundAmount(
  status: string,
  amountCents: number,
  details: Prisma.JsonValue,
): number | null {
  const saved = object(details).refundedCents;
  if (status === "refunded") return amountCents;
  if (
    typeof saved === "number" &&
    Number.isSafeInteger(saved) &&
    saved >= 0 &&
    saved <= amountCents &&
    !(status === "partially_refunded" && saved === 0)
  )
    return saved;
  // A legacy partial refund without a trustworthy amount cannot establish a net balance.
  if (status === "partially_refunded" || (saved !== undefined && saved !== 0))
    return null;
  return 0;
}
function pendingRefundAmount(details: Prisma.JsonValue, amountCents: number) {
  const requests = object(details).refundRequests;
  if (!Array.isArray(requests)) return 0;
  return Math.min(
    amountCents,
    requests.reduce<number>((sum, raw) => {
      const request = object(raw);
      return !["failed", "canceled"].includes(String(request.status)) &&
        request.accounted !== true &&
        typeof request.amountCents === "number" &&
        Number.isSafeInteger(request.amountCents) &&
        request.amountCents > 0
        ? sum + request.amountCents
        : sum;
    }, 0),
  );
}
function providerState() {
  let environment: "test" | "live" | null = null;
  try {
    environment = paymentMode();
  } catch {
    /* Invalid configuration must disable checkout without hiding saved history. */
  }
  return { configured: billingConfigured(), environment };
}
type CurrencySummary = {
  environment: "test" | "live" | "unknown";
  currency: string;
  paidCents: number;
  pendingCents: number;
  refundedCents: number;
  disputedCents: number;
  pendingRefundCents: number;
  unknownRefundCount: number;
};

export async function listAccountPayments(
  actor: Principal,
  raw: AccountPaymentQuery = {},
) {
  assertAccountReader(actor);
  const query = accountPaymentQuery.parse(raw);
  const provider = providerState();
  return prisma.$transaction(
    async (tx) => {
      const matters = await tx.matter.findMany({
        where: matterScope(actor),
        select: { id: true, title: true, propertyAddress: true },
      });
      const byMatter = new Map(matters.map((matter) => [matter.id, matter]));
      // PaymentOrder predates the Matter relation. Read only scoped IDs and a narrow
      // financial projection; full retained rows are needed for correct JSON refund/mode summaries.
      const orders = await tx.paymentOrder.findMany({
        where: { matterId: { in: matters.map((matter) => matter.id) } },
        select: {
          id: true,
          matterId: true,
          kind: true,
          amountCents: true,
          currency: true,
          status: true,
          snapshot: true,
          details: true,
          stripeSessionId: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      const rows = orders.map((order) => {
        const matter = byMatter.get(order.matterId)!;
        const name = object(order.snapshot).name;
        const environment = savedPaymentEnvironment(order.details);
        return {
          id: order.id,
          matterId: matter.id,
          matterTitle: matter.title,
          propertyAddress: matter.propertyAddress,
          kind: order.kind,
          description:
            typeof name === "string" && name.trim()
              ? name
              : order.kind === "gift"
                ? "Closing gift"
                : "Transaction coordination",
          amountCents: order.amountCents,
          currency: order.currency,
          status: order.status,
          environment,
          refundedCents: refundAmount(
            order.status,
            order.amountCents,
            order.details,
          ),
          pendingRefundCents: pendingRefundAmount(
            order.details,
            order.amountCents,
          ),
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
          checkoutAvailable:
            provider.configured &&
            environment === provider.environment &&
            order.status === "pending" &&
            Boolean(order.stripeSessionId),
        };
      });
      if (query.cursor && !rows.some((row) => row.id === query.cursor))
        throw new HttpError(
          404,
          "ACCOUNT_CURSOR_NOT_FOUND",
          "This history page is no longer available. Start again from the first page.",
        );
      const currencies = new Map<string, CurrencySummary>();
      const statuses: Record<string, number> = {};
      for (const row of rows) {
        statuses[row.status] = (statuses[row.status] || 0) + 1;
        const key = `${row.environment}:${row.currency}`;
        const sums = currencies.get(key) || {
          environment: row.environment,
          currency: row.currency,
          paidCents: 0,
          pendingCents: 0,
          refundedCents: 0,
          disputedCents: 0,
          pendingRefundCents: 0,
          unknownRefundCount: 0,
        };
        if (
          ["paid", "partially_refunded"].includes(row.status) &&
          row.refundedCents !== null
        )
          sums.paidCents += row.amountCents - row.refundedCents;
        if (["creating", "pending"].includes(row.status))
          sums.pendingCents += row.amountCents;
        sums.refundedCents += row.refundedCents ?? 0;
        if (row.status === "disputed") sums.disputedCents += row.amountCents;
        sums.pendingRefundCents += row.pendingRefundCents;
        if (row.refundedCents === null) sums.unknownRefundCount++;
        currencies.set(key, sums);
      }
      const needle = query.q.toLocaleLowerCase();
      const filtered = rows.filter(
        (row) =>
          (query.status === "all" || row.status === query.status) &&
          (query.environment === "all" ||
            row.environment === query.environment) &&
          (!needle ||
            [
              row.id,
              row.matterTitle,
              row.propertyAddress,
              row.description,
            ].some((text) => text.toLocaleLowerCase().includes(needle))),
      );
      const anchor = query.cursor
        ? rows.find((row) => row.id === query.cursor)!
        : null;
      const after = anchor
        ? filtered.filter(
            (row) =>
              row.createdAt < anchor.createdAt ||
              (row.createdAt.getTime() === anchor.createdAt.getTime() &&
                row.id < anchor.id),
          )
        : filtered;
      const items = after.slice(0, query.limit);
      return {
        items,
        nextCursor: after.length > query.limit ? items.at(-1)!.id : null,
        total: filtered.length,
        summary: {
          total: rows.length,
          statuses,
          currencies: [...currencies.values()].sort((a, b) =>
            `${a.environment}:${a.currency}`.localeCompare(
              `${b.environment}:${b.currency}`,
            ),
          ),
        },
        provider,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

/** Resume an issued request only. Agent checkout cannot create orders or choose amounts. */
export async function resumeAccountPayment(
  actor: Principal,
  id: string,
  provider = verifiedStripe,
) {
  assertAccountReader(actor);
  const order = await prisma.paymentOrder.findUnique({ where: { id } });
  if (!order)
    throw new HttpError(404, "PAYMENT_NOT_FOUND", "Payment request not found.");
  await requireMatter(actor, order.matterId);
  if (order.status !== "pending" || !order.stripeSessionId)
    throw new HttpError(
      409,
      "PAYMENT_NOT_PAYABLE",
      "This payment request has no open checkout.",
    );
  if (savedPaymentEnvironment(order.details) !== paymentMode())
    throw new HttpError(
      409,
      "PAYMENT_ENVIRONMENT_UNKNOWN",
      "Ireland must reconcile this request in its original payment environment.",
    );
  const stripe = await provider();
  const session = await stripe.checkout.sessions.retrieve(
    order.stripeSessionId,
  );
  if (
    session.id !== order.stripeSessionId ||
    session.metadata?.paymentOrderId !== order.id ||
    session.livemode !== (paymentMode() === "live") ||
    session.amount_total !== order.amountCents ||
    session.currency?.toUpperCase() !== order.currency
  )
    throw new HttpError(
      409,
      "PAYMENT_MISMATCH",
      "The checkout does not match this saved payment request.",
    );
  // Re-check visibility after the provider round trip; revoked participants lose access immediately.
  await requireMatter(actor, order.matterId);
  const current = await prisma.paymentOrder.findUniqueOrThrow({
    where: { id },
  });
  if (current.status !== "pending" || session.status !== "open" || !session.url)
    throw new HttpError(
      409,
      "PAYMENT_NOT_PAYABLE",
      "This checkout has closed. Ireland must reconcile the saved payment status.",
    );
  const url = new URL(session.url);
  if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com")
    throw new HttpError(
      409,
      "PAYMENT_URL_INVALID",
      "The provider returned an invalid checkout address.",
    );
  return { id: order.id, status: current.status, url: session.url };
}
