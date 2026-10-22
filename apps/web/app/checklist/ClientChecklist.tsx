"use client";
import { useEffect, useState } from "react";
import { Circle, CircleCheck, LockKeyhole } from "lucide-react";
import { LiveStatus, useLiveData } from "../_components/useLiveData";
import s from "./checklist.module.css";
type Checklist = {
  matter: { id: string; title: string; propertyAddress: string; stage: string };
  tasks: {
    id: string;
    title: string;
    status: string;
    dueDate: string | null;
    position: number;
  }[];
  deadlines: { id: string; label: string; date: string | null }[];
};
function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function date(value: string | null) {
  return value
    ? new Date(
        value.length === 10 ? `${value}T12:00:00` : value,
      ).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Date to be confirmed";
}
export default function ClientChecklist() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const read = () =>
      setToken(
        /^#[A-Za-z0-9_-]{32,256}$/.test(window.location.hash)
          ? window.location.hash.slice(1)
          : "",
      );
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const q = useLiveData<Checklist>(
    token ? "/api/public/checklist" : null,
    token || undefined,
  );
  const data = q.data;
  const complete =
    data?.tasks.filter((task) =>
      ["completed", "signed", "not_applicable"].includes(task.status),
    ).length || 0;
  return (
    <div className={s.page}>
      <header className={s.brand}>
        <span>WEATHERLY</span>
        <small>TRANSACTION CO.</small>
      </header>
      <main id="main-content" className={s.main} tabIndex={-1}>
        <p className={s.eyebrow}>Your transaction · live checklist</p>
        {!data ? (
          <section className={s.card}>
            <h1>
              {token === ""
                ? "This link is incomplete"
                : q.loading || token === null
                  ? "Opening your checklist…"
                  : "Checklist unavailable"}
            </h1>
            <p>
              {token === ""
                ? "Use the complete link provided by your agent or coordinator, including everything after the # sign."
                : "Only the latest confirmed information is shown here. If this link has been replaced or revoked, ask your agent or coordinator for a current link."}
            </p>
            {token && <LiveStatus query={q} />}
          </section>
        ) : (
          <>
            <h1>{data.matter.title || data.matter.propertyAddress}</h1>
            {data.matter.propertyAddress !== data.matter.title && (
              <p className={s.address}>{data.matter.propertyAddress}</p>
            )}
            <div className={s.meta}>
              <span>{label(data.matter.stage)}</span>
              <span>
                {complete} of {data.tasks.length} steps complete
              </span>
            </div>
            <LiveStatus query={q} />
            <section className={s.card} aria-label="Client checklist">
              <h2>Your checklist</h2>
              <p className={s.hint}>
                Ireland updates these steps as your transaction moves forward.
              </p>
              {data.tasks.length ? (
                <ol className={s.tasks}>
                  {data.tasks.map((task) => {
                    const done = [
                      "completed",
                      "signed",
                      "not_applicable",
                    ].includes(task.status);
                    return (
                      <li key={task.id}>
                        {done ? (
                          <CircleCheck
                            aria-label="Complete"
                            className={s.done}
                          />
                        ) : (
                          <Circle aria-hidden="true" />
                        )}
                        <div>
                          <strong>{task.title}</strong>
                          <small>
                            {label(task.status)}
                            {task.dueDate ? ` · ${date(task.dueDate)}` : ""}
                          </small>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p>No checklist steps have been shared yet.</p>
              )}
            </section>
            <section className={s.card} aria-label="Confirmed dates">
              <h2>Confirmed dates</h2>
              {data.deadlines.length ? (
                <dl className={s.dates}>
                  {data.deadlines.map((deadline) => (
                    <div key={deadline.id}>
                      <dt>{deadline.label}</dt>
                      <dd>{date(deadline.date)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>Confirmed contract dates will appear here after review.</p>
              )}
            </section>
          </>
        )}
        <p className={s.footer}>
          <LockKeyhole size={13} aria-hidden="true" /> Read-only checklist. Keep
          this link with the people involved in your transaction.
        </p>
      </main>
    </div>
  );
}
