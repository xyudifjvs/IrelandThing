"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Info, Plus } from "lucide-react";
import { mutate, useData } from "../../_components/data";
import { ClosingDateForm } from "./ClosingDateForm";
import { ClosingFactsForm } from "./ClosingFactsForm";
import { ClosingTable } from "./ClosingTable";
import {
  apiPath,
  formatCents,
  statusLabels,
  type HtoClosingRow,
  type HtoFilters,
  type HtoOperationsView,
} from "./model";
import s from "./hto.module.css";

type Editor =
  | { kind: "facts"; row: HtoClosingRow | null }
  | { kind: "date"; row: HtoClosingRow };

const ranges = {
  this_month: "This month",
  last_month: "Last month",
  this_year: "This year",
  all_time: "All time",
};

function listPath(filters: HtoFilters) {
  const params = new URLSearchParams({ range: filters.range });
  if (filters.agentId) params.set("agentId", filters.agentId);
  if (filters.status) params.set("status", filters.status);
  return `${apiPath}?${params}`;
}

async function downloadCsv(filters: HtoFilters, rowIds: string[]) {
  const response = await fetch(`${apiPath}/export`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filters, rowIds }),
  });
  if (!response.ok) {
    const reason = await response.json().catch(() => ({}));
    throw new Error(
      reason.error?.message || "Unable to download the closing rows.",
    );
  }
  const disposition = response.headers.get("content-disposition");
  const filename =
    disposition?.match(/filename="([a-zA-Z0-9-]+\.csv)"/)?.[1] ??
    "closings-for-FUB.csv";
  const href = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
}

export function HtoOperations() {
  const [filters, setFilters] = useState<HtoFilters>({ range: "this_year" });
  const { data, error, loading, refresh } = useData<HtoOperationsView>(
    listPath(filters),
  );
  const [selected, setSelected] = useState(new Set<string>());
  const [editor, setEditor] = useState<Editor | null>(null);
  const [actionError, setActionError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [matching, setMatching] = useState(false);
  const editorArea = useRef<HTMLDivElement>(null);
  const editorTrigger = useRef<HTMLElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!editor) return;
    editorArea.current?.focus();
  }, [editor]);

  function filter(next: Partial<HtoFilters>) {
    setFilters({ ...filters, ...next });
    setSelected(new Set());
  }

  function openEditor(next: Editor) {
    if (!editor)
      editorTrigger.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    setEditor(next);
  }

  function closeEditor() {
    setEditor(null);
    if (editorTrigger.current?.isConnected) editorTrigger.current.focus();
    else addButton.current?.focus();
  }

  function saveEditor() {
    setSelected(new Set());
    closeEditor();
    void refresh();
  }

  async function exportRows() {
    setExporting(true);
    setActionError("");
    try {
      await downloadCsv(filters, [...selected]);
    } catch (reason) {
      setActionError(
        reason instanceof Error
          ? reason.message
          : "Unable to download the closing rows.",
      );
    } finally {
      setExporting(false);
    }
  }

  async function resolveMatch(
    row: HtoClosingRow,
    candidate?: NonNullable<HtoClosingRow["match"]>["candidates"][number],
  ) {
    if (!row.match || row.matterRevision == null) return;
    setMatching(true);
    setActionError("");
    try {
      await mutate(`${apiPath}/rows/${row.id}/match`, {
        key: row.match.key,
        expectedMatterRevision: row.matterRevision,
        expectedRowRevision: row.revision,
        ...(candidate
          ? {
              action: "link",
              candidateId: candidate.id,
              candidateRevision: candidate.revision,
            }
          : { action: "dismiss" }),
      });
      setSelected(new Set());
      await refresh();
    } catch (reason) {
      setActionError(
        reason instanceof Error ? reason.message : "Unable to save the match.",
      );
    } finally {
      setMatching(false);
    }
  }

  const rows = data?.rows ?? [];
  const agents = data?.agents ?? [];
  const totals = data?.totals;
  return (
    <section className={s.page} aria-labelledby="hto-heading">
      <header className={s.heading}>
        <h1 id="hto-heading">HTO Operations</h1>
        <div className={s.actions}>
          <button
            ref={addButton}
            className={s.secondary}
            disabled={!data}
            onClick={() => openEditor({ kind: "facts", row: null })}
          >
            <Plus aria-hidden="true" /> Add a row
          </button>
          <button
            className={s.primary}
            disabled={!rows.length || exporting || loading}
            onClick={() => void exportRows()}
          >
            <Download aria-hidden="true" />{" "}
            {exporting ? "Preparing download…" : "Download for FUB (CSV)"}
          </button>
        </div>
      </header>
      <p className={s.tip}>
        <Info aria-hidden="true" /> Filter to one agent before downloading to
        assign the whole file to that agent in Follow Up Boss.
      </p>
      {editor && (
        <div ref={editorArea} tabIndex={-1} className={s.editorArea}>
          {editor.kind === "facts" ? (
            <ClosingFactsForm
              key={editor.row?.id ?? "manual"}
              row={editor.row}
              agents={agents}
              cancel={closeEditor}
              done={saveEditor}
            />
          ) : (
            <ClosingDateForm
              key={editor.row.id}
              row={editor.row}
              cancel={closeEditor}
              done={saveEditor}
            />
          )}
        </div>
      )}
      {actionError && (
        <p className={s.error} role="alert">
          {actionError}
        </p>
      )}
      <div className={s.filters} aria-label="Closing row filters">
        <label>
          Agent
          <select
            value={filters.agentId ?? ""}
            onChange={(event) =>
              filter({ agentId: event.target.value || undefined })
            }
          >
            <option value="">All agents</option>
            {agents.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={filters.status ?? ""}
            onChange={(event) =>
              filter({
                status: (event.target.value ||
                  undefined) as HtoFilters["status"],
              })
            }
          >
            <option value="">All statuses</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Close date
          <select
            value={filters.range}
            onChange={(event) =>
              filter({ range: event.target.value as HtoFilters["range"] })
            }
          >
            {Object.entries(ranges).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {selected.size > 0 && (
          <span className={s.selection} role="status">
            {selected.size} selected for export
          </span>
        )}
      </div>
      {loading && (
        <p role="status" className={s.muted}>
          Loading closing rows…
        </p>
      )}
      {error && (
        <div className={s.error} role="alert">
          {error}{" "}
          <button className={s.quiet} onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      )}
      {totals && (
        <dl className={s.totals}>
          <div>
            <dt>Closed</dt>
            <dd>{totals.closed}</dd>
          </div>
          <div>
            <dt>Closed volume</dt>
            <dd>{formatCents(totals.closedVolumeCents)}</dd>
          </div>
          <div>
            <dt>Active listings</dt>
            <dd>{totals.activeListings}</dd>
          </div>
          <div>
            <dt>Under contract</dt>
            <dd>{totals.underContract}</dd>
          </div>
        </dl>
      )}
      {data && (
        <div className={s.content}>
          {rows.length ? (
            <ClosingTable
              rows={rows}
              selected={selected}
              toggleRow={(id) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              toggleAll={() =>
                setSelected(
                  selected.size === rows.length
                    ? new Set()
                    : new Set(rows.map(({ id }) => id)),
                )
              }
              edit={(row) => openEditor({ kind: "facts", row })}
              editDate={(row) => openEditor({ kind: "date", row })}
              resolveMatch={(row, candidate) =>
                void resolveMatch(row, candidate)
              }
              matching={matching}
            />
          ) : (
            <p className={s.empty}>No closing rows for these filters.</p>
          )}
          <section className={s.byAgent} aria-labelledby="hto-by-agent">
            <h2 id="hto-by-agent">By agent</h2>
            <p className={s.muted}>{ranges[filters.range]}</p>
            {data.byAgent.length ? (
              <ul>
                {data.byAgent.map((agent) => (
                  <li key={agent.id}>
                    <button
                      className={s.quiet}
                      aria-pressed={filters.agentId === agent.id}
                      onClick={() =>
                        filter({
                          agentId:
                            filters.agentId === agent.id ? undefined : agent.id,
                        })
                      }
                    >
                      {agent.name}
                    </button>
                    <span>{agent.closed} closed</span>
                    <strong>{formatCents(agent.closedVolumeCents)}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.muted}>
                Add Home Team Ohio agents in the roster.
              </p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
