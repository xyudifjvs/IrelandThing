"use client";
import SavedIntakeDetails from "../../../../_components/SavedIntakeDetails";
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
  serviceName,
  date,
  appointment,
  type Matter,
  type Session,
} from "../../../../(workspace)/workspace/_components/data";
import s from "../../_components/portal.module.css";
import SharedMessages from "../../_components/SharedMessages";
import { LiveStatus, useLiveData } from "../../../../_components/useLiveData";
import ChecklistShare from "../../../../_components/ChecklistShare";
import DocumentFiles from "../../../../(workspace)/workspace/_components/DocumentFiles";
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
  const client = session.data?.user?.role === "client";
  const documentUploads = useTransactionDocumentUploads({
    matterId: id,
    coordinator: session.data?.user?.role === "coordinator",
    actorId: session.data?.user?.id,
    authorized:
      !!q.data &&
      session.data?.user?.role === "coordinator",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState("");
  const [assistant, setAssistant] = useState("");
  const [answer, setAnswer] = useState("");
  if ((q.loading && !q.data) || session.loading)
    return (
      <div className={s.main}>
        <div className={s.loading}>Opening your file…</div>
      </div>
    );
  if (!q.data)
    return (
      <div className={s.main}>
        <div className={s.error}>{q.error || "This file is unavailable."}</div>
        <LiveStatus query={q} />
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
      <LiveStatus query={q} />
      {m.stage==="pending_review"&&<p className={s.notice}>Received—awaiting Ireland’s review. Your timeline will appear after Ireland confirms the file.</p>}
      {m.stage==="terminated"&&!client&&<p><Link href={`/portal/intake?replaces=${m.id}&side=${m.side}&package=${m.packageCode==="complete"?"complete":"essentials"}`}>Start a linked replacement transaction</Link></p>}
      {!client && <SavedIntakeDetails value={m.details?.referenceIntake} />}
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
                    {t.note&&<p>{t.note}</p>}
                    {t.appointmentAt&&<small>{appointment(t.appointmentAt)}</small>}
                  </div>
                </div>
              ))
            ) : (
              <p className={s.hint}>Your shared milestones will appear here.</p>
            )}
          </section>
          <DocumentFiles
            matterId={id}
            uploads={documentUploads}
            coordinator={session.data?.user?.role === "coordinator"}
            actorId={session.data?.user?.id}
            canUpload={session.data?.user?.role === "coordinator"}
          />
        </div>
        <aside>
          {["agent", "coordinator"].includes(session.data?.user?.role || "") && m.stage !== "pending_review" && <ChecklistShare matterId={id} tasks={m.tasks || []} />}
          <section className={s.card}>
            <p className={s.eyebrow}>Your coordinator</p>
            <h2>Questions about this file?</h2>
            <p>
              This transaction timeline is read-only. Contact Ireland with questions about your documents or upcoming dates.
            </p>
            <Link className={s.secondary} href="/contact">
              Contact Ireland
            </Link>
          </section>
          {!client && (
            <section className={s.card} style={{ marginTop: 23 }}>
              <p className={s.eyebrow}>Your service</p>
              <h2>{serviceName(m)}</h2>
              <p>Your service fee is due at closing.</p>
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
