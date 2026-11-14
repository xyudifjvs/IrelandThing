import { useState, type FormEvent } from "react";
import {
  localWallTime,
  wallTimeInstants,
} from "../../../../../../../packages/matters/src/date-graph/calendar";
import { mutate } from "../../_components/data";
import type { TransactionAction } from "../../_components/transaction-controls";
import type { ChecklistTaskRecord } from "./canonical-checklist-model";
import s from "./canonical-checklist.module.css";

export type StepEditorKind = "title" | "note" | "appointment";

export function ChecklistStepEditor({
  kind,
  task,
  matterId,
  busy,
  act,
  onClose,
}: {
  kind: StepEditorKind;
  task: ChecklistTaskRecord;
  matterId: string;
  busy: boolean;
  act: TransactionAction;
  onClose: () => void;
}) {
  const [expectedRevision] = useState(task.revision);
  const stale = expectedRevision !== task.revision;
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const savedAppointment = task.appointmentAt ?? task.details?.appointmentAt;
  const [wallTime, setWallTime] = useState(() =>
    kind === "appointment" && savedAppointment
      ? localWallTime(savedAppointment, timeZone) ?? ""
      : "",
  );
  const [occurrence, setOccurrence] = useState(() =>
    savedAppointment && wallTime ? new Date(savedAppointment).toISOString() : "",
  );
  const choices = wallTime ? wallTimeInstants(wallTime, timeZone) : [];
  const invalidWallTime = !!wallTime && !choices.length;
  const repeatedWallTime = choices.length > 1;
  const appointmentAt = repeatedWallTime
    ? choices.find((instant) => instant === occurrence)
    : choices[0];
  const offsetName = (instant: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(new Date(instant))
      .find((part) => part.type === "timeZoneName")?.value;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (stale || (kind === "appointment" && wallTime && !appointmentAt)) return;
    const patch =
      kind === "title"
        ? { title: String(values.get("title") || "").trim() }
        : kind === "note"
          ? {
              note: String(values.get("note") || ""),
              showNoteToAgent: values.has("showNoteToAgent"),
            }
          : {
              appointmentAt: appointmentAt ?? null,
              appointmentPlace: String(values.get("place") || "").trim(),
            };
    void act(task.id, async () => {
      await mutate(
        `/api/v1/matters/${matterId}/tasks/${task.id}`,
        { expectedRevision, ...patch },
        "PATCH",
      );
      onClose();
    });
  }

  return (
    <form className={s.editor} onSubmit={submit}>
      {kind === "title" && (
        <label>
          Step title
          <input
            name="title"
            defaultValue={task.title}
            required
            maxLength={300}
          />
        </label>
      )}
      {kind === "note" && (
        <>
          <label>
            Step note
            <textarea
              name="note"
              defaultValue={task.note ?? task.details?.note ?? ""}
              maxLength={1000}
            />
          </label>
          <label className={s.check}>
            <input
              type="checkbox"
              name="showNoteToAgent"
              defaultChecked={task.details?.showNoteToAgent ?? false}
            />
            Show to agent
          </label>
        </>
      )}
      {kind === "appointment" && (
        <div className={s.fields}>
          <label>
            Appointment (your local time)
            <input
              name="appointment"
              type="datetime-local"
              step="0.001"
              value={wallTime}
              aria-invalid={invalidWallTime}
              onChange={(event) => {
                setWallTime(event.target.value);
                setOccurrence("");
              }}
            />
          </label>
          {invalidWallTime && (
            <p role="alert">
              This time does not occur in {timeZone}. Choose another time.
            </p>
          )}
          {repeatedWallTime && (
            <label>
              This local time occurs twice. Choose which occurrence.
              <select
                required
                value={appointmentAt ?? ""}
                onChange={(event) => setOccurrence(event.target.value)}
              >
                <option value="">Choose an occurrence</option>
                {choices.map((instant, index) => (
                  <option key={instant} value={instant}>
                    {index === 0 ? "First occurrence" : "Second occurrence"}{" "}
                    ({offsetName(instant)})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Place
            <input
              name="place"
              defaultValue={task.details?.appointmentPlace ?? ""}
              maxLength={300}
            />
          </label>
        </div>
      )}
      {stale && (
        <p role="alert">
          This step changed. Close the editor and reopen it to use the latest
          details.
        </p>
      )}
      <div className={s.actions}>
        <button disabled={busy || stale || !expectedRevision}>Save</button>
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
