"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CreditCard, FolderHeart } from "lucide-react";
import { formatDate } from "@weatherly/ui";
import {
  useData,
  mutate,
  label,
} from "../../(workspace)/workspace/_components/data";
import s from "./account.module.css";

type Transaction = {
  id: string;
  title: string;
  propertyAddress: string;
  side: string;
  stage: string;
  packageCode: string;
  createdAt: string;
  updatedAt: string;
};
type Payment = {
  id: string;
  matterId: string;
  matterTitle: string;
  propertyAddress: string;
  kind: string;
  description: string;
  amountCents: number;
  currency: string;
  status: string;
  environment: "test" | "live" | "unknown";
  refundedCents: number | null;
  pendingRefundCents: number;
  createdAt: string;
  updatedAt: string;
  checkoutAvailable: boolean;
};
type Page<T, S> = {
  items: T[];
  nextCursor: string | null;
  total: number;
  summary: S;
};
type TransactionSummary = {
  total: number;
  stages: Record<string, number>;
};
type PaymentSummary = {
  total: number;
  statuses: Record<string, number>;
  currencies: {
    environment: string;
    currency: string;
    paidCents: number;
    pendingCents: number;
    refundedCents: number;
    pendingRefundCents: number;
    disputedCents: number;
    unknownRefundCount: number;
  }[];
};
type PaymentPage = Page<Payment, PaymentSummary> & {
  provider: { configured: boolean; environment: "test" | "live" | null };
};

const limit = 20;
const stages = [
  ["all", "All stages"],
  ["listing", "Listing"],
  ["under_contract", "Under contract"],
  ["closing", "Closing"],
  ["closed", "Closed"],
  ["terminated", "Terminated / cancelled"],
  ["archived", "Archived"],
];
const paymentStatuses = [
  ["all", "All statuses"],
  ["creating", "Preparing checkout"],
  ["pending", "Awaiting payment"],
  ["paid", "Paid"],
  ["failed", "Failed"],
  ["expired", "Expired"],
  ["refunded", "Refunded"],
  ["partially_refunded", "Partially refunded"],
  ["disputed", "Disputed"],
];

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(cents / 100);
}
function environmentLabel(environment: string) {
  return environment === "test"
    ? "Test mode"
    : environment === "live"
      ? "Live payments"
      : "Mode unverified";
}
function stageLabel(value: string) {
  return value === "terminated" ? "Terminated / cancelled" : label(value);
}
function paymentLabel(value: string) {
  return paymentStatuses.find(([key]) => key === value)?.[1] || label(value);
}
function badgeClass(value: string) {
  if (["paid", "closed"].includes(value)) return `${s.badge} ${s.positive}`;
  if (["failed", "disputed", "terminated"].includes(value))
    return `${s.badge} ${s.negative}`;
  return s.badge;
}
function pathWithQuery(
  endpoint: string,
  filters: Record<string, string>,
  cursor: string | null,
) {
  const params = new URLSearchParams({ ...filters, limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return `${endpoint}?${params}`;
}
function ErrorState({
  title,
  error,
  refresh,
  reset,
}: {
  title: string;
  error: string;
  refresh: () => Promise<void>;
  reset?: () => void;
}) {
  return (
    <div className={s.error} role="alert">
      <p>
        <strong>{title}</strong>
      </p>
      <p>{error}</p>
      <button className={s.secondary} onClick={() => void refresh()}>
        Try again
      </button>
      {reset && (
        <button className={s.secondary} onClick={reset}>
          Return to first page
        </button>
      )}
    </div>
  );
}
function Pagination({
  name,
  page,
  count,
  total,
  nextCursor,
  previous,
  next,
}: {
  name: string;
  page: number;
  count: number;
  total: number;
  nextCursor: string | null;
  previous: () => void;
  next: () => void;
}) {
  return (
    <nav className={s.pagination} aria-label={`${name} pagination`}>
      <span>
        {count
          ? `${page * limit + 1}–${page * limit + count} of ${total}`
          : `0 of ${total}`}{" "}
        · Page {page + 1}
      </span>
      <div className={s.actions}>
        <button
          className={s.secondary}
          disabled={page === 0}
          onClick={previous}
        >
          Previous
        </button>
        <button className={s.secondary} disabled={!nextCursor} onClick={next}>
          Next
        </button>
      </div>
    </nav>
  );
}

export function TransactionHistory({ coordinator }: { coordinator: boolean }) {
  const emptyFilters = { q: "", stage: "all", side: "all" };
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const q = useData<Page<Transaction, TransactionSummary>>(
    pathWithQuery(
      "/api/v1/billing/account/transactions",
      filters,
      cursors[cursors.length - 1],
    ),
  );
  const summary = q.data?.summary;
  const filtered = Boolean(
    filters.q || filters.stage !== "all" || filters.side !== "all",
  );
  function update(next: typeof filters) {
    setFilters(next);
    setCursors([null]);
  }
  function clear() {
    setSearch("");
    update(emptyFilters);
  }
  return (
    <section
      className={s.section}
      id="transactions"
      aria-labelledby="transactions-title"
    >
      <div className={s.sectionHeader}>
        <div>
          <h2 id="transactions-title">All transactions</h2>
          <p>
            Your full transaction history, including closed, terminated and
            archived files.
          </p>
        </div>
        <Link
          className={s.secondary}
          href={coordinator ? "/workspace/new" : "/portal/intake"}
        >
          New transaction <ArrowUpRight size={13} aria-hidden="true" />
        </Link>
      </div>
      <div className={s.body}>
        <div
          className={s.stats}
          aria-label="Complete transaction history counts"
        >
          {[
            ["All transactions", summary?.total],
            [
              "Active",
              summary
                ? (summary.stages.listing || 0) +
                  (summary.stages.under_contract || 0) +
                  (summary.stages.closing || 0)
                : undefined,
            ],
            ["Closed", summary?.stages.closed || (summary ? 0 : undefined)],
            [
              "Terminated / archived",
              summary
                ? (summary.stages.terminated || 0) +
                  (summary.stages.archived || 0)
                : undefined,
            ],
          ].map(([name, count]) => (
            <div className={s.stat} key={name}>
              <strong>{count ?? "—"}</strong>
              <span>{name}</span>
            </div>
          ))}
        </div>
        <form
          className={s.filters}
          onSubmit={(event) => {
            event.preventDefault();
            update({ ...filters, q: search.trim() });
          }}
          role="search"
          aria-label="Search transaction history"
        >
          <label className={s.field}>
            Search transactions
            <input
              className={s.input}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Property address or name"
            />
          </label>
          <label className={s.field}>
            Stage
            <select
              className={s.input}
              value={filters.stage}
              onChange={(event) =>
                update({ ...filters, stage: event.target.value })
              }
            >
              {stages.map(([value, text]) => (
                <option value={value} key={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            Transaction side
            <select
              className={s.input}
              value={filters.side}
              onChange={(event) =>
                update({ ...filters, side: event.target.value })
              }
            >
              <option value="all">All sides</option>
              <option value="buyer">Buyer</option>
              <option value="seller">Seller</option>
            </select>
          </label>
          <button className={s.button} type="submit">
            Search
          </button>
        </form>
        {q.loading ? (
          <p className={s.loading} role="status">
            Loading your transaction history…
          </p>
        ) : q.error ? (
          <ErrorState
            title="Transaction history could not be loaded."
            error={q.error}
            refresh={q.refresh}
            reset={cursors.length > 1 ? () => setCursors([null]) : undefined}
          />
        ) : (
          q.data && (
            <>
              <div className={s.resultLine} role="status">
                <span>
                  {q.data.total}{" "}
                  {q.data.total === 1 ? "transaction" : "transactions"}
                  {filtered
                    ? q.data.total === 1
                      ? " matches your filters"
                      : " match your filters"
                    : " in your history"}
                </span>
                {filtered && (
                  <button className={s.textButton} onClick={clear}>
                    Clear transaction filters
                  </button>
                )}
              </div>
              {q.data.items.length ? (
                <div className={s.tableWrap}>
                  <table className={s.table}>
                    <caption className={s.srOnly}>
                      Your authorized transaction history, newest first
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Transaction</th>
                        <th scope="col">Stage</th>
                        <th scope="col">Side / service</th>
                        <th scope="col">Added</th>
                        <th scope="col">
                          <span className={s.srOnly}>Open transaction</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.items.map((transaction) => {
                        const href = `${coordinator ? "/workspace" : "/portal"}/transactions/${encodeURIComponent(transaction.id)}`;
                        return (
                          <tr key={transaction.id}>
                            <td>
                              <Link className={s.transactionName} href={href}>
                                {transaction.title ||
                                  transaction.propertyAddress ||
                                  "Untitled transaction"}
                              </Link>
                              {transaction.propertyAddress &&
                                transaction.propertyAddress !==
                                  transaction.title && (
                                  <small>{transaction.propertyAddress}</small>
                                )}
                            </td>
                            <td data-label="Stage">
                              <span className={badgeClass(transaction.stage)}>
                                {stageLabel(transaction.stage)}
                              </span>
                            </td>
                            <td data-label="Side / service">
                              {label(transaction.side)}
                              <small>{label(transaction.packageCode)}</small>
                            </td>
                            <td data-label="Added">
                              {formatDate(transaction.createdAt)}
                            </td>
                            <td>
                              <Link
                                className={s.secondary}
                                href={href}
                                aria-label={`Open ${transaction.title || transaction.propertyAddress || "transaction"}`}
                              >
                                Open{" "}
                                <ArrowUpRight size={12} aria-hidden="true" />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={s.empty}>
                  <FolderHeart aria-hidden="true" />
                  <h3>
                    {filtered
                      ? "No matching transactions"
                      : "No transactions yet"}
                  </h3>
                  <p>
                    {filtered
                      ? "Try another property address, stage or transaction side."
                      : "Your transactions will appear here when Ireland adds a file or your intake is accepted."}
                  </p>
                  {filtered && (
                    <button className={s.secondary} onClick={clear}>
                      Clear filters
                    </button>
                  )}
                  {cursors.length > 1 && (
                    <button
                      className={s.secondary}
                      onClick={() => setCursors([null])}
                    >
                      Return to first page
                    </button>
                  )}
                </div>
              )}
              {(q.data.items.length > 0 || cursors.length > 1) && (
                <Pagination
                  name="Transaction history"
                  page={cursors.length - 1}
                  count={q.data.items.length}
                  total={q.data.total}
                  nextCursor={q.data.nextCursor}
                  previous={() => setCursors((current) => current.slice(0, -1))}
                  next={() =>
                    q.data?.nextCursor &&
                    setCursors((current) => [...current, q.data!.nextCursor])
                  }
                />
              )}
              <p className={s.hint}>
                Summary counts cover your complete retained history. Search and
                filters change the list below them.
              </p>
            </>
          )
        )}
      </div>
    </section>
  );
}

function PaymentAction({ payment }: { payment: Payment }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        className={s.secondary}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await mutate<{ url: string }>(
              `/api/v1/billing/account/payments/${encodeURIComponent(payment.id)}/checkout`,
              {},
            );
            const url = new URL(result.url);
            if (
              url.protocol !== "https:" ||
              url.hostname !== "checkout.stripe.com"
            )
              throw new Error(
                "A valid payment link is not available. Contact Ireland for help.",
              );
            window.location.assign(url.href);
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "The payment link could not be opened.",
            );
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Opening…"
          : payment.environment === "test"
            ? "Open test checkout"
            : "Continue payment"}
        <ArrowUpRight size={12} aria-hidden="true" />
      </button>
      {error && (
        <span className={s.detail} role="alert">
          {error}
        </span>
      )}
    </>
  );
}

export function PaymentHistory({ coordinator }: { coordinator: boolean }) {
  const emptyFilters = { q: "", status: "all", environment: "all" };
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const q = useData<PaymentPage>(
    pathWithQuery(
      "/api/v1/billing/account/payments",
      filters,
      cursors[cursors.length - 1],
    ),
  );
  const filtered = Boolean(
    filters.q || filters.status !== "all" || filters.environment !== "all",
  );
  function update(next: typeof filters) {
    setFilters(next);
    setCursors([null]);
  }
  function clear() {
    setSearch("");
    update(emptyFilters);
  }
  return (
    <section
      className={s.section}
      id="payments"
      aria-labelledby="payments-title"
    >
      <div className={s.sectionHeader}>
        <div>
          <h2 id="payments-title">Payments</h2>
          <p>
            Review payment requests, recorded payments and refunds for your
            transactions.
          </p>
        </div>
        <button
          className={s.secondary}
          disabled={q.loading}
          onClick={() => void q.refresh()}
        >
          Refresh payments
        </button>
      </div>
      <div className={s.body}>
        {q.data && !q.data.provider.configured && (
          <div className={s.notice} role="status">
            <p>
              <strong>Online payments are not available yet.</strong>
            </p>
            <p>
              Ireland’s Stripe account has not been connected. Any existing
              payment records remain listed here. Contact Ireland if you need
              payment instructions.
            </p>
          </div>
        )}
        {q.data?.provider.environment === "test" && (
          <div className={s.notice} role="status">
            Stripe is in test mode. Test checkouts do not move real money.
          </div>
        )}
        {q.data?.summary.currencies.length ? (
          <>
            <div className={s.resultLine}>
              <span>
                Complete payment history · {q.data.summary.total}{" "}
                {q.data.summary.total === 1 ? "record" : "records"}
              </span>
            </div>
            <div
              className={s.totals}
              aria-label="Complete payment totals by currency and environment"
            >
              {q.data.summary.currencies.map((total) => (
                <div
                  className={s.totalGroup}
                  key={`${total.environment}:${total.currency}`}
                >
                  <h3>
                    {environmentLabel(total.environment)} ·{" "}
                    {total.currency.toUpperCase()}
                  </h3>
                  <dl>
                    <dt>Paid after recorded refunds</dt>
                    <dd>{money(total.paidCents, total.currency)}</dd>
                    <dt>Awaiting payment</dt>
                    <dd>{money(total.pendingCents, total.currency)}</dd>
                    <dt>Refunds recorded</dt>
                    <dd>{money(total.refundedCents, total.currency)}</dd>
                    <dt>Refunds awaiting confirmation</dt>
                    <dd>{money(total.pendingRefundCents, total.currency)}</dd>
                    <dt>Disputed</dt>
                    <dd>{money(total.disputedCents, total.currency)}</dd>
                  </dl>
                  {total.unknownRefundCount > 0 && (
                    <p className={s.hint}>
                      {total.unknownRefundCount}{" "}
                      {total.unknownRefundCount === 1
                        ? "refund has"
                        : "refunds have"}{" "}
                      an unverified amount. The related paid balances and
                      unverified refund amounts are excluded from totals.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : null}
        <form
          className={s.filters}
          role="search"
          aria-label="Search payment history"
          onSubmit={(event) => {
            event.preventDefault();
            update({ ...filters, q: search.trim() });
          }}
        >
          <label className={s.field}>
            Search payments
            <input
              className={s.input}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Property, description or payment ID"
            />
          </label>
          <label className={s.field}>
            Payment status
            <select
              className={s.input}
              value={filters.status}
              onChange={(event) =>
                update({ ...filters, status: event.target.value })
              }
            >
              {paymentStatuses.map(([value, text]) => (
                <option value={value} key={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            Payment mode
            <select
              className={s.input}
              value={filters.environment}
              onChange={(event) =>
                update({ ...filters, environment: event.target.value })
              }
            >
              <option value="all">All modes</option>
              <option value="live">Live payments</option>
              <option value="test">Test mode</option>
              <option value="unknown">Mode unverified</option>
            </select>
          </label>
          <button className={s.button} type="submit">
            Search
          </button>
        </form>
        {q.loading ? (
          <p className={s.loading} role="status">
            Loading your payment history…
          </p>
        ) : q.error ? (
          <ErrorState
            title="Payment history could not be loaded."
            error={q.error}
            refresh={q.refresh}
            reset={cursors.length > 1 ? () => setCursors([null]) : undefined}
          />
        ) : (
          q.data && (
            <>
              <div className={s.resultLine} role="status">
                <span>
                  {q.data.total}{" "}
                  {q.data.total === 1 ? "payment record" : "payment records"}
                  {filtered
                    ? q.data.total === 1
                      ? " matches your filters"
                      : " match your filters"
                    : " in your history"}
                </span>
                {filtered && (
                  <button className={s.textButton} onClick={clear}>
                    Clear payment filters
                  </button>
                )}
              </div>
              {q.data.items.length ? (
                <div className={s.tableWrap}>
                  <table className={s.table}>
                    <caption className={s.srOnly}>
                      Your authorized payment history, newest first
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Payment / transaction</th>
                        <th scope="col">Amount</th>
                        <th scope="col">Status</th>
                        <th scope="col">Date</th>
                        <th scope="col">
                          <span className={s.srOnly}>Payment action</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.items.map((payment) => (
                        <tr key={payment.id}>
                          <td>
                            <span className={s.transactionName}>
                              {payment.description || label(payment.kind)}
                            </span>
                            <small>
                              <Link
                                href={`${coordinator ? "/workspace" : "/portal"}/transactions/${encodeURIComponent(payment.matterId)}`}
                              >
                                {payment.propertyAddress ||
                                  payment.matterTitle ||
                                  "Open transaction"}
                              </Link>
                            </small>
                            <small>Payment {payment.id}</small>
                          </td>
                          <td data-label="Amount">
                            <span className={s.money}>
                              {money(payment.amountCents, payment.currency)}
                            </span>
                            <small>
                              {environmentLabel(payment.environment)}
                            </small>
                          </td>
                          <td data-label="Status">
                            <span className={badgeClass(payment.status)}>
                              {paymentLabel(payment.status)}
                            </span>
                            {payment.refundedCents !== null &&
                              payment.refundedCents > 0 && (
                                <small>
                                  Refunded:{" "}
                                  {money(
                                    payment.refundedCents,
                                    payment.currency,
                                  )}
                                </small>
                              )}
                            {payment.pendingRefundCents > 0 && (
                              <small>
                                Refund awaiting confirmation:{" "}
                                {money(
                                  payment.pendingRefundCents,
                                  payment.currency,
                                )}
                              </small>
                            )}
                            {["refunded", "partially_refunded"].includes(
                              payment.status,
                            ) &&
                              payment.refundedCents === null && (
                                <small>Refund amount unverified</small>
                              )}
                          </td>
                          <td data-label="Date">
                            {formatDate(payment.createdAt)}
                            <small>
                              Updated {formatDate(payment.updatedAt)}
                            </small>
                          </td>
                          <td>
                            {payment.checkoutAvailable &&
                            q.data!.provider.configured ? (
                              <PaymentAction payment={payment} />
                            ) : (
                              <span className={s.detail}>
                                {payment.status === "paid"
                                  ? "Payment recorded"
                                  : payment.status === "pending" &&
                                      !q.data!.provider.configured
                                    ? "Online payment unavailable"
                                    : "No payment action"}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={s.empty}>
                  <CreditCard aria-hidden="true" />
                  <h3>
                    {filtered
                      ? "No matching payments"
                      : "No payment records yet"}
                  </h3>
                  <p>
                    {filtered
                      ? "Try another description, payment status or mode."
                      : "Payment requests and recorded payments will appear here when Ireland prepares them for your transactions."}
                  </p>
                  {filtered && (
                    <button className={s.secondary} onClick={clear}>
                      Clear filters
                    </button>
                  )}
                  {cursors.length > 1 && (
                    <button
                      className={s.secondary}
                      onClick={() => setCursors([null])}
                    >
                      Return to first page
                    </button>
                  )}
                </div>
              )}
              {(q.data.items.length > 0 || cursors.length > 1) && (
                <Pagination
                  name="Payment history"
                  page={cursors.length - 1}
                  count={q.data.items.length}
                  total={q.data.total}
                  nextCursor={q.data.nextCursor}
                  previous={() => setCursors((current) => current.slice(0, -1))}
                  next={() =>
                    q.data?.nextCursor &&
                    setCursors((current) => [...current, q.data!.nextCursor])
                  }
                />
              )}
              <p className={s.hint}>
                Totals cover your complete payment history and stay separate by
                currency and payment mode. Payment status changes only when
                verified records are updated.
              </p>
            </>
          )
        )}
      </div>
    </section>
  );
}
