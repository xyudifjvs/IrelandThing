"use client";
import { useState } from "react";
import Link from "next/link";
import { mutate, useData, type Session, label, date } from "./data";
import s from "./workspace.module.css";
type ReminderStatus = {
  enabled: boolean;
  ready: boolean;
  status: "disabled" | "not_configured" | "scheduled" | "failed";
  deliveryStatus: "not_delivering" | "scheduled_not_verified";
  reason: string;
  schedule: {
    timeZone: string;
    localTime: string;
    weekdays: number[];
    leadDays: number;
  } | null;
  approvedRecipientEmail: string;
  recipient: { id: string; name: string; email: string } | null;
  lastRun: { state: string; error: string | null; updatedAt: string } | null;
};
type Preview = {
  generatedAt: string;
  dateKey: string;
  timeZone: string;
  leadDays: number;
  counts: { mattersScanned: number; overdue: number; upcoming: number };
  items: {
    matterId: string;
    propertyAddress: string;
    label: string;
    date: string;
    bucket: "overdue" | "upcoming";
    sourceRefs: { kind: string; id: string; matterId: string; date: string }[];
  }[];
};
export default function PrivateReminders() {
  const session = useData<Session>("/api/v1/session"),
    allowed = session.data?.user?.role === "coordinator";
  const query = useData<ReminderStatus>(
      allowed ? "/api/v1/reminders/status" : null,
    ),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!allowed) return null;
  const data = query.data;
  const headline = !data
    ? "Status unavailable"
    : data.status === "disabled"
      ? "Disabled — no reminder emails are delivering"
      : data.status === "not_configured"
        ? "Not configured — no reminder emails are delivering"
        : data.status === "failed"
          ? "Failed — review the latest reminder attempt"
        : "Scheduled — delivery not verified";
  return (
    <section
      className={s.section}
      style={{ marginTop: 24, marginBottom: 24 }}
      aria-label="Private reminders"
    >
      <div className={s.sectionHead}>
        <div>
          <h2>Private reminders for Ireland</h2>
          <p>
            8:00 a.m. Eastern, Monday–Friday · overdue items and the next 7
            calendar days
          </p>
        </div>
        <button
          className={s.buttonSmall}
          disabled={query.loading}
          onClick={() => void query.refresh()}
        >
          Refresh status
        </button>
      </div>
      <div className={s.sectionBody}>
        {query.loading ? (
          <p>Checking reminder readiness…</p>
        ) : query.error ? (
          <p className={s.error} role="alert">
            {query.error}
          </p>
        ) : (
          data && (
            <>
              <strong>{headline}</strong>
              <p>{data.reason}</p>
              <p className={s.fieldHint}>
                Approved recipient: {data.approvedRecipientEmail}.{" "}
                {data.recipient
                  ? `Configured recipient: ${data.recipient.email}.`
                  : "Recipient configuration is not ready."}
              </p>
              {data.schedule && (
                <p className={s.fieldHint}>
                  Current configured schedule: {data.schedule.localTime}{" "}
                  {data.schedule.timeZone} · days{" "}
                  {data.schedule.weekdays
                    .map(
                      (day) =>
                        ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day],
                    )
                    .join(", ")}{" "}
                  · {data.schedule.leadDays}-day lookahead.
                </p>
              )}
              {data.lastRun && (
                <p
                  className={
                    data.lastRun.state === "failed" ? s.error : s.fieldHint
                  }
                >
                  Latest job: {label(data.lastRun.state)} ·{" "}
                  {new Date(data.lastRun.updatedAt).toLocaleString("en-US", {
                    timeZone: "America/New_York",
                  })}{" "}
                  Eastern{data.lastRun.error ? ` · ${data.lastRun.error}` : ""}.
                  Job/provider acceptance does not confirm inbox delivery.
                </p>
              )}
            </>
          )
        )}
        <p className={s.fieldHint}>
          Private reminders are limited to Ireland’s approved account. This view
          previews the digest and cannot enable delivery or change recipients.
        </p>
        <button
          className={s.buttonSmall}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            setPreview(null);
            try {
              setPreview(
                await mutate<Preview>("/api/v1/reminders/preview", {
                  timeZone: "America/New_York",
                  leadDays: 7,
                }),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Preparing preview…" : "Preview reminders without sending"}
        </button>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {preview && (
          <div style={{ marginTop: 16 }}>
            <p role="status">
              Preview only · {preview.counts.overdue} overdue ·{" "}
              {preview.counts.upcoming} upcoming ·{" "}
              {preview.counts.mattersScanned} transactions scanned. No email was
              queued or sent.
            </p>
            <p className={s.fieldHint}>
              Confirmed dates and incomplete tasks from reviewed, active files.
              Unreviewed, closed, terminated and archived files are excluded.
            </p>
            {preview.items.length ? (
              <div style={{ overflowX: "auto" }}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th>Transaction</th>
                      <th>Item</th>
                      <th>Date</th>
                      <th>Timing</th>
                      <th>Sources</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.map((item, index) => (
                      <tr key={`${item.matterId}-${index}`}>
                        <td>
                          <Link
                            href={`/workspace/transactions/${item.matterId}`}
                          >
                            {item.propertyAddress || "Untitled transaction"}
                          </Link>
                        </td>
                        <td>{item.label}</td>
                        <td>{date(item.date)}</td>
                        <td>{label(item.bucket)}</td>
                        <td>
                          {item.sourceRefs.map((source, index) => (
                            <span key={`${source.kind}-${source.id}`}>
                              {index ? " · " : ""}
                              <Link
                                href={`/workspace/transactions/${source.matterId}`}
                              >
                                {source.kind === "deadline"
                                  ? "Confirmed date"
                                  : "Checklist task"}
                              </Link>
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No eligible reminder items in this preview.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
