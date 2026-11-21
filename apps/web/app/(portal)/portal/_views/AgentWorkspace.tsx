"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useAllMatters } from "../../../(workspace)/workspace/_components/data";
import { useAgentBrowse } from "./AgentBrowseState";
import {
  fileAddress,
  fileGroup,
  fileStatus,
  nextDatedStep,
  shortDate,
  type PortalFile,
} from "./portal-model";
import s from "../_components/portal.module.css";

const groups = [
  { id: "active", label: "Active" },
  { id: "closed", label: "Closed" },
  { id: "terminated", label: "Terminated" },
] as const;

function FileCard({ file }: { file: PortalFile }) {
  const received = file.stage === "pending_review";
  const next = nextDatedStep(file.tasks);
  const receivedOn = shortDate(file.createdAt);
  const closedOn = shortDate(file.closedOn);
  return (
    <Link
      href={`/portal/transactions/${encodeURIComponent(file.id)}`}
      className={s.fileCard}
    >
      <span
        className={`${s.badge} ${received ? s.received : file.stage === "closed" ? s.closed : file.stage === "under_contract" || file.stage === "closing" ? s.underContract : ""}`}
      >
        {fileStatus(file.stage)}
      </span>
      <strong>{fileAddress(file)}</strong>
      {received ? (
        <p>
          Ireland is reviewing your intake
          {receivedOn ? ` (sent ${receivedOn})` : ""}. The timeline appears once
          she creates the file.
        </p>
      ) : file.stage === "closed" ? (
        closedOn && <p>Closed {closedOn}</p>
      ) : (
        next && (
          <p>
            Next: {next.title} · {next.dateLabel || shortDate(next.dueDate)}
          </p>
        )
      )}
    </Link>
  );
}

export function AgentWorkspace() {
  const query = useAllMatters();
  const files: PortalFile[] = query.data;
  const { group: filter, setGroup, search, setSearch } = useAgentBrowse();
  const needle = search.trim().toLowerCase();
  const matches = files
    .filter(
      (file) =>
        fileGroup(file.stage) === filter &&
        [fileAddress(file), file.title, ...(file.clientNames || [])].some(
          (value) => value?.toLowerCase().includes(needle),
        ),
    )
    .sort(
      (left, right) =>
        Number(left.stage === "pending_review") -
        Number(right.stage === "pending_review"),
    );
  const refresh = query.refresh;
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function update() {
      if (!window.document.hidden && navigator.onLine) await refresh();
      if (!disposed) timer = setTimeout(() => void update(), 8_000);
    }
    timer = setTimeout(() => void update(), 8_000);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [refresh]);
  return (
    <div className={s.main}>
      <div className={s.intro}>
        <div>
          <h1>Your files with Ireland</h1>
          <p>
            See where each deal stands. Ireland handles the paperwork and
            emails.
          </p>
        </div>
        <Link href="/portal/intake" className={s.button}>
          Submit a new intake
        </Link>
      </div>
      <div className={s.filters}>
        <div className={s.segmented} aria-label="File status" role="group">
          {groups.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setGroup(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          <span className={s.visuallyHidden}>Search by address or client</span>
          <input
            type="search"
            className={s.input}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by address or client"
          />
        </label>
      </div>
      {query.error ? (
        <div className={s.panel} role="alert">
          <p>Could not open your files.</p>
          <button
            type="button"
            className={s.secondary}
            onClick={() => void query.refresh()}
          >
            Try again
          </button>
        </div>
      ) : matches.length ? (
        <div className={s.fileGrid}>
          {matches.map((file) => (
            <FileCard key={file.id} file={file} />
          ))}
        </div>
      ) : query.loading && !files.length ? (
        <p role="status">Opening your files…</p>
      ) : (
        <p className={s.muted}>
          {needle ? "No files match your search." : `No ${filter} files.`}
        </p>
      )}
    </div>
  );
}
