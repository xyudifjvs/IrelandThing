"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CreditCard } from "lucide-react";
import { formatDate } from "@weatherly/ui";
import {
  useData,
  label,
  mutate,
} from "../../(workspace)/workspace/_components/data";
import {
  type Page,
  badgeClass,
  pathWithQuery,
  ErrorState,
  Pagination,
} from "./history-shared";
import s from "./account.module.css";

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
  dueAtClosing?: boolean;
  paidAt?: string | null;
  environment: "test" | "live" | "unknown";
  refundedCents: number | null;
  pendingRefundCents: number;
  createdAt: string;
  updatedAt: string;
  checkoutAvailable: boolean;
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
function paymentLabel(value: string) {
  return paymentStatuses.find(([key]) => key === value)?.[1] || label(value);
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

export function PaymentHistory({
  coordinator,
  obligationsHistoryKey,
}: {
  coordinator: boolean;
  obligationsHistoryKey?: string;
}) {
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
  const lastObligations = useRef(obligationsHistoryKey);
  const refresh = q.refresh;
  useEffect(() => {
    if (lastObligations.current === obligationsHistoryKey) return;
    lastObligations.current = obligationsHistoryKey;
    if (obligationsHistoryKey !== undefined) void refresh();
  }, [obligationsHistoryKey, refresh]);
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
                              {payment.status === "paid" && payment.paidAt
                                ? `Paid ${formatDate(payment.paidAt)}`
                                : payment.status === "pending" &&
                                    payment.dueAtClosing
                                  ? "Due at closing"
                                  : paymentLabel(payment.status)}
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
