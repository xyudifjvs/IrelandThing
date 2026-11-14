"use client";

import { useState, type FormEvent } from "react";
import { formatDate } from "@weatherly/ui";
import { mutate } from "../../_components/data";
import {
  apiPath,
  type ChecklistDatePreview,
  type HtoClosingRow,
} from "./model";
import s from "./hto.module.css";

type Mode = "update_all" | "only_this_date";

function stepLabel(key: string) {
  const words = key.replaceAll("_", " ");
  return words.slice(0, 1).toUpperCase() + words.slice(1);
}

export function ClosingDateForm({
  row,
  done,
  cancel,
}: {
  row: HtoClosingRow;
  done: () => void;
  cancel: () => void;
}) {
  const initialDate = row.checklistCloseDate ?? "";
  const [date, setDate] = useState(initialDate);
  const [preview, setPreview] = useState<ChecklistDatePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const route = `${apiPath}/rows/${row.id}/closing-date`;
  const change = { expectedRevision: row.matterRevision, date: date || null };

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      setPreview(
        await mutate<ChecklistDatePreview>(`${route}/preview`, change),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to preview the closing date.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function apply(mode: Mode) {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      await mutate(`${route}/apply`, {
        ...change,
        previewDigest: preview.previewDigest,
        mode,
      });
      done();
    } catch (reason) {
      setPreview(null);
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to save the closing date.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={s.editor}
      onSubmit={review}
      aria-label="Edit transaction closing date"
    >
      <h2>
        {row.actualCloseDate
          ? "Edit checklist closing date"
          : "Edit close date"}
      </h2>
      <p className={s.muted}>{row.propertyAddress}</p>
      {row.actualCloseDate && (
        <p className={s.muted}>
          Actual close date on file · {formatDate(row.actualCloseDate)}
        </p>
      )}
      <div className={s.fields}>
        <label>
          {row.actualCloseDate ? "Checklist closing date" : "Close date"}
          <input
            type="date"
            value={date}
            disabled={busy}
            onChange={(event) => {
              setPreview(null);
              setDate(event.target.value);
            }}
          />
        </label>
      </div>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {preview && (
        <div className={s.preview} aria-live="polite">
          <p>
            <strong>Closing</strong> ·{" "}
            {formatDate(preview.primary.before?.date)} →{" "}
            {formatDate(preview.primary.after?.date)}
          </p>
          {preview.dependents.length > 0 && (
            <>
              <p>Dates that move with Closing</p>
              <ul>
                {preview.dependents.map((move) => (
                  <li key={JSON.stringify(move.target)}>
                    {move.target.kind === "acceptance"
                      ? "Acceptance"
                      : stepLabel(move.target.key)}{" "}
                    · {formatDate(move.before?.date)} →{" "}
                    {formatDate(move.after?.date)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <div className={s.actions}>
        {preview ? (
          <>
            <button
              type="button"
              className={s.primary}
              onClick={() => void apply("update_all")}
              disabled={busy}
            >
              Update all dates
            </button>
            <button
              type="button"
              className={s.secondary}
              onClick={() => void apply("only_this_date")}
              disabled={busy}
            >
              Only this date
            </button>
          </>
        ) : (
          <button className={s.primary} disabled={busy || date === initialDate}>
            {busy ? "Checking…" : "Preview changes"}
          </button>
        )}
        <button
          type="button"
          className={s.secondary}
          disabled={busy}
          onClick={cancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
