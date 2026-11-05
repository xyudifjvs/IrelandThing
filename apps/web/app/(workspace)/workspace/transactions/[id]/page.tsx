"use client";
import {agentCanSee,clientCanSee,audienceVisibility} from "../../../../_lib/checklist-audiences";
import InitialFileReview from "../../_components/InitialFileReview";
import SavedIntakeDetails from "../../../../_components/SavedIntakeDetails";
import { use, useState, type ComponentProps } from "react";
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
  serviceName,
  progress,
  type Matter,
  type Session,
} from "../../_components/data";
import s from "../../_components/workspace.module.css";
import DocumentFiles from "../../_components/DocumentFiles";
import UserPicker from "../../_components/UserPicker";
import Contacts, { AgentAssignment } from "../../_components/Contacts";
import { LiveStatus, useLiveData } from "../../../../_components/useLiveData";
import ChecklistShare from "../../../../_components/ChecklistShare";
import ChecklistTask from "../../../../_components/ChecklistTask";
import cs from "../../../../_components/checklist.module.css";
import { useTransactionDocumentUploads } from "../../../../_components/useTransactionDocumentUploads";
export default function Detail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <TransactionDetail key={id} id={id} />;
}
function TransactionDetail({ id }: { id: string }) {
  const q = useLiveData<Matter>(`/api/v1/matters/${id}`, undefined, true);
  const session = useData<Session>("/api/v1/session");
  const documentUploads = useTransactionDocumentUploads({
    matterId: id,
    coordinator: true,
    actorId: session.data?.user?.id,
    authorized: !!q.data && session.data?.user?.role === "coordinator",
  });
  const [tab, setTab] = useState("Checklist");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [task, setTask] = useState("");
  const [clientRequest, setClientRequest] = useState(false);
  const [taskVisibility, setTaskVisibility] = useState("agent");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskNoteValue,setTaskNoteValue]=useState("");
  const [taskAppointmentValue,setTaskAppointmentValue]=useState("");
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
        <LiveStatus query={q} />
        <p>
          <Link href="/workspace">Return to workspace</Link>
        </p>
      </div>
    );
  const m = q.data;
  const tasks = m.tasks || [];
  const sharedTasks = tasks.filter((t) => t.visibility !== "coordinator");
  async function moveTask(taskId: string, targetId: string) {
    const taskIds = tasks.map((t) => t.id);
    const from = taskIds.indexOf(taskId),
      to = taskIds.indexOf(targetId);
    taskIds.splice(from, 1);
    taskIds.splice(to, 0, taskId);
    await mutate(`/api/v1/matters/${id}/tasks/reorder`, {
      taskIds,
      expectedRevision: m.revision,
    });
  }
  return (
    <>
      <Link className={s.backLink} href="/workspace/transactions">
        <ArrowLeft />
        All transactions
      </Link>
      {m.stage==='terminated'&&<p><Link href={`/workspace/new?replaces=${m.id}&side=${m.side}&package=${m.packageCode==='complete'?'complete':'essentials'}`}>Start a linked replacement transaction</Link></p>}
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
              disabled={!!busy || m.stage === "pending_review"}
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
                "pending_review",
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
          <span className={s.pill}>{serviceName(m)}</span>
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
      <LiveStatus query={q} />
      {m.stage==='pending_review'&&<InitialFileReview matter={m} refresh={q.refresh} uploads={documentUploads} actorId={session.data?.user?.id}/>}
      {m.stage!=="pending_review"&&<SavedIntakeDetails value={m.details?.referenceIntake} />}
      {Array.isArray((m.details?.fileReview as {unresolvedDates?:unknown[]}|undefined)?.unresolvedDates)&&<div className={s.notice}>{((m.details!.fileReview as {unresolvedDates:{deadlineId:string;label:string;reason:string}[]}).unresolvedDates).filter(item=>m.deadlines?.some(d=>d.id===item.deadlineId&&d.status!=="confirmed")).map(item=><p key={item.deadlineId}><strong>Unresolved: {item.label}</strong> · {item.reason}</p>)}</div>}
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
                  {sharedTasks.length ? (
                    sharedTasks.map((t, index) => (
                      <ChecklistTask
                        key={t.id}
                        task={t}
                        matterId={id}
                        busy={!!busy}
                        act={act}
                        moveUp={
                          index > 0
                            ? () => moveTask(t.id, sharedTasks[index - 1].id)
                            : undefined
                        }
                        moveDown={
                          index < sharedTasks.length - 1
                            ? () => moveTask(t.id, sharedTasks[index + 1].id)
                            : undefined
                        }
                      />
                    ))
                  ) : (
                    <div className={s.empty}>
                      No checklist steps yet. Add the first step below.
                    </div>
                  )}
                  <BusyForm busy={!!busy}
                    className={cs.addForm}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act("task", async () => {
                        await mutate(`/api/v1/matters/${id}/tasks`, {
                          title: task,
                          visibility: taskVisibility,
                          dueDate: taskDueDate || undefined,
                          kind: clientRequest ? "client_request" : "custom",
                          note:taskNoteValue,
                          appointmentAt:taskAppointmentValue?new Date(taskAppointmentValue).toISOString():null,
                        });
                        setTask("");
                        setTaskDueDate("");
                        setClientRequest(false);
                        setTaskNoteValue("");setTaskAppointmentValue("");
                      });
                    }}
                  >
                    <label>
                      New checklist step
                      <input
                        className={s.input}
                        aria-label="New checklist step"
                        placeholder="Add a checklist step…"
                        value={task}
                        onChange={(e) => setTask(e.target.value)}
                        required
                        maxLength={300}
                      />
                    </label>
                    <div className={cs.editorFields}>
                      <fieldset style={{border:0,padding:0,margin:0}}><legend>Visible to</legend><label><input type="checkbox" aria-label="New step visible to agent" checked={agentCanSee(taskVisibility)} onChange={e=>setTaskVisibility(audienceVisibility(e.target.checked,clientCanSee(taskVisibility)))}/> Agent</label><label><input type="checkbox" aria-label="New step visible to client" checked={clientCanSee(taskVisibility)} onChange={e=>{setTaskVisibility(audienceVisibility(agentCanSee(taskVisibility),e.target.checked));if(!e.target.checked)setClientRequest(false);}}/> Client link</label></fieldset>
                      <label>
                        Due date (optional)
                        <input
                          className={s.input}
                          aria-label="New step due date"
                          type="date"
                          value={taskDueDate}
                          onChange={(e) => setTaskDueDate(e.target.value)}
                        />
                      </label>
                    </div>
                    <label>
                      <input
                        type="checkbox"
                        checked={clientRequest}
                        onChange={(e) => {setClientRequest(e.target.checked);if(e.target.checked)setTaskVisibility(audienceVisibility(agentCanSee(taskVisibility),true));}}
                      />{" "}
                      Display as read-only client instructions
                    </label>
                    <label>Short note<textarea aria-label="New step note" className={s.input} maxLength={1000} value={taskNoteValue} onChange={e=>setTaskNoteValue(e.target.value)}/></label><label>Appointment (your local time)<input className={s.input} aria-label="New step appointment" type="datetime-local" value={taskAppointmentValue} onChange={e=>setTaskAppointmentValue(e.target.value)}/></label>
                    <button
                      className={s.buttonSmall}
                      disabled={!!busy || !task.trim()}
                    >
                      <Plus size={13} />
                      Add
                    </button>
                  </BusyForm>
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
                        key={d.id}
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
                    <BusyForm busy={!!busy}
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
                            visibility: audienceVisibility(f.get("visibleAgent") === "on", f.get("visibleClient") === "on"),
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
                      <fieldset style={{border:0,padding:0,margin:0}}><legend>Visible to</legend><label><input type="checkbox" name="visibleAgent"/> Agent</label><label><input type="checkbox" name="visibleClient"/> Client link</label><p className={s.fieldHint}>New dates stay private until you choose an audience.</p></fieldset>
                    </BusyForm>
                  </details>
                </div>
              </section>
            </>
          )}
          {tab === "Documents" && (
            <DocumentFiles
              matterId={id}
              coordinator
              uploads={documentUploads}
            />
          )}
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
                    <ChecklistTask
                      key={t.id}
                      task={t}
                      matterId={id}
                      busy={!!busy}
                      act={act}
                    />
                  ))}
                {m.notes?.map((n) => (
                  <div className={s.note} key={n.id}>
                    <p>{n.content || n.text || n.body}</p>
                    <small>{date(n.createdAt)}</small>
                  </div>
                ))}
                <BusyForm busy={!!busy}
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
                </BusyForm>
              </div>
            </section>
          )}
        </div>
        <aside>
          <ChecklistShare matterId={id} tasks={tasks} />
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
                <BusyForm busy={!!busy}
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
                </BusyForm>
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
  const [draft, setDraft] = useState<{
    value: string;
    status: string;
    revision?: number;
    visibility?: string;
  } | null>(null);
  const value = draft?.value ?? d.date?.slice(0, 10) ?? "";
  const status = draft?.status ?? d.status;
  const visibility = draft?.visibility ?? d.visibility ?? "client";
  const conflict = !!draft && draft.revision !== d.revision;
  return (
    <BusyForm busy={!!busy}
      className={s.taskLine}
      style={{ alignItems: "flex-start", flexWrap: "wrap" }}
      onSubmit={(e) => {
        e.preventDefault();
        void act(d.id, async () => {
          await mutate(
            `/api/v1/matters/${matterId}/deadlines/${d.id}`,
            {
              expectedRevision: draft?.revision ?? d.revision,
              date: value || null,
              status: value ? status : "unknown",
              ...(draft?.visibility !== undefined ? { visibility: draft.visibility } : {}),
            },
            "PATCH",
          );
          setDraft(null);
        });
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
          disabled={busy}
          onChange={(e) =>
            setDraft({
              value: e.target.value,
              status,
              revision: draft?.revision ?? d.revision,
              ...(draft?.visibility !== undefined ? {visibility:draft.visibility} : {}),
            })
          }
        />
      </label>
      <label className={s.field} style={{ maxWidth: 135 }}>
        Review status
        <select
          className={s.select}
          value={status}
          disabled={busy}
          onChange={(e) =>
            setDraft({
              value,
              status: e.target.value,
              revision: draft?.revision ?? d.revision,
              ...(draft?.visibility !== undefined ? {visibility:draft.visibility} : {}),
            })
          }
        >
          {["unknown", "proposed", "confirmed", "rejected"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <fieldset disabled={busy} style={{border:0,padding:0,margin:0}}><legend>Visible to</legend><label><input type="checkbox" aria-label={`Show ${d.label} date to agent`} checked={agentCanSee(visibility)} onChange={e=>setDraft({value,status,revision:draft?.revision??d.revision,visibility:audienceVisibility(e.target.checked,clientCanSee(visibility))})}/> Agent</label><label><input type="checkbox" aria-label={`Show ${d.label} date to client`} checked={clientCanSee(visibility)} onChange={e=>setDraft({value,status,revision:draft?.revision??d.revision,visibility:audienceVisibility(agentCanSee(visibility),e.target.checked)})}/> Client link</label>{d.linkedToTask&&<p className={s.fieldHint}>This date also follows its milestone’s audience. Sharing the date cannot reveal a hidden milestone.</p>}</fieldset>
      <button
        className={s.buttonSmall}
        style={{ marginTop: 23 }}
        disabled={busy || conflict}
      >
        Save date
      </button>
      {conflict && (
        <p className={s.error}>
          This date changed while you were editing. Your draft is preserved.{" "}
          <button type="button" onClick={() => setDraft(null)}>
            Use latest date
          </button>
        </p>
      )}
    </BusyForm>
  );
}

/** Keep the visible inputs equal to the snapshot being saved. */
function BusyForm({busy,children,...props}:ComponentProps<"form">&{busy:boolean}){
  return <form {...props}><fieldset disabled={busy} style={{display:"contents"}}>{children}</fieldset></form>;
}
