import { useState, type FormEvent } from "react";
import { mutate } from "../../_components/data";
import type { TransactionAction } from "../../_components/transaction-controls";
import { CanonicalChecklistStep } from "./CanonicalChecklistStep";
import {
  ChecklistDateEditor,
  type DateEditorDraft,
} from "./ChecklistDateEditor";
import {
  displayDate,
  isChecklistTask,
  isComplete,
  type ChecklistMatter,
} from "./canonical-checklist-model";
import s from "./canonical-checklist.module.css";

export function CanonicalChecklistPanel({
  matter,
  busy,
  act,
}: {
  matter: ChecklistMatter;
  busy: boolean;
  act: TransactionAction;
}) {
  const [hideCompleted, setHideCompleted] = useState(false);
  const [dateDraft, setDateDraft] = useState<DateEditorDraft | null>(null);
  const [adding, setAdding] = useState(false);
  const [dateCapable, setDateCapable] = useState(true);
  const tasks = (matter.tasks ?? []).filter(isChecklistTask);
  const labels = Object.fromEntries(
    tasks.map(({ stepKey, title }) => [stepKey, title]),
  );
  const skipped = tasks.filter(
    (task) => task.status === "not_applicable",
  ).length;
  const complete = tasks.filter(isComplete).length;
  const readOnly = ["closed", "terminated", "archived"].includes(
    matter.stage ?? "",
  );
  const acceptance = matter.acceptanceDate
    ? { date: matter.acceptanceDate, instant: matter.acceptanceAt }
    : null;
  const base = `/api/v1/matters/${matter.id}/tasks`;

  function addStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void act("checklist-add", async () => {
      await mutate(base, {
        title: String(data.get("title") || "").trim(),
        dateCapable,
        dueDate: dateCapable ? String(data.get("dueDate") || "") || null : null,
      });
      setAdding(false);
      setDateCapable(true);
    });
  }

  function moveTask(from: number, to: number) {
    const taskIds = tasks.map((task) => task.id);
    const [id] = taskIds.splice(from, 1);
    taskIds.splice(to, 0, id);
    return mutate(`${base}/reorder`, {
      expectedRevision: matter.revision,
      taskIds,
    });
  }

  return (
    <section className={s.panel} aria-labelledby="canonical-checklist-heading">
      <div className={s.heading}>
        <div>
          <h2 id="canonical-checklist-heading">Transaction checklist</h2>
          <p>
            {complete} of {tasks.length - skipped} done
            {skipped ? ` · ${skipped} not needed` : ""}
          </p>
        </div>
        <label className={s.check}>
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(event) => setHideCompleted(event.target.checked)}
          />
          Hide completed
        </label>
      </div>
      <div className={s.acceptance}>
        <span>Acceptance date</span>
        {readOnly ? (
          <span>{displayDate(acceptance, matter.deadlineTimeZone)}</span>
        ) : (
          <button
            className={s.dateButton}
            type="button"
            disabled={busy}
            aria-label="Edit acceptance date"
            onClick={() =>
              setDateDraft({
                kind: "set",
                target: { kind: "acceptance" },
                value: acceptance,
              })
            }
          >
            {acceptance
              ? displayDate(acceptance, matter.deadlineTimeZone)
              : "Add date"}
          </button>
        )}
      </div>
      {dateDraft && !readOnly && (
        <ChecklistDateEditor
          key={JSON.stringify(dateDraft)}
          draft={dateDraft}
          matterId={matter.id}
          revision={matter.revision}
          timeZone={matter.deadlineTimeZone}
          labels={labels}
          act={act}
          busy={busy}
          onClose={() => setDateDraft(null)}
        />
      )}
      <ol className={s.steps}>
        {tasks.map((task, index) => {
          if (
            hideCompleted &&
            (isComplete(task) || task.status === "not_applicable")
          )
            return null;
          return (
            <CanonicalChecklistStep
              key={task.id}
              task={task}
              matterId={matter.id}
              timeZone={matter.deadlineTimeZone}
              labels={labels}
              busy={busy}
              readOnly={readOnly}
              act={act}
              editDate={setDateDraft}
              moveUp={index ? () => moveTask(index, index - 1) : undefined}
              moveDown={
                index < tasks.length - 1
                  ? () => moveTask(index, index + 1)
                  : undefined
              }
            />
          );
        })}
      </ol>
      {!readOnly &&
        (adding ? (
          <form className={s.editor} onSubmit={addStep}>
            <label>
              Step title
              <input name="title" required maxLength={300} />
            </label>
            <label className={s.check}>
              <input
                type="checkbox"
                checked={dateCapable}
                onChange={(event) => setDateCapable(event.target.checked)}
              />
              This step can have a due date
            </label>
            {dateCapable && (
              <label>
                Due date (optional)
                <input name="dueDate" type="date" />
              </label>
            )}
            <div className={s.actions}>
              <button disabled={busy}>Add step</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            className={s.textButton}
            type="button"
            disabled={busy}
            onClick={() => setAdding(true)}
          >
            + Add step
          </button>
        ))}
    </section>
  );
}
