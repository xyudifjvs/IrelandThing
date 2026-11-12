import { useState, type FormEvent } from "react";
import { localAppointment } from "../../../../_lib/checklist-audiences";
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
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const appointment = String(values.get("appointment") || "");
    const patch =
      kind === "title"
        ? { title: String(values.get("title") || "").trim() }
        : kind === "note"
          ? {
              note: String(values.get("note") || ""),
              showNoteToAgent: values.has("showNoteToAgent"),
            }
          : {
              appointmentAt: appointment
                ? new Date(appointment).toISOString()
                : null,
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
              defaultValue={localAppointment(
                task.appointmentAt ?? task.details?.appointmentAt,
              )}
            />
          </label>
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
