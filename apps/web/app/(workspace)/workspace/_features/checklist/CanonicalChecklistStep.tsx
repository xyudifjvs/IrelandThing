import { useRef, useState, type ReactNode } from "react";
import { mutate } from "../../_components/data";
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
import { dueDateParts, dueStatus } from "./checklist-presentation";
import {
  checklistMoney,
  checklistWording,
  scheduledAppointment,
} from "../../../../../../../packages/matters/src/checklist/display";

export function CanonicalChecklistStep({
  task,
  matterId,
  timeZone,
  labels,
  busy,
  readOnly,
  act,
  editDate,
  moveUp,
  moveDown,
  onComplete,
  afterStep,
  now,
}: {
  task: ChecklistTaskRecord;
  matterId: string;
  timeZone: string | null;
  labels: Record<string, string>;
  busy: boolean;
  readOnly: boolean;
  act: TransactionAction;
  editDate: (draft: DateEditorDraft) => void;
  moveUp?: () => Promise<unknown>;
  moveDown?: () => Promise<unknown>;
  onComplete?: (stepKey: string) => void;
  afterStep?: ReactNode;
  now: Date;
}) {
  const [editor, setEditor] = useState<StepEditorKind | null>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  function closeMenu(action: () => void) {
    if (menu.current) {
      menu.current.open = false;
      menu.current.querySelector("summary")?.focus();
    }
    action();
  }
  function openEditor(kind: StepEditorKind) {
    closeMenu(() => setEditor(kind));
  }
  const done = isComplete(task);
  const skipped = task.status === "not_applicable";
  const due = dueDateValue(task);
  const actual = actualDateValue(task);
  const dateParts = dueDateParts(task.dueDate);
  const statusLabel = dueStatus(task.dueDate, done, now, timeZone);
  const dueTime =
    due?.instant && timeZone
      ? new Intl.DateTimeFormat("en-US", {
          timeZone,
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        }).format(new Date(due.instant))
      : "";
  const note = task.note ?? task.details?.note;
  const scheduledAt = task.appointmentAt ?? task.details?.appointmentAt;
  const isHoaDelivery = task.stepKey === "condo_hoa_docs_provided";
  const mayEdit = !readOnly && !busy && !!task.revision;
  const rule = ruleText(task.dateRule, labels);
  const moneyStep = [
    "earnest_money_due",
    "home_warranty",
    "home_warranty_ordered",
  ].includes(task.stepKey);
  const money = checklistMoney(
    task.details && Object.hasOwn(task.details, "amountCents")
      ? task.details.amountCents
      : (task.details?.earnestMoneyCents ?? task.details?.homeWarrantyCents),
  );
  const company =
    task.details?.holder ??
    task.details?.company ??
    task.details?.earnestMoneyHolder ??
    task.details?.homeWarrantyCompany;
  const moneyLine = [
    money,
    company
      ? `${task.stepKey === "earnest_money_due" ? "held by " : ""}${company}`
      : "",
    rule,
  ]
    .filter(Boolean)
    .join(" · ");
  const wording = checklistWording(task, task.stepKey);
  const shownWording =
    task.details?.dateWording ||
    ["closing", "final_walkthrough", "possession"].includes(task.stepKey)
      ? wording
      : "";

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
        {!skipped && task.dateCapable && (
          <div className={s.dateSlot}>
            {(() => {
              const contents = dateParts ? (
                <>
                  <span className={s.dateMonth}>{dateParts.month}</span>
                  <span className={s.dateDay}>{dateParts.day}</span>
                  <span className={s.dateWeekday}>{dateParts.weekday}</span>
                </>
              ) : (
                <span className={s.emptyDate}>
                  {done || readOnly ? "No due date" : "Add due date"}
                </span>
              );
              const label = `${task.title}: ${due ? `${displayDate(due, timeZone)} (${due.date})` : "No due date"}`;
              return done || readOnly ? (
                <span className={s.dateBox} aria-label={label} title={label}>
                  {contents}
                </span>
              ) : (
                <button
                  className={s.dateBox}
                  type="button"
                  disabled={!mayEdit}
                  aria-label={`Edit due date for ${task.title}`}
                  title={label}
                  onClick={() =>
                    editDate({
                      kind: "set",
                      target: { kind: "step", key: task.stepKey },
                      value: due,
                    })
                  }
                >
                  {contents}
                </button>
              );
            })()}
          </div>
        )}
        <div className={s.stepBody}>
          <div className={s.titleLine}>
            <strong className={s.stepTitle}>{task.title}</strong>
            {!skipped && task.dateCapable && shownWording && (
              <span>{shownWording}</span>
            )}
            {skipped && <span className={s.tag}>Not needed</span>}
          </div>
          {!skipped && moneyStep && moneyLine && (
            <p className={s.subline}>{moneyLine}</p>
          )}
          {!skipped && dueTime && <p className={s.subline}>Due at {dueTime}</p>}
          {!skipped && !moneyStep && rule && (
            <p className={s.subline}>{rule}</p>
          )}
          {!skipped && note && <p className={s.note}>{note}</p>}
          {!skipped && task.details?.scheduled && (
            <p className={s.subline}>
              Scheduled ·{" "}
              {scheduledAt
                ? scheduledAppointment(
                    scheduledAt,
                    timeZone || "America/New_York",
                  )
                : "Details to come"}
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
          {skipped && !readOnly && (
            <button
              className={s.textButton}
              type="button"
              disabled={!mayEdit}
              onClick={() => updateStatus("pending")}
            >
              Needed after all
            </button>
          )}
          {!skipped && statusLabel && (
            <span className={s.duePill}>{statusLabel}</span>
          )}
          {!readOnly && (
            <details
              ref={menu}
              className={s.menu}
              onKeyDown={(event) => {
                if (event.key === "Escape") closeMenu(() => {});
              }}
            >
              <summary aria-label={`Actions for ${task.title}`}>⋯</summary>
              <div className={s.menuActions}>
                <button
                  type="button"
                  disabled={!mayEdit}
                  onClick={() => openEditor("title")}
                >
                  Edit step
                </button>
                {!skipped && task.dateCapable && (
                  <button
                    type="button"
                    disabled={!mayEdit}
                    onClick={() => openEditor("wording")}
                  >
                    {task.details?.dateWording
                      ? "Edit date display text"
                      : "Add date display text"}
                  </button>
                )}
                {!skipped && (
                  <button
                    type="button"
                    disabled={!mayEdit}
                    onClick={() => openEditor("note")}
                  >
                    {note ? "Edit note" : "Add note"}
                  </button>
                )}
                {!skipped && moneyStep && (
                  <button
                    type="button"
                    disabled={!mayEdit}
                    onClick={() => openEditor("money")}
                  >
                    {money || company ? "Edit" : "Add"}{" "}
                    {task.stepKey === "earnest_money_due"
                      ? "amount and holder"
                      : "warranty amount and company"}
                  </button>
                )}
                {!skipped && (
                  <button
                    type="button"
                    disabled={!mayEdit}
                    onClick={() =>
                      closeMenu(() => updateStatus("not_applicable"))
                    }
                  >
                    Mark not needed
                  </button>
                )}
                {!done && !skipped && task.dateCapable && due && (
                  <button
                    type="button"
                    disabled={!mayEdit}
                    onClick={() =>
                      closeMenu(() =>
                        editDate({ kind: "extend", key: task.stepKey }),
                      )
                    }
                  >
                    Extend
                  </button>
                )}
                {moveUp && (
                  <button
                    type="button"
                    disabled={!mayEdit}
                    onClick={() => closeMenu(() => void act(task.id, moveUp))}
                  >
                    Move up
                  </button>
                )}
                {moveDown && (
                  <button
                    type="button"
                    disabled={!mayEdit}
                    onClick={() => closeMenu(() => void act(task.id, moveDown))}
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
          timeZone={timeZone}
          busy={busy}
          act={act}
          onClose={() => setEditor(null)}
        />
      )}
      {afterStep}
    </li>
  );
}
