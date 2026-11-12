import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  ChecklistDateEdit,
  DateValue,
} from "@weatherly/platform/handoff-contracts";
import {
  dateValueAtLocalTime,
  localDeadlineClock,
} from "../../../../../../../packages/matters/src/date-graph/calendar";
import { mutate } from "../../_components/data";
import type { TransactionAction } from "../../_components/transaction-controls";
import {
  displayDate,
  targetLabel,
  type DatePreview,
  type DateTarget,
} from "./canonical-checklist-model";
import s from "./canonical-checklist.module.css";

export type DateEditorDraft =
  | { kind: "set"; target: DateTarget; value: DateValue | null }
  | { kind: "extend"; key: string };

export function ChecklistDateEditor({
  draft,
  matterId,
  revision,
  timeZone,
  labels,
  act,
  busy,
  onClose,
}: {
  draft: DateEditorDraft;
  matterId: string;
  revision?: number;
  timeZone: string | null;
  labels: Record<string, string>;
  act: TransactionAction;
  busy: boolean;
  onClose: () => void;
}) {
  const target: DateTarget =
    draft.kind === "set" ? draft.target : { kind: "step", key: draft.key };
  const formRef = useRef<HTMLFormElement>(null);
  const [expectedRevision] = useState(revision);
  const [day, setDay] = useState(
    draft.kind === "set" ? (draft.value?.date ?? "") : "",
  );
  const [time, setTime] = useState(
    draft.kind === "set"
      ? localDeadlineClock(draft.value?.instant, timeZone)
      : "",
  );
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState<"days" | "hours">("days");
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{
    edit: ChecklistDateEdit;
    preview: DatePreview;
  } | null>(null);
  const endpoint = `/api/v1/matters/${matterId}/checklist/dates`;
  const label = targetLabel(target, labels);
  const stale = expectedRevision !== revision;

  useEffect(() => {
    if (!pending) formRef.current?.querySelector("input")?.focus();
  }, [pending]);

  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!expectedRevision || stale || requesting) return;
    setRequesting(true);
    setError("");
    try {
      const edit: ChecklistDateEdit = {
        expectedRevision,
        change:
          draft.kind === "extend"
            ? { kind: "extend", key: draft.key, amount: Number(amount), unit }
            : {
                kind: "set",
                target,
                value: day ? dateValueAtLocalTime(day, time, timeZone) : null,
              },
      };
      const result = await mutate<DatePreview>(`${endpoint}/preview`, edit);
      setPending({ edit, preview: result });
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not preview this date change.",
      );
    } finally {
      setRequesting(false);
    }
  }

  function apply(mode: "update_all" | "only_this_date") {
    if (!pending) return;
    void act("checklist-date", async () => {
      await mutate(`${endpoint}/apply`, {
        ...pending.edit,
        mode,
        previewDigest: pending.preview.previewDigest,
      });
      onClose();
    });
  }

  if (pending) {
    const { primary, dependents } = pending.preview;
    const stalePreview = pending.preview.revision !== revision;
    return (
      <div className={s.editor}>
        <strong>{label}</strong>
        <p>
          {displayDate(primary.before, timeZone)} →{" "}
          {displayDate(primary.after, timeZone)}
        </p>
        {!!dependents.length && (
          <>
            <strong>This also moves</strong>
            <ul className={s.moves}>
              {dependents.map(({ target: item, before, after }) => (
                <li key={item.kind === "acceptance" ? item.kind : item.key}>
                  {targetLabel(item, labels)} · {displayDate(before, timeZone)}{" "}
                  → {displayDate(after, timeZone)}
                </li>
              ))}
            </ul>
            <p>
              Choosing Only this date keeps the other affected dates fixed at
              their current values.
            </p>
          </>
        )}
        {stalePreview && (
          <p role="alert">The file changed. Close the editor and reopen it.</p>
        )}
        <div className={s.actions}>
          <button
            type="button"
            onClick={() => apply("update_all")}
            disabled={busy || stalePreview}
          >
            {dependents.length ? "Update all" : "Save date"}
          </button>
          {!!dependents.length && (
            <button
              type="button"
              onClick={() => apply("only_this_date")}
              disabled={busy || stalePreview}
            >
              Only this date
            </button>
          )}
          <button
            type="button"
            disabled={busy || stalePreview}
            onClick={() => setPending(null)}
          >
            Back
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} className={s.editor} onSubmit={preview}>
      <strong>{draft.kind === "extend" ? `Extend ${label}` : label}</strong>
      {draft.kind === "extend" ? (
        <div className={s.fields}>
          <label>
            Amount
            <input
              type="number"
              min={1}
              max={3650}
              value={amount}
              required
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label>
            Unit
            <select
              value={unit}
              onChange={(event) =>
                setUnit(event.target.value === "hours" ? "hours" : "days")
              }
            >
              <option value="days">Calendar days</option>
              <option value="hours">Elapsed hours</option>
            </select>
          </label>
        </div>
      ) : (
        <div className={s.fields}>
          <label>
            {target.kind === "actual" ? "Actual delivery date" : "Date"}
            <input
              type="date"
              value={day}
              required={target.kind === "actual"}
              onChange={(event) => setDay(event.target.value)}
            />
          </label>
          {timeZone && (
            <label>
              {timeZone.replaceAll("_", " ")} time (optional)
              <input
                type="time"
                step="0.001"
                value={time}
                disabled={!day}
                onChange={(event) => setTime(event.target.value)}
              />
            </label>
          )}
        </div>
      )}
      {stale && (
        <p role="alert">The file changed. Close the editor and reopen it.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className={s.actions}>
        <button disabled={busy || requesting || stale || !expectedRevision}>
          {requesting ? "Calculating…" : "Preview changes"}
        </button>
        <button type="button" disabled={requesting} onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
