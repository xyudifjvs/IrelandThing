"use client";

import { useState } from "react";
import Link from "next/link";
import { Ellipsis } from "lucide-react";
import { date, label, mutate, useData } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import p from "./portfolio.module.css";
import { Pagination } from "./Pagination";
import type { ListPage } from "./model";

type Intake = {
  id: string;
  propertyAddress: string;
  agentName: string | null;
  side: string;
  createdAt: string;
  hasContract: boolean;
};

export function OverviewIntakes() {
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const query = useData<ListPage<Intake>>(
    "/api/v1/portfolio/intakes?limit=12&page=" + page,
  );

  async function remove(intake: Intake) {
    if (busy || !window.confirm("Delete this intake? It can't be restored."))
      return;
    setBusy(intake.id);
    setError("");
    try {
      await mutate(
        "/api/v1/intakes/submissions/" + encodeURIComponent(intake.id),
        { confirm: true },
        "DELETE",
      );
      if (page > 1 && query.data?.items.length === 1) setPage(page - 1);
      else await query.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not delete the intake.",
      );
      await query.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={s.section} aria-labelledby="new-intakes-heading">
      <div className={s.sectionHead}>
        <h2 id="new-intakes-heading">New intakes</h2>
      </div>
      <div className={p.list}>
        {(error || query.error) && (
          <p role="alert" className={s.error}>
            {error || "Could not load intakes."}
          </p>
        )}
        {query.loading && !query.data && <p role="status">Loading intakes…</p>}
        {query.data?.total === 0 && <p className={s.muted}>No new intakes.</p>}
        {query.data?.items.map((intake) => (
          <article key={intake.id} className={p.intake}>
            <span className={p.newPill}>New</span>
            <div>
              <strong>
                {intake.propertyAddress || "Address not provided"}
              </strong>
              <div className={p.meta}>
                {intake.agentName || "Submitting agent"} ·{" "}
                {label(intake.side || "Side not provided")} · Submitted{" "}
                {date(intake.createdAt)}
              </div>
            </div>
            <small className={p.contract}>
              {intake.hasContract ? "Contract attached" : "No contract yet"}
            </small>
            <Link
              className={s.buttonSmall}
              href={"/workspace/intakes/" + encodeURIComponent(intake.id)}
            >
              Create transaction
            </Link>
            <details className={p.intakeMenu}>
              <summary
                aria-label={
                  "Actions for " + (intake.propertyAddress || "intake")
                }
              >
                <Ellipsis size={18} />
              </summary>
              <button
                type="button"
                className={s.buttonSmall}
                disabled={!!busy}
                onClick={() => void remove(intake)}
              >
                {busy === intake.id ? "Deleting…" : "Delete intake"}
              </button>
            </details>
          </article>
        ))}
        <Pagination
          data={query.data}
          change={setPage}
          disabled={query.loading || !!busy}
        />
      </div>
    </section>
  );
}
