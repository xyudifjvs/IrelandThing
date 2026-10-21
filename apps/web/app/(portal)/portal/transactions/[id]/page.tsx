"use client";
import { use, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FileText,
  Circle,
  CircleCheck,
  Download,
  LockKeyhole,
  CalendarDays,
  CreditCard,
} from "lucide-react";
import {
  api,
  mutate,
  useData,
  address,
  label,
  date,
  type Matter,
  type Session,
} from "../../../../(workspace)/workspace/_components/data";
import s from "../../_components/portal.module.css";
import SharedMessages from "../../_components/SharedMessages";
import DocumentFiles from "../../../../(workspace)/workspace/_components/DocumentFiles";
export default function Detail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const q = useData<Matter>(`/api/v1/matters/${id}`);
  const session = useData<Session>("/api/v1/session");
  const client = session.data?.user?.role === "client";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState("");
  const [assistant, setAssistant] = useState("");
  const [answer, setAnswer] = useState("");
  if (q.loading || session.loading)
    return (
      <div className={s.main}>
        <div className={s.loading}>Opening your file…</div>
      </div>
    );
  if (!q.data)
    return (
      <div className={s.main}>
        <div className={s.error}>{q.error || "This file is unavailable."}</div>
        <Link href="/portal">Return to portal</Link>
      </div>
    );
  const m = q.data;
  return (
    <div className={s.main}>
      <Link className={s.back} href="/portal">
        <ArrowLeft size={10} /> Your transactions
      </Link>
      <div className={s.intro}>
        <div>
          <p className={s.eyebrow}>
            {client ? "Client portal" : "Your transaction file"}
          </p>
          <h1>{m.title || address(m)}</h1>
          <p>{address(m)}</p>
        </div>
        <span className={s.status}>{label(m.stage)}</span>
      </div>
      {error && (
        <div className={s.error} role="alert">
          {error}
        </div>
      )}
      <div className={s.columns}>
        <div>
          <section className={s.card}>
            <h2>{client ? "Your transaction timeline" : "Shared checklist"}</h2>
            <p>
              {client
                ? "See the dates and checklist items shared with you."
                : "Review completed steps and upcoming work."}
            </p>
            {client ? (
              <div className={s.timeline}>
                {m.deadlines?.filter((d) => d.status === "confirmed").length ? (
                  m.deadlines
                    .filter((d) => d.status === "confirmed")
                    .map((d) => (
                      <div className={s.milestone} key={d.id}>
                        <h3>{d.label}</h3>
                        <p>{date(d.date)}</p>
                      </div>
                    ))
                ) : (
                  <p>
                    Confirmed contract dates will be shared here after review.
                  </p>
                )}
              </div>
            ) : null}
            {m.tasks?.length ? (
              m.tasks.map((t) => (
                <div className={s.line} key={t.id}>
                  {["completed", "signed", "not_applicable"].includes(
                    t.status,
                  ) ? (
                    <CircleCheck className={s.done} />
                  ) : (
                    <Circle />
                  )}
                  <div style={{ flex: 1 }}>
                    <p>{t.title}</p>
                    <small>
                      {date(t.dueDate)} · {label(t.status)}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <p className={s.hint}>Your shared milestones will appear here.</p>
            )}
          </section>
          <DocumentFiles
            matterId={id}
            coordinator={session.data?.user?.role === "coordinator"}
            actorId={session.data?.user?.id}
            canUpload={["agent", "coordinator"].includes(
              session.data?.user?.role || "",
            )}
          />
        </div>
        <aside>
          <section className={s.card}>
            <p className={s.eyebrow}>Your coordinator</p>
            <h2>Questions about this file?</h2>
            <p>
              Contact Ireland with questions about your documents or upcoming
              dates.
            </p>
            <Link className={s.secondary} href="/contact">
              Contact Ireland
            </Link>
          </section>
          {!client && (
            <section className={s.card} style={{ marginTop: 23 }}>
              <p className={s.eyebrow}>Your service</p>
              <h2>{label(m.packageCode)}</h2>
              <p>Ireland will confirm when your service fee is due.</p>
              <p className={s.hint}>
                When online payment is available, Ireland can prepare a payment
                link. Check your shared messages or contact her for payment
                instructions.
              </p>
            </section>
          )}
        </aside>
      </div>
      <SharedMessages matterId={id} />
      {m.notes?.length ? (
        <>
          <h2 className={s.sectionHead}>Shared updates</h2>
          <section className={s.card}>
            {m.notes.map((n) => (
              <div key={n.id} className={s.note}>
                {n.body || n.content || n.text}
                <br />
                <small className={s.hint}>{date(n.createdAt)}</small>
              </div>
            ))}
          </section>
        </>
      ) : null}
      <p className={s.private}>
        <LockKeyhole size={10} /> Your account sees only the information shared
        with it.
      </p>
    </div>
  );
}
