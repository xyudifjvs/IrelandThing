"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { date, label } from "../../_components/data";
import { useLiveData } from "../../../../_components/useLiveData";
import { Pagination } from "./Pagination";
import { transactionLink, type ListPage, type Milestone } from "./model";
import s from "../../_components/workspace.module.css";
import p from "./portfolio.module.css";

const statuses = {
  active: "Active",
  closed: "Closed",
  terminated: "Terminated",
  all: "All",
};
const businesses = {
  all: "All businesses",
  hto: "Home Team Ohio",
  weatherly: "Weatherly TC",
};

type Transaction = {
  id: string;
  propertyAddress: string;
  side: string;
  stage: string;
  business: "hto" | "weatherly";
  agentName: string | null;
  nextDeadline: Milestone | null;
  closing: string | null;
  toSend: {
    count: number;
    next: { title: string; remindOn: string | null } | null;
  };
};

function Filter<T extends string>({
  label,
  selected,
  options,
  onChange,
}: {
  label: string;
  selected: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <div className={p.filters} role="group" aria-label={label}>
      {(Object.entries(options) as [T, string][]).map(([value, text]) => (
        <button
          key={value}
          type="button"
          aria-pressed={selected === value}
          onClick={() => onChange(value)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function TransactionList() {
  const [status, setStatus] = useState<keyof typeof statuses>("active");
  const [business, setBusiness] = useState<keyof typeof businesses>("all");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [q, setQuery] = useState("");
  useEffect(() => {
    const delay = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 220);
    return () => clearTimeout(delay);
  }, [search]);
  const params = new URLSearchParams({
    status,
    business,
    q,
    page: String(page),
    limit: "30",
  });
  const list = useLiveData<ListPage<Transaction>>(
    "/api/v1/portfolio/transactions?" + params,
  );
  return (
    <>
      <div className={s.heading}>
        <div>
          <p className={s.eyebrow}>Your files</p>
          <h1>Transactions</h1>
        </div>
      </div>
      <div className={p.toolbar}>
        <Filter
          label="File status"
          selected={status}
          options={statuses}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <Filter
          label="Business"
          selected={business}
          options={businesses}
          onChange={(value) => {
            setBusiness(value);
            setPage(1);
          }}
        />
        <input
          type="search"
          className={s.input}
          value={search}
          maxLength={200}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search transactions"
          placeholder="Search by address, agent or client"
        />
      </div>
      <section className={s.section} aria-label="Matching transactions">
        <div className={s.sectionBody}>
          {list.error && (
            <p role="alert" className={s.error}>
              Could not load transactions.
            </p>
          )}
          {list.loading && !list.data && (
            <p role="status">Loading transactions…</p>
          )}
          {list.data && (
            <>
              <p className={p.matchCount} role="status">
                {list.data.total}{" "}
                {list.data.total === 1 ? "transaction" : "transactions"}
              </p>
              {list.data.items.length > 0 && (
                <div className={p.tableWrap}>
                  <table className={p.table}>
                    <thead>
                      <tr>
                        {[
                          "Property",
                          "Business",
                          "Agent",
                          "Side",
                          "To send",
                          "Next deadline",
                          "Closing",
                        ].map((column) => (
                          <th key={column} scope="col">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {list.data.items.map((file) => (
                        <tr key={file.id}>
                          <td data-label="Property">
                            <Link
                              className={p.propertyLink}
                              href={transactionLink(file.id)}
                            >
                              {file.propertyAddress}
                            </Link>
                            <small className={p.meta}>
                              {label(file.stage)}
                            </small>
                          </td>
                          <td data-label="Business">
                            <span
                              className={
                                file.business === "hto"
                                  ? p.htoPill
                                  : p.weatherlyPill
                              }
                            >
                              {businesses[file.business]}
                            </span>
                          </td>
                          <td data-label="Agent">{file.agentName || "—"}</td>
                          <td data-label="Side">{label(file.side)}</td>
                          <td data-label="To send">
                            {file.toSend.count ? (
                              <>
                                <Link href={transactionLink(file.id, "emails")}>
                                  {file.toSend.count} to send
                                </Link>
                                {file.toSend.next && (
                                  <small className={p.meta}>
                                    {file.toSend.next.title} ·{" "}
                                    {file.toSend.next.remindOn
                                      ? date(file.toSend.next.remindOn)
                                      : "Saved for later"}
                                  </small>
                                )}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td data-label="Next deadline">
                            {file.nextDeadline
                              ? file.nextDeadline.label +
                                " · " +
                                date(file.nextDeadline.day)
                              : "—"}
                          </td>
                          <td data-label="Closing">
                            {file.closing ? date(file.closing) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Pagination
                data={list.data}
                change={setPage}
                disabled={list.loading}
              />
            </>
          )}
        </div>
      </section>
    </>
  );
}
