"use client";
import { useState } from "react";
import Link from "next/link";
import { useData, date, label } from "./data";
import s from "./workspace.module.css";
export type IntakeReceipt = {
  id: string;
  userId: string;
  matterId: string;
  processedAt: string | null;
  createdAt: string;
  snapshot: Record<string, unknown>;
  agent: { name: string; email: string; brokerage?: string } | null;
  documents?: {
    id: string;
    name: string;
    category: string;
    versions: { id: string; version: number; processingStatus: string }[];
  }[];
};
export type IntakePage = {
  items: IntakeReceipt[];
  newCount: number;
  total: number;
  page: number;
};
export default function IntakeInbox() {
  const [page, setPage] = useState(1);
  const q = useData<IntakePage>(
    `/api/v1/intakes/submissions?page=${page}&limit=30`,
  );
  return (
    <>
      <div className={s.heading}>
        <div>
          <p className={s.eyebrow}>Agent submissions</p>
          <h1>Submitted intakes</h1>
          <p>
            Review the agent’s details and documents, then create the
            transaction. New intakes stay at the top until you create their
            transactions.
          </p>
        </div>
        <Link className={s.buttonSecondary} href="/workspace/new">
          Start a transaction manually
        </Link>
      </div>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <h2>
            {q.data
              ? `${q.data.newCount} new · ${q.data.total} submitted`
              : "Submitted intakes"}
          </h2>
          <button
            className={s.buttonSmall}
            disabled={q.loading}
            onClick={() => void q.refresh()}
          >
            Refresh intakes
          </button>
        </div>
        <div className={s.sectionBody}>
          {q.error && (
            <p className={s.error} role="alert">
              {q.error}
            </p>
          )}
          {q.loading && !q.data && <p role="status">Loading intakes…</p>}
          {q.data?.items.map((intake) => (
            <article
              key={intake.id}
              className={s.note}
              style={{ padding: "20px 0", borderBottom: "1px solid #e6dccb" }}
            >
              <div className={s.split}>
                <div>
                  <span className={s.pill}>
                    {intake.processedAt ? "Transaction created" : "New"}
                  </span>
                  <h3>
                    {String(
                      intake.snapshot.propertyAddress || "Address not provided",
                    )}
                  </h3>
                  <p>
                    {intake.agent?.name || "Submitting agent"} ·{" "}
                    {intake.agent?.email}
                    <br />
                    {intake.snapshot.packageCode === "complete"
                      ? "Contract to Close + Compliance"
                      : intake.snapshot.packageCode === "essentials"
                        ? "Contract to Close"
                        : label(String(intake.snapshot.packageCode || ""))}{" "}
                    · {label(String(intake.snapshot.side || ""))} · Submitted{" "}
                    {date(intake.createdAt)}
                  </p>
                </div>
                <Link
                  className={intake.processedAt ? s.buttonSecondary : s.button}
                  href={`/workspace/intakes/${intake.id}`}
                >
                  Open intake
                </Link>
              </div>
              {intake.processedAt && (
                <Link
                  className={s.backLink}
                  href={`/workspace/transactions/${intake.matterId}`}
                >
                  Open transaction
                </Link>
              )}
            </article>
          ))}
          {q.data && !q.data.total && (
            <div className={s.empty}>
              No submitted intakes yet.
              <br />
              When an agent submits the form, it will appear here with their
              documents and contact information.
            </div>
          )}
          {q.data && q.data.total > 30 && (
            <div className={s.formRow}>
              <button
                className={s.buttonSmall}
                disabled={page === 1 || q.loading}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span>
                Page {page} of {Math.ceil(q.data.total / 30)}
              </span>
              <button
                className={s.buttonSmall}
                disabled={page * 30 >= q.data.total || q.loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
