"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Plus } from "lucide-react";
import { mutate, useData } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import styles from "./roster.module.css";
import { AgentContactForm } from "./AgentContactForm";
import { useRosterConfirmation } from "./useRosterConfirmation";
import { AgentDetail } from "./AgentDetail";
import {
  archivePrompt,
  nextRosterAction,
  phaseLabel,
  rosterDate,
  rosterEndpoint,
  type ArchivedRosterEntry,
  type RosterAction,
  type RosterEntry,
} from "./model";

export function RosterWorkspace({
  initialAgentId,
}: {
  initialAgentId: string | null;
}) {
  const confirmation = useRosterConfirmation();
  const roster = useData<RosterEntry[]>(rosterEndpoint);
  const archived = useData<ArchivedRosterEntry[]>(`${rosterEndpoint}/archived`);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [visible, setVisible] = useState(true);
  const [selected, setSelected] = useState({
    id: initialAgentId,
    action: null as RosterAction,
    serial: 0,
  });
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function hide() {
      flushSync(() => setVisible(false));
    }
    function restore(event: PageTransitionEvent) {
      if (event.persisted) window.location.reload();
    }
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
    };
  }, []);

  function select(id: string | null, action: RosterAction = null) {
    setAdding(false);
    setSelected((state) => ({ id, action, serial: state.serial + 1 }));
  }
  useEffect(() => {
    if (selected.id && selected.serial > 0)
      detailRef.current?.querySelector("aside")?.focus();
  }, [selected.id, selected.serial]);
  useEffect(() => {
    if (adding) detailRef.current?.querySelector("input")?.focus();
  }, [adding]);

  if (!visible) return null;
  const query = search.trim().toLowerCase();
  const matches = (roster.data ?? []).filter(
    (row) =>
      !query ||
      row.name.toLowerCase().includes(query) ||
      row.email?.toLowerCase().includes(query) ||
      row.brokerage?.toLowerCase().includes(query),
  );
  const team = matches.filter((row) => row.business === "hto");
  const active = matches.filter(
    (row) =>
      row.business === "weatherly" &&
      ["active", "access_revoked"].includes(row.phase),
  );
  const signingUp = matches.filter(
    (row) => row.business === "weatherly" && !active.includes(row),
  );

  const archivedMatches = (archived.data ?? []).filter(
    (row) =>
      !query ||
      [row.name, row.email, row.brokerage].some((value) =>
        value?.toLowerCase().includes(query),
      ),
  );

  async function restoreArchived(agent: ArchivedRosterEntry) {
    setRestoringId(agent.id);
    setError("");
    try {
      await mutate(`${rosterEndpoint}/${agent.id}/restore`, {
        expectedRevision: agent.revision,
      });
      setSearch("");
      select(agent.id);
      await Promise.all([roster.refresh(), archived.refresh()]);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not restore this entry.",
      );
    } finally {
      setRestoringId(null);
    }
  }

  async function archive(agent: RosterEntry) {
    if (archiveId || !(await confirmation.request(archivePrompt(agent))))
      return;
    setArchiveId(agent.id);
    setError("");
    try {
      const row = agent.source
        ? await mutate<{ id: string; revision: number }>(
            rosterEndpoint + "/import",
            agent.source,
          )
        : agent;
      await mutate(`${rosterEndpoint}/${row.id}/archive`, {
        expectedRevision: row.revision,
        confirmed: true,
      });
      if (selected.id === agent.id) select(null);
      await Promise.all([roster.refresh(), archived.refresh()]);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not archive this agent.",
      );
    } finally {
      setArchiveId(null);
    }
  }

  return (
    <>
      {confirmation.dialog}
      <header className={s.heading}>
        <div>
          <h1>Agent roster</h1>
          <p className={s.subtitle}>
            Track interested agents, sign-up progress, and active agents in one
            place.
          </p>
        </div>
        <button
          className={s.button}
          type="button"
          onClick={() => {
            select(null);
            setAdding(true);
          }}
        >
          <Plus aria-hidden /> Add agent
        </button>
      </header>
      <div className={styles.toolbar}>
        <label className={styles.visuallyHidden} htmlFor="roster-search">
          Search agents by name, email or brokerage
        </label>
        <input
          className={s.input}
          id="roster-search"
          type="search"
          placeholder="Search agents by name, email or brokerage"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {roster.loading && !roster.data && <p role="status">Loading roster…</p>}
      {roster.error && (
        <p className={s.error} role="alert">
          {roster.error}{" "}
          <button
            className={s.buttonSmall}
            onClick={() => void roster.refresh()}
          >
            Retry
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      <div className={styles.layout}>
        <div className={styles.groups}>
          {!!signingUp.length && (
            <section className={`${styles.group} ${styles.signingUp}`}>
              <h2>Signing up</h2>
              <ul>
                {signingUp.map((agent) => {
                  const next = nextRosterAction(agent);
                  return (
                    <li className={styles.row} key={agent.id}>
                      <button
                        className={styles.agent}
                        type="button"
                        aria-pressed={selected.id === agent.id}
                        onClick={() => select(agent.id)}
                      >
                        <span>
                          <strong>{agent.name}</strong>
                          {agent.personalTest && <small>Personal test</small>}
                          {agent.brokerage ? ` · ${agent.brokerage}` : ""}
                        </span>
                        <small>
                          {phaseLabel[agent.phase]} ·{" "}
                          {agent.phase === "inquiry" && agent.booking
                            ? `Call booked ${rosterDate(agent.booking.startAt)}`
                            : rosterDate(agent.phaseOn)}
                        </small>
                      </button>
                      <div className={styles.actions}>
                        {agent.canArchive && (
                          <button
                            className={styles.quiet}
                            type="button"
                            disabled={archiveId !== null}
                            onClick={() => void archive(agent)}
                          >
                            Archive
                          </button>
                        )}
                        {next && (
                          <button
                            className={s.buttonSmall}
                            type="button"
                            onClick={() => select(agent.id, next.kind)}
                          >
                            {next.label}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {roster.data && (
            <>
              <AgentGroup
                title="Home Team Ohio"
                rows={team}
                selectedId={selected.id}
                onSelect={select}
                onArchive={archive}
                busy={archiveId !== null}
                empty={
                  query ? "No team members match." : "No team members yet."
                }
              />
              <AgentGroup
                title="Weatherly agents"
                rows={active}
                selectedId={selected.id}
                onSelect={select}
                onArchive={archive}
                busy={archiveId !== null}
                empty={query ? "No agents match." : "No active agents yet."}
              />
            </>
          )}
          {(!!archived.data?.length || archived.error) && (
            <details className={styles.group}>
              <summary>Archived agents ({archived.data?.length ?? 0})</summary>
              <p>
                Restore an entry to use its saved contact information and
                history. Portal access stays disabled until you restore it
                separately.
              </p>
              {archived.error && (
                <p role="alert">
                  Could not load archived agents.{" "}
                  <button type="button" onClick={() => void archived.refresh()}>
                    Retry
                  </button>
                </p>
              )}
              <ul>
                {archivedMatches.map((agent) => (
                  <li className={styles.row} key={agent.id}>
                    <span>
                      <strong>{agent.name}</strong>
                      <br />
                      <small>{agent.email}</small>
                    </span>
                    <button
                      className={s.buttonSmall}
                      type="button"
                      disabled={restoringId !== null || archiveId !== null}
                      aria-label={`Restore ${agent.name}`}
                      onClick={() => void restoreArchived(agent)}
                    >
                      {restoringId === agent.id ? "Restoring…" : "Restore"}
                    </button>
                  </li>
                ))}
              </ul>
              {query && !archivedMatches.length && (
                <p>No archived agents match.</p>
              )}
            </details>
          )}
        </div>
        <div ref={detailRef}>
          {adding && (
            <aside className={styles.panel} aria-label="Add agent">
              <h2>Add agent</h2>
              <AgentContactForm
                onCancel={() => setAdding(false)}
                onSaved={async (id) => {
                  select(id);
                  await roster.refresh();
                }}
              />
            </aside>
          )}
          {selected.id && (
            <AgentDetail
              key={selected.serial}
              id={selected.id}
              initialAction={selected.action}
              onClose={() => select(null)}
              onChanged={async (id, action) => {
                if (id !== selected.id) select(id, action);
                await Promise.all([roster.refresh(), archived.refresh()]);
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}

function AgentGroup({
  title,
  rows,
  selectedId,
  onSelect,
  onArchive,
  busy,
  empty,
}: {
  title: string;
  rows: RosterEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onArchive: (agent: RosterEntry) => Promise<void>;
  busy: boolean;
  empty: string;
}) {
  return (
    <section className={styles.group}>
      <h2>{title}</h2>
      {rows.length ? (
        <ul>
          {rows.map((agent) => (
            <li className={styles.row} key={agent.id}>
              <button
                className={`${styles.agent} ${styles.groupRow}`}
                type="button"
                aria-pressed={selectedId === agent.id}
                onClick={() => onSelect(agent.id)}
              >
                <span>
                  <strong>{agent.name}</strong>
                  {agent.personalTest && <small>Personal test</small>}
                  {agent.email || agent.phone ? (
                    <small>
                      {[agent.email, agent.phone].filter(Boolean).join(" · ")}
                    </small>
                  ) : null}
                  {agent.business === "weatherly" && (
                    <small>
                      {agent.agreementOnFile
                        ? "Agreement on file"
                        : "No agreement on file"}
                    </small>
                  )}
                  <small>
                    {agent.phase === "access_revoked"
                      ? "Portal access revoked"
                      : phaseLabel[agent.phase]}
                  </small>
                </span>
                <small>
                  {agent.activeFileCount} active · {agent.closedFileCount}{" "}
                  closed
                </small>
              </button>
              <button
                className={styles.quiet}
                type="button"
                disabled={busy}
                aria-label={`Archive ${agent.name}`}
                onClick={() => void onArchive(agent)}
              >
                Archive
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>{empty}</p>
      )}
    </section>
  );
}
