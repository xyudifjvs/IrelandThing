"use client";
import Link from "next/link";
import { useData, label } from "./data";
import s from "./workspace.module.css";
type Operations = {
  checkedAt: string;
  worker: { status: "healthy" | "stale" | "unseen"; lastSeenAt: string | null };
  jobs: { failed: number; overdue: number; expiredLeases: number };
  inquiries: { unreviewed: number };
  integrations: {
    provider: string;
    status: string;
    lastSyncedAt: string | null;
    stale: boolean;
  }[];
  recentFailures: {
    id: string;
    topic: string;
    state: string;
    attempts: number;
    error: string | null;
    updatedAt: string;
  }[];
};
function timestamp(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}
const topics: Record<string, string> = {
  "gmail.send": "Email send",
  "gmail.sync": "Mailbox sync",
  "dotloop.sync": "Dotloop sync",
  "ai.extract": "Document review",
  "intake.submitted": "Intake setup",
};
export default function OperationsStatus() {
  const q = useData<Operations>("/api/v1/operations");
  const data = q.data;
  return (
    <section
      className={s.section}
      style={{ marginTop: 25 }}
      aria-labelledby="operations-heading"
    >
      <div className={s.sectionHead}>
        <div>
          <h2 id="operations-heading">Background work and follow-up</h2>
          <p>
            Check saved requests, worker activity and tasks that need attention.
          </p>
        </div>
        <button
          className={s.buttonSmall}
          disabled={q.loading}
          onClick={() => void q.refresh()}
        >
          Refresh status
        </button>
      </div>
      <div className={s.sectionBody}>
        {q.loading && !data && <p role="status">Checking background work…</p>}
        {q.error && (
          <p className={s.error} role="alert">
            Status could not be checked: {q.error}
          </p>
        )}
        {data && (
          <>
            <p
              className={data.worker.status === "healthy" ? s.notice : s.error}
              role="status"
            >
              {data.worker.status === "healthy"
                ? "Worker is checking for work."
                : data.worker.status === "stale"
                  ? "Worker has not checked in within three minutes."
                  : "No worker check-in has been recorded."}{" "}
              Last check-in: {timestamp(data.worker.lastSeenAt)}.
            </p>
            <dl className={s.cardGrid}>
              {[
                ["Failed background tasks", data.jobs.failed],
                ["Pending over 15 minutes", data.jobs.overdue],
                ["Interrupted tasks", data.jobs.expiredLeases],
                ["Unreviewed inquiries", data.inquiries.unreviewed],
              ].map(([name, value]) => (
                <div key={String(name)}>
                  <dt className={s.fieldHint}>{name}</dt>
                  <dd
                    style={{ margin: 0, fontSize: 24, fontFamily: "Georgia" }}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <div className={s.documentActions}>
              <Link className={s.buttonSmall} href="/workspace/onboarding">
                Review inquiries
              </Link>
              <Link className={s.buttonSmall} href="/workspace/inbox">
                Review inbox and drafts
              </Link>
              <a className={s.buttonSmall} href="#connected-tools">
                Review connections
              </a>
            </div>
            <h3 style={{ fontSize: 14, marginTop: 22 }}>
              Connection freshness
            </h3>
            {data.integrations.map((i) => (
              <p key={i.provider} className={s.fieldHint}>
                <strong>
                  {i.provider === "openrouter"
                    ? "Document AI"
                    : label(i.provider)}
                </strong>
                : {label(i.status)} · Last sync: {timestamp(i.lastSyncedAt)}
                {i.stale ? " · More than 24 hours since the last sync" : ""}
              </p>
            ))}
            {!!data.recentFailures.length && (
              <>
                <h3 style={{ fontSize: 14, marginTop: 22 }}>Recent failures</h3>
                <ul style={{ paddingLeft: 20 }}>
                  {data.recentFailures.map((f) => (
                    <li key={f.id} style={{ marginBottom: 14 }}>
                      <strong>{topics[f.topic] || label(f.topic)}</strong> ·{" "}
                      {label(f.state)} · {f.attempts} attempt(s)
                      <p className={s.fieldHint}>{timestamp(f.updatedAt)}</p>
                      {f.error && (
                        <p
                          className={s.tiny}
                          style={{ overflowWrap: "anywhere" }}
                        >
                          {f.error}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
                <p className={s.fieldHint}>
                  Review the related file and connection before repeating an
                  action. This panel does not resend messages, charge payments
                  or retry failed tasks.
                </p>
              </>
            )}
            <p className={s.fieldHint}>
              Checked {timestamp(data.checkedAt)}. Times use your local time
              zone.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
