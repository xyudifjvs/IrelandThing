"use client";
import { use, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  FileText,
  Download,
  LockKeyhole,
  Upload,
  Users,
  CalendarDays,
} from "lucide-react";
import {
  useData,
  api,
  mutate,
  address,
  date,
  label,
  progress,
  type Matter,
} from "../../_components/data";
import s from "../../_components/workspace.module.css";
import DocumentFiles from "../../_components/DocumentFiles";
import UserPicker from "../../_components/UserPicker";
import Contacts, { AgentAssignment } from "../../_components/Contacts";
export default function Detail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const q = useData<Matter>(`/api/v1/matters/${id}`);
  const [tab, setTab] = useState("Checklist");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [task, setTask] = useState("");
  const [person, setPerson] = useState({ userId: "", role: "client" });
  const [notice, setNotice] = useState("");
  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await fn();
      await q.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  if (q.loading && !q.data)
    return <div className={s.loading}>Opening your transaction…</div>;
  if (!q.data)
    return (
      <div className={s.error}>
        {q.error || "Transaction not found."}
        <p>
          <Link href="/workspace">Return to workspace</Link>
        </p>
      </div>
    );
  const m = q.data;
  const tasks = m.tasks || [];
  return (
    <>
      <Link className={s.backLink} href="/workspace/transactions">
        <ArrowLeft />
        All transactions
      </Link>
      <div className={s.detailHeader}>
        <div className={s.split}>
          <div>
            <p className={s.eyebrow}>Your transaction file</p>
            <h1>{m.title || address(m)}</h1>
            <p>{address(m)}</p>
          </div>
          <span
            className={`${s.pill} ${m.stage === "closed" ? s.pillGreen : ""}`}
          >
            {label(m.stage)}
          </span>
        </div>
        <div className={s.chips}>
          <label className={s.fieldHint}>
            Stage{" "}
            <select
              className={s.select}
              value={m.stage}
              disabled={!!busy}
              onChange={(e) =>
                void act("stage", () =>
                  mutate(
                    `/api/v1/matters/${id}`,
                    { expectedRevision: m.revision, stage: e.target.value },
                    "PATCH",
                  ),
                )
              }
            >
              {[
                "listing",
                "under_contract",
                "closing",
                "closed",
                "terminated",
                "archived",
              ].map((v) => (
                <option value={v} key={v}>
                  {label(v)}
                </option>
              ))}
            </select>
          </label>
          <span className={s.pill}>{label(m.side)} side</span>
          <span className={s.pill}>{label(m.packageCode)}</span>
          {m.details?.cash === true && (
            <span className={s.pill}>Cash purchase</span>
          )}
          <span className={s.pill}>{progress(m)}% of checklist complete</span>
        </div>
        <div className={s.progress} style={{ marginTop: 23 }}>
          <span style={{ width: `${progress(m)}%` }} />
        </div>
      </div>
      {error && (
        <div className={s.error} role="alert">
          {error}
        </div>
      )}
      {notice && <div className={s.notice}>{notice}</div>}
      <div className={s.tabs} role="tablist" aria-label="Transaction sections">
        {[
          "Checklist",
          "Documents",
          "Emails",
          "Broker file",
          "My notes & to-do",
        ].map((t, index, tabs) => (
          <button
            key={t}
            role="tab"
            id={`transaction-tab-${index}`}
            aria-selected={tab === t}
            aria-controls="transaction-panel"
            tabIndex={tab === t ? 0 : -1}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft")
                next = (index - 1 + tabs.length) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault();
              setTab(tabs[next]);
              document.getElementById(`transaction-tab-${next}`)?.focus();
            }}
            onClick={() => setTab(t)}
            className={tab === t ? s.tabActive : ""}
          >
            {t}
          </button>
        ))}
      </div>
      <div
        className={s.twoCol}
        role="tabpanel"
        id="transaction-panel"
        tabIndex={0}
        aria-labelledby={`transaction-tab-${["Checklist", "Documents", "Emails", "Broker file", "My notes & to-do"].indexOf(tab)}`}
      >
        <div>
          {tab === "Checklist" && (
            <>
              <section className={s.section}>
                <div className={s.sectionHead}>
                  <div>
                    <h2>Transaction checklist</h2>
                    <p>Update checklist items and choose who can see them.</p>
                  </div>
                </div>
                <div className={s.sectionBody}>
                  {tasks.filter((t) => t.visibility !== "coordinator")
                    .length ? (
                    tasks
                      .filter((t) => t.visibility !== "coordinator")
                      .map((t) => (
                        <div className={s.taskLine} key={t.id}>
                          <input
                            aria-label={`Mark ${t.title} complete`}
                            type="checkbox"
                            checked={[
                              "completed",
                              "signed",
                              "not_applicable",
                            ].includes(t.status)}
                            disabled={!!busy}
                            onChange={(e) =>
                              void act(t.id, () =>
                                mutate(
                                  `/api/v1/matters/${id}/tasks/${t.id}`,
                                  {
                                    expectedRevision: t.revision,
                                    status: e.target.checked
                                      ? "completed"
                                      : "pending",
                                  },
                                  "PATCH",
                                ),
                              )
                            }
                          />
                          <label>
                            {t.title}
                            <small>
                              {label(t.visibility)} · {date(t.dueDate)}
                            </small>
                          </label>
                          <select
                            className={s.select}
                            style={{ maxWidth: 150 }}
                            aria-label={`Status for ${t.title}`}
                            value={t.status}
                            disabled={!!busy}
                            onChange={(e) =>
                              void act(t.id, () =>
                                mutate(
                                  `/api/v1/matters/${id}/tasks/${t.id}`,
                                  {
                                    expectedRevision: t.revision,
                                    status: e.target.value,
                                  },
                                  "PATCH",
                                ),
                              )
                            }
                          >
                            {[
                              "pending",
                              "received",
                              "proposed",
                              "completed",
                              "signed",
                              "not_applicable",
                            ].map((value) => (
                              <option key={value} value={value}>
                                {label(value)}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))
                  ) : (
                    <div className={s.empty}>
                      No checklist steps yet. Add the first step below.
                    </div>
                  )}
                  <form
                    className={s.formRow}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act("task", async () => {
                        await mutate(`/api/v1/matters/${id}/tasks`, {
                          title: task,
                          visibility: "agent",
                          kind: "custom",
                        });
                        setTask("");
                      });
                    }}
                  >
                    <input
                      className={s.input}
                      aria-label="New checklist step"
                      placeholder="Add a checklist step…"
                      value={task}
                      onChange={(e) => setTask(e.target.value)}
                      required
                    />
                    <button
                      className={s.buttonSmall}
                      disabled={!!busy || !task.trim()}
                    >
                      <Plus size={13} />
                      Add
                    </button>
                  </form>
                </div>
              </section>
              <section className={s.section}>
                <div className={s.sectionHead}>
                  <div>
                    <h2>Dates & deadlines</h2>
                    <p>
                      Confirm contract dates before relying on the timeline.
                    </p>
                  </div>
                  <button
                    className={s.buttonSmall}
                    disabled={!!busy}
                    onClick={() =>
                      void act("recalculate", async () => {
                        await mutate(
                          `/api/v1/workflows/matters/${id}/recalculate`,
                          { expectedRevision: m.revision },
                        );
                        setNotice(
                          "Proposed timeline recalculated. Manual dates are preserved. Review the updated milestones below.",
                        );
                      })
                    }
                  >
                    Recalculate timeline
                  </button>
                </div>
                <div className={s.sectionBody}>
                  {m.deadlines?.length ? (
                    m.deadlines.map((d) => (
                      <DeadlineEditor
                        key={`${d.id}:${d.revision}`}
                        matterId={id}
                        deadline={d}
                        busy={!!busy}
                        act={act}
                      />
                    ))
                  ) : (
                    <p className={s.empty}>
                      Add a contract deadline to begin the timeline.
                    </p>
                  )}
                  <details style={{ marginTop: 20 }}>
                    <summary
                      style={{
                        fontSize: 11,
                        cursor: "pointer",
                        color: "#8c7251",
                      }}
                    >
                      Add a deadline
                    </summary>
                    <form
                      className={s.formGrid}
                      style={{ marginTop: 18 }}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const f = new FormData(form);
                        void act("deadline-add", async () => {
                          await mutate(`/api/v1/matters/${id}/deadlines`, {
                            label: String(f.get("label")),
                            date: f.get("date") ? String(f.get("date")) : null,
                            status: f.get("date") ? "confirmed" : "unknown",
                            details: { source: "coordinator" },
                          });
                          form.reset();
                        });
                      }}
                    >
                      <label className={s.field}>
                        Milestone
                        <input
                          className={s.input}
                          name="label"
                          required
                          placeholder="e.g. Inspection response"
                        />
                      </label>
                      <label className={s.field}>
                        Confirmed contract date
                        <input className={s.input} name="date" type="date" />
                      </label>
                      <button className={s.buttonSmall} disabled={!!busy}>
                        Add deadline
                      </button>
                    </form>
                  </details>
                </div>
              </section>
            </>
          )}
          {tab === "Documents" && <DocumentFiles matterId={id} coordinator />}
          {tab === "Emails" && (
            <section className={s.section}>
              <div className={s.sectionHead}>
                <div>
                  <h2>Transaction email</h2>
                  <p>Connected email and drafts for the people on this deal.</p>
                </div>
              </div>
              <div className={s.sectionBody}>
                <div className={s.notice}>
                  Gmail connection is required before messages can be synced or
                  sent. Your coordinator’s contact permissions still apply.
                </div>
                <Link
                  className={s.buttonSecondary}
                  href={`/workspace/inbox?matterId=${id}`}
                >
                  Open transaction inbox
                </Link>
              </div>
            </section>
          )}
          {tab === "Broker file" && (
            <section className={s.section}>
              <div className={s.sectionHead}>
                <div>
                  <h2>Broker file & compliance</h2>
                  <p>
                    Approved brokerage requirements guide the final file review.
                  </p>
                </div>
              </div>
              <div className={s.sectionBody}>
                {tasks
                  .filter((t) =>
                    ["compliance", "broker"].includes(t.kind || ""),
                  )
                  .map((t) => (
                    <div className={s.taskLine} key={t.id}>
                      <span style={{ flex: 1 }}>{t.title}</span>
                      <select
                        className={s.select}
                        style={{ maxWidth: 150 }}
                        aria-label={`Status for ${t.title}`}
                        value={t.status}
                        disabled={!!busy}
                        onChange={(e) =>
                          void act(t.id, () =>
                            mutate(
                              `/api/v1/matters/${id}/tasks/${t.id}`,
                              {
                                expectedRevision: t.revision,
                                status: e.target.value,
                              },
                              "PATCH",
                            ),
                          )
                        }
                      >
                        {[
                          "pending",
                          "received",
                          "proposed",
                          "completed",
                          "signed",
                          "not_applicable",
                        ].map((value) => (
                          <option key={value} value={value}>
                            {label(value)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                <div className={s.notice}>
                  Review the approved brokerage checklist and supporting
                  documents before marking a file complete. AI findings require
                  coordinator review.
                </div>
                <Link
                  href={`/workspace/review?matterId=${id}`}
                  className={s.buttonSecondary}
                >
                  Open document review
                </Link>
              </div>
            </section>
          )}
          {tab === "My notes & to-do" && (
            <section className={s.section}>
              <div className={s.sectionHead}>
                <div>
                  <h2>Private notes</h2>
                  <p className={s.privateLabel}>
                    <LockKeyhole />
                    Coordinator only. Agents and clients cannot see this.
                  </p>
                </div>
              </div>
              <div className={s.sectionBody}>
                {tasks
                  .filter((t) => t.visibility === "coordinator")
                  .map((t) => (
                    <div className={s.taskLine} key={t.id}>
                      <input
                        aria-label={`Complete ${t.title}`}
                        type="checkbox"
                        checked={[
                          "completed",
                          "signed",
                          "not_applicable",
                        ].includes(t.status)}
                        disabled={!!busy}
                        onChange={(e) =>
                          void act(t.id, () =>
                            mutate(
                              `/api/v1/matters/${id}/tasks/${t.id}`,
                              {
                                expectedRevision: t.revision,
                                status: e.target.checked
                                  ? "completed"
                                  : "pending",
                              },
                              "PATCH",
                            ),
                          )
                        }
                      />
                      <span>{t.title}</span>
                    </div>
                  ))}
                {m.notes?.map((n) => (
                  <div className={s.note} key={n.id}>
                    <p>{n.content || n.text || n.body}</p>
                    <small>{date(n.createdAt)}</small>
                  </div>
                ))}
                <form
                  style={{ marginTop: 20 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act("note", async () => {
                      await mutate(`/api/v1/matters/${id}/notes`, {
                        body: note,
                        visibility: "coordinator",
                      });
                      setNote("");
                    });
                  }}
                >
                  <label className={s.field}>
                    Notes on this transaction
                    <textarea
                      className={s.textarea}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      required
                      placeholder="Add a note about this transaction…"
                    />
                  </label>
                  <button
                    className={s.button}
                    style={{ marginTop: 12 }}
                    disabled={!!busy || !note.trim()}
                  >
                    {busy === "note" ? "Saving…" : "Save private note"}
                  </button>
                </form>
              </div>
            </section>
          )}
        </div>
        <aside>
          <AgentAssignment matter={m} refresh={q.refresh} />
          <Contacts matter={m} refresh={q.refresh} />
          <section className={s.section}>
            <div className={s.sectionHead}>
              <div>
                <h2>Portal access</h2>
                <p>Access for existing agent and client accounts.</p>
              </div>
              <Users size={17} strokeWidth={1.3} />
            </div>
            <div className={s.sectionBody}>
              {m.participants?.length ? (
                m.participants.map((p) => (
                  <div className={s.attention} key={p.id}>
                    <div className={s.avatar}>
                      {p.name?.slice(0, 1) ||
                        p.role?.slice(0, 1).toUpperCase() ||
                        "?"}
                    </div>
                    <div>
                      <strong>{p.name || p.userId || label(p.role)}</strong>
                      <p>
                        {label(p.role)}
                        <br />
                        {p.email}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className={`${s.muted} ${s.tiny}`}>
                  No additional participants have been added.
                </p>
              )}
              <details style={{ marginTop: 18 }}>
                <summary
                  style={{ cursor: "pointer", fontSize: 11, color: "#8b7151" }}
                >
                  Grant portal access
                </summary>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act("person", async () => {
                      await mutate(
                        `/api/v1/matters/${id}/participants`,
                        person,
                      );
                      setPerson({ userId: "", role: "client" });
                    });
                  }}
                  style={{ display: "grid", gap: 10, marginTop: 15 }}
                >
                  <UserPicker
                    label="Portal account"
                    role={person.role}
                    value={person.userId}
                    onChange={(userId) => setPerson({ ...person, userId })}
                    disabled={!!busy}
                  />
                  <p className={s.fieldHint}>
                    Grant access only to an existing agent or client account.
                    Contact details from the intake remain in its saved record.
                  </p>
                  <select
                    className={s.select}
                    aria-label="Participant role"
                    value={person.role}
                    onChange={(e) =>
                      setPerson({ userId: "", role: e.target.value })
                    }
                  >
                    {["client", "agent"].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  <button className={s.buttonSmall} disabled={!!busy}>
                    Add to this file
                  </button>
                </form>
              </details>
            </div>
          </section>
          <div className={s.notice}>
            <LockKeyhole size={16} />
            <p style={{ margin: "7px 0 0" }}>
              Coordinator: complete file.
              <br />
              Agent: assigned file and shared updates.
              <br />
              Client: permitted timeline and documents.
            </p>
            <p className={s.tiny}>
              Private notes stay private. Portal access requires an authorized
              invitation.
            </p>
          </div>
          <Link href="/portal" className={s.buttonSecondary}>
            Open your portal
          </Link>
        </aside>
      </div>
    </>
  );
}

function DeadlineEditor({
  matterId,
  deadline: d,
  busy,
  act,
}: {
  matterId: string;
  deadline: NonNullable<Matter["deadlines"]>[number];
  busy: boolean;
  act: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [value, setValue] = useState(d.date?.slice(0, 10) || "");
  const [status, setStatus] = useState(d.status);
  return (
    <form
      className={s.taskLine}
      style={{ alignItems: "flex-start", flexWrap: "wrap" }}
      onSubmit={(e) => {
        e.preventDefault();
        void act(d.id, () =>
          mutate(
            `/api/v1/matters/${matterId}/deadlines/${d.id}`,
            {
              expectedRevision: d.revision,
              date: value || null,
              status: value ? status : "unknown",
            },
            "PATCH",
          ),
        );
      }}
    >
      <div style={{ flex: "1 1 150px" }}>
        <strong style={{ fontWeight: 500, fontSize: 12 }}>{d.label}</strong>
        <p className={s.fieldHint}>
          {label(d.status)}
          {d.sourceDocumentId && (
            <>
              {" "}
              ·{" "}
              <a
                href={`/api/v1/documents/${d.sourceDocumentId}/download`}
                target="_blank"
                rel="noreferrer"
              >
                Review source
              </a>
            </>
          )}
        </p>
      </div>
      <label className={s.field} style={{ maxWidth: 160 }}>
        Contract date
        <input
          className={s.input}
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <label className={s.field} style={{ maxWidth: 135 }}>
        Review status
        <select
          className={s.select}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {["unknown", "proposed", "confirmed", "rejected"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <button
        className={s.buttonSmall}
        style={{ marginTop: 23 }}
        disabled={busy}
      >
        Save date
      </button>
    </form>
  );
}
