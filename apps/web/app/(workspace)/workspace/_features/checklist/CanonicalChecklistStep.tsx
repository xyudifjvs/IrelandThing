import { useState, type ReactNode } from "react";
import { appointment, mutate } from "../../_components/data";
import type { TransactionAction } from "../../_components/transaction-controls";
import type { DateEditorDraft } from "./ChecklistDateEditor";
import {
  ChecklistStepEditor,
  type StepEditorKind,
} from "./ChecklistStepEditor";
import {
  actualDateValue,
  displayDate,
  dueDateValue,
  isComplete,
  ruleText,
  type ChecklistTaskRecord,
} from "./canonical-checklist-model";
import s from "./canonical-checklist.module.css";

export function CanonicalChecklistStep({
  task,
  matterId,
  timeZone,
  labels,
  busy,
  readOnly,
  act,
  editDate,
  editRemedies,
  moveUp,
  moveDown,
  onComplete,
  afterStep,
}: {
  task: ChecklistTaskRecord;
  matterId: string;
  timeZone: string | null;
  labels: Record<string, string>;
  busy: boolean;
  readOnly: boolean;
  act: TransactionAction;
  editDate: (draft: DateEditorDraft) => void;
  editRemedies?: () => void;
  moveUp?: () => Promise<unknown>;
  moveDown?: () => Promise<unknown>;
  onComplete?: (stepKey: string) => void;
  afterStep?: ReactNode;
}) {
  const [editor, setEditor] = useState<StepEditorKind | null>(null);
  const done = isComplete(task);
  const skipped = task.status === "not_applicable";
  const due = dueDateValue(task);
  const actual = actualDateValue(task);
  const note = task.note ?? task.details?.note;
  const scheduledAt = task.appointmentAt ?? task.details?.appointmentAt;
  const isHoaDelivery = task.stepKey === "condo_hoa_docs_provided";
  const mayEdit = !readOnly && !busy && !!task.revision;
  const rule = ruleText(task.dateRule, labels);

  function updateStatus(status: string) {
    void act(task.id, async () => {
      await mutate(
        `/api/v1/matters/${matterId}/tasks/${task.id}`,
        { expectedRevision: task.revision, status },
        "PATCH",
      );
      if (status === "completed" && !done) onComplete?.(task.stepKey);
    });
  }

  function openActual() {
    editDate({
      kind: "set",
      target: { kind: "actual", key: task.stepKey },
      value: actual,
    });
  }

  return (
    <li
      className={s.step}
      data-status={skipped ? "not-needed" : done ? "complete" : "open"}
    >
      <div className={s.stepLine}>
        {skipped ? (
          <span className={s.skippedCheck} aria-hidden="true" />
        ) : (
          <input
            type="checkbox"
            aria-label={`Mark ${task.title} complete`}
            checked={done}
            disabled={!mayEdit}
            onChange={(event) => {
              if (event.target.checked && isHoaDelivery && !actual)
                openActual();
              else updateStatus(event.target.checked ? "completed" : "pending");
            }}
          />
        )}
        <div className={s.stepBody}>
          <strong className={s.stepTitle}>{task.title}</strong>
          {skipped && <span className={s.tag}>Not needed</span>}
          {!skipped && rule && <p className={s.subline}>{rule}</p>}
          {!skipped && note && <p className={s.note}>{note}</p>}
          {!readOnly && !skipped && (
            <button
              className={s.textButton}
              type="button"
              disabled={!mayEdit}
              onClick={() => setEditor("note")}
            >
              {note ? "Edit note" : "+ Add note"}
            </button>
          )}
          {!skipped && task.details?.scheduled && (
            <p className={s.subline}>
              Scheduled ·{" "}
              {scheduledAt ? appointment(scheduledAt) : "Details to come"}
              {task.details.appointmentPlace &&
                ` · ${task.details.appointmentPlace}`}
              {!readOnly && (
                <button
                  className={s.textButton}
                  type="button"
                  disabled={!mayEdit}
                  onClick={() => setEditor("appointment")}
                >
                  {scheduledAt ? "Edit appointment" : "Schedule"}
                </button>
              )}
            </p>
          )}
          {editRemedies && (
            <button
              className={s.textButton}
              type="button"
              disabled={!mayEdit}
              onClick={editRemedies}
            >
              Edit Remedies request deadline
            </button>
          )}
          {!skipped && isHoaDelivery && actual && (
            <p className={s.subline}>
              Delivered · {displayDate(actual, timeZone)}
              {!readOnly && (
                <button
                  className={s.textButton}
                  type="button"
                  disabled={!mayEdit}
                  onClick={openActual}
                >
                  Edit delivery date
                </button>
              )}
            </p>
          )}
        </div>
        <div className={s.stepActions}>
          {skipped && !readOnly ? (
            <button
              className={s.textButton}
              type="button"
              disabled={!mayEdit}
              onClick={() => updateStatus("pending")}
            >
              Needed after all
            </button>
          ) : (
            !skipped &&
            task.dateCapable &&
            (done || readOnly ? (
              due && <span>{displayDate(due, timeZone)}</span>
            ) : (
              <button
                className={s.dateButton}
                type="button"
                disabled={!mayEdit}
                aria-label={`Edit due date for ${task.title}`}
                onClick={() =>
                  editDate({
                    kind: "set",
                    target: { kind: "step", key: task.stepKey },
                    value: due,
                  })
                }
              >
                {due ? displayDate(due, timeZone) : "Add due date"}
              </button>
            ))
          )}
          {!readOnly && (
            <details className={s.menu}>
              <summary aria-label={`Actions for ${task.title}`}>⋯</summary>
              <div className={s.menuActions}>
                <button
                  type="button"
                  disabled={!mayEdit}
                  onClick={() => setEditor("title")}
                >
                  Edit step
                </button>
                {!skipped && (
                  <button
                    type="button"
                    disabled={!mayEdit}
                    onClick={() => updateStatus("not_applicable")}
                  >
                    Mark not needed
                  </button>
                )}
                {!done && !skipped && task.dateCapable && due && (
                  <button
                    type="button"
                    disabled={!mayEdit}
                    onClick={() =>
                      editDate({ kind: "extend", key: task.stepKey })
                    }
                  >
                    Extend
                  </button>
                )}
                {moveUp && (
                  <button
                    type="button"
                    disabled={!mayEdit}
                    onClick={() => void act(task.id, moveUp)}
                  >
                    Move up
                  </button>
                )}
                {moveDown && (
                  <button
                    type="button"
                    disabled={!mayEdit}
                    onClick={() => void act(task.id, moveDown)}
                  >
                    Move down
                  </button>
                )}
              </div>
            </details>
          )}
        </div>
      </div>
      {editor && !readOnly && (
        <ChecklistStepEditor
          key={editor}
          kind={editor}
          task={task}
          matterId={matterId}
          busy={busy}
          act={act}
          onClose={() => setEditor(null)}
        />
      )}
      {afterStep}
    </li>
  );
}
