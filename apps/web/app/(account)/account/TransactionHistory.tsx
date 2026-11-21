"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, FolderHeart } from "lucide-react";
import { formatDate } from "@weatherly/ui";
import { useData, label } from "../../(workspace)/workspace/_components/data";
import {
  type Page,
  badgeClass,
  pathWithQuery,
  ErrorState,
  Pagination,
} from "./history-shared";
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
type TransactionSummary = {
  total: number;
  stages: Record<string, number>;
};
const stages = [
  ["all", "All stages"],
  ["listing", "Listing"],
  ["under_contract", "Under contract"],
  ["closing", "Closing"],
  ["closed", "Closed"],
  ["terminated", "Terminated / cancelled"],
  ["archived", "Archived"],
];
function stageLabel(value: string, coordinator: boolean) {
  if (!coordinator && value === "closing") return "Under contract";
  return value === "terminated" ? "Terminated / cancelled" : label(value);
}
export function TransactionHistory({
  coordinator,
  business,
}: {
  coordinator: boolean;
  business?: string;
}) {
  const visibleStages = stages.filter(
    ([stage]) =>
      coordinator ||
      (stage !== "closing" && (stage !== "listing" || business === "hto")),
  );
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
              {visibleStages.map(([value, text]) => (
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
                                {stageLabel(transaction.stage, coordinator)}
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
