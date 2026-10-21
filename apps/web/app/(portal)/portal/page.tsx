"use client";
import Link from "next/link";
import { Plus, ArrowUpRight, FolderHeart, LockKeyhole } from "lucide-react";
import {
  useData,
  type Matter,
  type Session,
  address,
  label,
  progress,
  date,
} from "../../(workspace)/workspace/_components/data";
import s from "./_components/portal.module.css";
export default function Portal() {
  const session = useData<Session>("/api/v1/session");
  const q = useData<Matter[]>("/api/v1/matters");
  const client = session.data?.user?.role === "client";
  return (
    <main className={s.main}>
      <div className={s.intro}>
        <div>
          <p className={s.eyebrow}>
            {client ? "Client portal" : "Your agent portal"}
          </p>
          <h1>Hello, {session.data?.user?.name?.split(" ")[0] || "there"}.</h1>
          <p>
            {client
              ? "Review the documents and updates Ireland has shared with you."
              : "Submit new transactions and review updates from Ireland."}
          </p>
        </div>
        {!client && session.data && (
          <Link className={s.button} href="/portal/intake">
            <Plus size={13} />
            New transaction
          </Link>
        )}
      </div>
      {q.error && (
        <div className={s.error} role="alert">
          {q.error}
          <p>
            <Link href="/login">Sign in to your portal</Link>
          </p>
        </div>
      )}
      {session.data?.user?.role === "coordinator" && (
        <div className={s.notice}>
          You’re viewing the portal as the coordinator.{" "}
          <Link href="/workspace">Return to your coordinator workspace.</Link>
        </div>
      )}
      {q.loading ? (
        <div className={s.loading}>Opening your transactions…</div>
      ) : q.data?.length ? (
        <div className={s.grid}>
          {q.data.map((m) => (
            <section className={s.card} key={m.id}>
              <div className={s.split}>
                <p className={s.eyebrow}>
                  {client ? "Your home" : label(m.side) + " side"}
                </p>
                <span className={s.status}>{label(m.stage)}</span>
              </div>
              <h2>{m.title || address(m)}</h2>
              <p className={s.address}>
                {m.title !== address(m)
                  ? address(m)
                  : client
                    ? "View the shared checklist and documents for this property."
                    : label(m.packageCode)}
              </p>
              <div className={s.progress}>
                <span style={{ width: `${progress(m)}%` }} />
              </div>
              <div className={s.split}>
                <small className={s.hint}>
                  {progress(m)}% of shared checklist complete
                </small>
                <small className={s.hint}>
                  {m.tasks?.filter((t) =>
                    ["completed", "signed", "not_applicable"].includes(
                      t.status,
                    ),
                  ).length || 0}{" "}
                  steps complete
                </small>
              </div>
              <div className={s.actions}>
                <Link
                  className={s.button}
                  href={`/portal/transactions/${m.id}`}
                >
                  {client ? "See your timeline" : "Open transaction"}
                  <ArrowUpRight size={12} />
                </Link>
              </div>
            </section>
          ))}
        </div>
      ) : (
        !q.error && (
          <div className={s.empty}>
            <FolderHeart />
            No transactions yet.
            <br />
            {client
              ? "Your transaction will appear here when Ireland shares it with you."
              : "Submit an intake to get your file started."}
            {!client && (
              <p>
                <Link className={s.button} href="/portal/intake">
                  Start your first intake
                </Link>
              </p>
            )}
          </div>
        )
      )}
      <p className={s.private}>
        <LockKeyhole size={10} /> Only the transactions and documents shared
        with your account appear here.
      </p>
    </main>
  );
}
