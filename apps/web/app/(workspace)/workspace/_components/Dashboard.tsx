"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  BriefcaseBusiness,
  CalendarDays,
  CircleCheck,
  Clock3,
  LockKeyhole,
  Leaf,
} from "lucide-react";
import {
  useData,
  rows,
  address,
  date,
  label,
  progress,
  mutate,
  type Matter,
  type Session,
  type Task,
} from "./data";
import s from "./workspace.module.css";
export default function Dashboard({
  transactions = false,
}: {
  transactions?: boolean;
}) {
  const query = useData<Matter[]>("/api/v1/matters");
  const session = useData<Session>("/api/v1/session");
  const [search, setSearch] = useState("");
  const [todo, setTodo] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const matters = rows(query.data),
    active = matters.filter(
      (m) => !["closed", "terminated"].includes(m.stage || ""),
    );
  const allTasks = matters.flatMap((m) =>
    (m.tasks || []).map((t) => ({
      ...t,
      matterId: m.id,
      matterAddress: address(m),
    })),
  );
  const openTasks = allTasks.filter(
    (t) => !["completed", "signed", "not_applicable"].includes(t.status),
  );
  const week = new Date(Date.now() + 7 * 86400000);
  const due = openTasks
    .filter((t) => t.dueDate && new Date(t.dueDate) <= week)
    .sort(
      (a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime(),
    );
  const closing = active.filter((m) => {
    const value = m.closingDate || m.closeAt || m.details?.closingDate;
    return (
      typeof value === "string" &&
      new Date(value).getMonth() === new Date().getMonth()
    );
  });
  const filtered = matters.filter((m) =>
    address(m).toLowerCase().includes(search.toLowerCase()),
  );
  async function addTodo(e: React.FormEvent) {
    e.preventDefault();
    if (!todo.trim() || !active[0]) return;
    setSaving(true);
    setError("");
    try {
      await mutate(`/api/v1/matters/${active[0].id}/tasks`, {
        title: todo,
        visibility: "coordinator",
        kind: "personal",
      });
      setTodo("");
      await query.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className={s.heading}>
        <div>
          <p className={s.eyebrow}>A little clarity, a smoother closing</p>
          <h1>
            {transactions
              ? "Your transactions"
              : `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${session.data?.user?.name?.split(" ")[0] || "there"}`}
          </h1>
          <p className={s.subtitle}>
            {transactions
              ? "Every file, every milestone, all in one place."
              : `${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · Here’s where things stand.`}
          </p>
        </div>
        <Link className={s.button} href="/workspace/new">
          <Plus />
          New transaction
        </Link>
      </div>
      {query.error && (
        <div className={s.error} role="alert">
          {query.error}{" "}
          <button
            className={s.buttonSmall}
            onClick={() => void query.refresh()}
          >
            Try again
          </button>{" "}
          <Link href="/login">Sign in</Link>
        </div>
      )}
      <div className={s.stats}>
        {[
          {
            label: "Active transactions",
            value: active.length,
            hint: "Moving toward the finish line",
            icon: BriefcaseBusiness,
          },
          {
            label: "Closing this month",
            value: closing.length,
            hint:
              new Date().toLocaleDateString("en-US", { month: "long" }) +
              " closings",
            icon: CalendarDays,
          },
          {
            label: "Needs your attention",
            value: due.length,
            hint: "Deadlines in the next 7 days",
            icon: Clock3,
          },
          {
            label: "Closed transactions",
            value: matters.filter((m) => m.stage === "closed").length,
            hint: "Every detail, taken care of",
            icon: CircleCheck,
          },
        ].map((st) => (
          <div className={s.stat} key={st.label}>
            <span className={s.statIcon}>
              <st.icon />
            </span>
            <div className={s.statValue}>{query.loading ? "—" : st.value}</div>
            <div className={s.statLabel}>{st.label}</div>
            <div className={s.statHint}>{st.hint}</div>
          </div>
        ))}
      </div>
      <div className={s.columns}>
        <div>
          <section className={s.section}>
            <div className={s.sectionHead}>
              <div>
                <h2>From listing to closing</h2>
                <p>A clear view of your pipeline.</p>
              </div>
              <Link href="/workspace/new?side=seller&package=full_listing">
                Add a listing <Plus />
              </Link>
            </div>
            <div className={s.stageGrid}>
              {[
                { name: "Pre-listing", stages: ["listing", "pre_listing"] },
                {
                  name: "Under contract",
                  stages: ["active", "under_contract"],
                },
                { name: "Closing soon", stages: ["closing"] },
                { name: "Closed", stages: ["closed"] },
              ].map((g) => (
                <div key={g.name} className={s.stage}>
                  <strong>
                    {query.loading
                      ? "—"
                      : matters.filter((m) => g.stages.includes(m.stage || ""))
                          .length}
                  </strong>
                  <small>{g.name}</small>
                </div>
              ))}
            </div>
          </section>
          <section className={s.section}>
            <div className={s.sectionHead}>
              <div>
                <h2>
                  {transactions ? "All transactions" : "Active transactions"}
                </h2>
                <p>The details are handled. You can see the bigger picture.</p>
              </div>
              {!transactions && (
                <Link href="/workspace/transactions">
                  View all <ArrowUpRight />
                </Link>
              )}
            </div>
            {transactions && (
              <div className={s.sectionBody} style={{ paddingBottom: 15 }}>
                <label className={s.srOnly} htmlFor="search">
                  Search transactions
                </label>
                <input
                  id="search"
                  className={s.input}
                  placeholder="Search by property address…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            )}
            {query.loading ? (
              <div className={s.loading}>Loading your transactions…</div>
            ) : filtered.length ? (
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Property / transaction</th>
                    <th>Stage</th>
                    <th>Progress</th>
                    <th>Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {(transactions
                    ? filtered
                    : filtered.filter((m) => m.stage !== "closed").slice(0, 6)
                  ).map((m) => (
                    <tr key={m.id}>
                      <td>
                        <Link href={`/workspace/transactions/${m.id}`}>
                          {address(m)}
                        </Link>
                        <small>
                          {m.title !== address(m)
                            ? m.title
                            : label(m.side) + " side"}{" "}
                          · {label(m.packageCode)}
                        </small>
                      </td>
                      <td>
                        <span
                          className={`${s.pill} ${m.stage === "closed" ? s.pillGreen : ""}`}
                        >
                          {label(m.stage)}
                        </span>
                      </td>
                      <td>
                        {progress(m)}%
                        <div className={s.progress}>
                          <span style={{ width: `${progress(m)}%` }} />
                        </div>
                      </td>
                      <td>
                        {date(
                          m.closingDate ||
                            m.closeAt ||
                            (typeof m.details?.closingDate === "string"
                              ? m.details.closingDate
                              : null),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className={s.empty}>
                <BriefcaseBusiness />A fresh start for your next closing.
                <br />
                Your transactions will appear here when you submit an intake.
                <p>
                  <Link className={s.buttonSmall} href="/workspace/new">
                    Start a transaction <ArrowRight size={12} />
                  </Link>
                </p>
              </div>
            )}
          </section>
          <div
            className={s.notice}
            style={{ display: "flex", alignItems: "center", gap: 13 }}
          >
            <Leaf size={24} strokeWidth={1} />
            <div>
              <strong
                style={{ fontFamily: "Georgia", fontWeight: 400, fontSize: 16 }}
              >
                The details make the difference.
              </strong>
              <br />
              <span className={s.tiny}>
                A thoughtfully managed file, from the first signature to the
                final handoff.
              </span>
            </div>
          </div>
        </div>
        <div>
          <section className={s.section}>
            <div className={s.sectionHead}>
              <div>
                <h2>Needs attention</h2>
                <p>Open deadlines in the next seven days.</p>
              </div>
              <Clock3 size={17} color="#a18c6e" strokeWidth={1.3} />
            </div>
            <div className={s.sectionBody}>
              {query.loading ? (
                <div className={s.loading}>Checking deadlines…</div>
              ) : due.length ? (
                due.slice(0, 6).map((t) => (
                  <div className={s.attention} key={t.id}>
                    <div className={s.dateBadge}>{date(t.dueDate)}</div>
                    <div>
                      <strong>{t.title}</strong>
                      <p>{t.matterAddress}</p>
                    </div>
                    <Link
                      href={`/workspace/transactions/${t.matterId}`}
                      aria-label={`Open ${t.title}`}
                    >
                      <ArrowUpRight />
                    </Link>
                  </div>
                ))
              ) : (
                <div className={s.empty} style={{ padding: "20px 0" }}>
                  <CircleCheck />A little breathing room.
                  <br />
                  No task deadlines due this week.
                </div>
              )}
            </div>
          </section>
          <section className={s.section}>
            <div className={s.sectionHead}>
              <div>
                <h2>My to-do</h2>
                <p className={s.privateLabel}>
                  <LockKeyhole />
                  Private to your workspace
                </p>
              </div>
            </div>
            <div className={s.sectionBody}>
              {allTasks
                .filter((t) => t.visibility === "coordinator")
                .slice(0, 5)
                .map((t) => (
                  <Todo key={t.id} task={t} refresh={query.refresh} />
                ))}
              {!allTasks.some((t) => t.visibility === "coordinator") && (
                <p className={`${s.muted} ${s.tiny}`}>
                  A place for the little things you don’t want to forget.
                </p>
              )}
              {error && <p className={s.error}>{error}</p>}
              <form onSubmit={addTodo} className={s.formRow}>
                <label className={s.srOnly} htmlFor="todo">
                  New private to-do
                </label>
                <input
                  id="todo"
                  className={s.input}
                  placeholder={
                    active.length
                      ? "Add a private task…"
                      : "Create a transaction to add tasks"
                  }
                  value={todo}
                  onChange={(e) => setTodo(e.target.value)}
                  disabled={!active.length}
                />
                <button
                  className={s.buttonSmall}
                  type="submit"
                  aria-label="Add private task"
                  disabled={!todo.trim() || saving || !active.length}
                >
                  <Plus size={13} />
                </button>
              </form>
              {active[0] && (
                <p className={s.fieldHint}>Saved to {address(active[0])}.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
function Todo({ task, refresh }: { task: Task; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div>
      <label className={s.todo}>
        <input
          type="checkbox"
          checked={["completed", "signed", "not_applicable"].includes(
            task.status,
          )}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            try {
              await mutate(
                `/api/v1/matters/${task.matterId}/tasks/${task.id}`,
                {
                  expectedRevision: task.revision,
                  status: e.target.checked ? "completed" : "pending",
                },
                "PATCH",
              );
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
        <span
          style={{
            textDecoration: ["completed", "signed", "not_applicable"].includes(
              task.status,
            )
              ? "line-through"
              : "none",
          }}
        >
          {task.title}
        </span>
      </label>
      {error && <p className={s.error}>{error}</p>}
    </div>
  );
}
