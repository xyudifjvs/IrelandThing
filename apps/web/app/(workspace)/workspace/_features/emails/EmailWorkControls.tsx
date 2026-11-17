"use client";

import { useState } from "react";
import { mutate, useData, date } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import type { EmailWork } from "./email-model";

const easternDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function tomorrow() {
  const parts = Object.fromEntries(
    easternDate
      .formatToParts(new Date())
      .map(({ type, value }) => [type, value]),
  );
  const day = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

export function EmailWorkControls({
  matterId,
  workItemId,
  templateId,
  refresh,
}: {
  matterId: string;
  workItemId?: string | null;
  templateId?: string;
  refresh?: () => Promise<void>;
}) {
  const query = useData<EmailWork[]>(
    workItemId || templateId
      ? `/api/v1/communications/work?matterId=${encodeURIComponent(matterId)}&view=all`
      : null,
  );
  const work = query.data?.find((item) =>
    workItemId ? item.id === workItemId : item.templateId === templateId,
  );
  const [picker, setPicker] = useState(false);
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!workItemId && !templateId)
    return <p className={s.muted}>Save the draft to set a reminder.</p>;
  if (workItemId && query.data && !work)
    return <p className={s.muted}>This email work is no longer available.</p>;
  if (work?.sentAt) return <p className={s.muted}>Sent {date(work.sentAt)}</p>;
  const disabled = busy || query.loading || Boolean(query.error);

  async function change(
    action: "remind" | "clear_reminder" | "manual_complete" | "uncheck",
    remindOn?: string,
  ) {
    setBusy(true);
    setError("");
    try {
      const path = work
        ? `/api/v1/communications/work/${work.id}`
        : `/api/v1/communications/matters/${matterId}/templates/${templateId}/work`;
      await mutate(
        path,
        {
          action,
          expectedRevision: work?.revision ?? null,
          ...(remindOn ? { remindOn } : {}),
        },
        work ? "PATCH" : "POST",
      );
      await Promise.all([query.refresh(), refresh?.()]);
      setPicker(false);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save the email reminder.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.actions}>
      <button
        type="button"
        className={s.buttonSmall}
        disabled={disabled || Boolean(work?.manualCompletedAt)}
        onClick={() => setPicker(!picker)}
      >
        Remind me
      </button>
      {work?.remindOn && (
        <>
          <span>Reminder {date(work.remindOn)}</span>
          <button
            type="button"
            className={s.buttonSmall}
            disabled={disabled}
            onClick={() => void change("clear_reminder")}
          >
            Clear reminder
          </button>
        </>
      )}
      <button
        type="button"
        className={s.buttonSmall}
        disabled={disabled}
        onClick={() =>
          void change(work?.manualCompletedAt ? "uncheck" : "manual_complete")
        }
      >
        {work?.manualCompletedAt
          ? "Uncheck manual completion"
          : "Check off manually"}
      </button>
      {picker && (
        <>
          <button
            type="button"
            className={s.buttonSmall}
            disabled={disabled}
            onClick={() => void change("remind", tomorrow())}
          >
            Tomorrow
          </button>
          <label>
            Reminder date{" "}
            <input
              className={s.input}
              type="date"
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={s.buttonSmall}
            disabled={disabled || !day}
            onClick={() => void change("remind", day)}
          >
            Set reminder
          </button>
        </>
      )}
      {(error || query.error) && (
        <p className={s.error} role="alert">
          {error || query.error}
        </p>
      )}
    </div>
  );
}
