"use client";

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import ChecklistTask from "../../../../_components/ChecklistTask";
import cs from "../../../../_components/checklist.module.css";
import {
  agentCanSee,
  clientCanSee,
  audienceVisibility,
} from "../../../../_lib/checklist-audiences";
import {
  mutate,
  label,
  date,
  type Matter,
  type Task,
} from "../../_components/data";
import s from "../../_components/workspace.module.css";
import {
  BusyForm,
  type TransactionAction,
} from "../../_components/transaction-controls";
import { CanonicalChecklistPanel } from "./CanonicalChecklistPanel";
import { hasVersionedChecklist } from "./canonical-checklist-model";

export function useChecklistDraft() {
  const [task, setTask] = useState("");
  const [clientRequest, setClientRequest] = useState(false);
  const [taskVisibility, setTaskVisibility] = useState("agent");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskNoteValue, setTaskNoteValue] = useState("");
  const [taskAppointmentValue, setTaskAppointmentValue] = useState("");
  return {
    task,
    setTask,
    clientRequest,
    setClientRequest,
    taskVisibility,
    setTaskVisibility,
    taskDueDate,
    setTaskDueDate,
    taskNoteValue,
    setTaskNoteValue,
    taskAppointmentValue,
    setTaskAppointmentValue,
  };
}

export function TransactionChecklistPanel({
  matter: m,
  id,
  busy,
  act,
  draft,
  standaloneDates,
  includeTask,
}: {
  matter: Matter;
  id: string;
  busy: string;
  act: TransactionAction;
  draft: ReturnType<typeof useChecklistDraft>;
  standaloneDates?: ReactNode;
  includeTask?: (task: Task) => boolean;
}) {
  if (hasVersionedChecklist(m))
    return <CanonicalChecklistPanel matter={m} busy={!!busy} act={act} />;
  const {
    task,
    setTask,
    clientRequest,
    setClientRequest,
    taskVisibility,
    setTaskVisibility,
    taskDueDate,
    setTaskDueDate,
    taskNoteValue,
    setTaskNoteValue,
    taskAppointmentValue,
    setTaskAppointmentValue,
  } = draft;
  const tasks = m.tasks || [];
  const sharedTasks = tasks.filter(
    (t) => t.visibility !== "coordinator" && (includeTask?.(t) ?? true),
  );
  async function moveTask(taskId: string, targetId: string) {
    const taskIds = tasks.map((t) => t.id);
    const from = taskIds.indexOf(taskId),
      to = taskIds.indexOf(targetId);
    taskIds.splice(from, 1);
    taskIds.splice(to, 0, taskId);
    await mutate(`/api/v1/matters/${id}/tasks/reorder`, {
      taskIds,
      expectedRevision: m.revision,
    });
  }
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2>Transaction checklist</h2>
          <p>Update checklist items and choose who can see them.</p>
        </div>
      </div>
      <div className={s.sectionBody}>
        {sharedTasks.length
          ? sharedTasks.map((t, index) => (
              <ChecklistTask
                key={t.id}
                task={t}
                matterId={id}
                busy={!!busy}
                act={act}
                moveUp={
                  index > 0
                    ? () => moveTask(t.id, sharedTasks[index - 1].id)
                    : undefined
                }
                moveDown={
                  index < sharedTasks.length - 1
                    ? () => moveTask(t.id, sharedTasks[index + 1].id)
                    : undefined
                }
              />
            ))
          : !standaloneDates && (
              <div className={s.empty}>
                No checklist steps yet. Add the first step below.
              </div>
            )}
        {standaloneDates}
        <BusyForm
          busy={!!busy}
          className={cs.addForm}
          onSubmit={(e) => {
            e.preventDefault();
            void act("task", async () => {
              await mutate(`/api/v1/matters/${id}/tasks`, {
                title: task,
                visibility: taskVisibility,
                dueDate: taskDueDate || undefined,
                kind: clientRequest ? "client_request" : "custom",
                note: taskNoteValue,
                appointmentAt: taskAppointmentValue
                  ? new Date(taskAppointmentValue).toISOString()
                  : null,
              });
              setTask("");
              setTaskDueDate("");
              setClientRequest(false);
              setTaskNoteValue("");
              setTaskAppointmentValue("");
            });
          }}
        >
          <label>
            New checklist step
            <input
              className={s.input}
              aria-label="New checklist step"
              placeholder="Add a checklist step…"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              required
              maxLength={300}
            />
          </label>
          <div className={cs.editorFields}>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend>Visible to</legend>
              <label>
                <input
                  type="checkbox"
                  aria-label="New step visible to agent"
                  checked={agentCanSee(taskVisibility)}
                  onChange={(e) =>
                    setTaskVisibility(
                      audienceVisibility(
                        e.target.checked,
                        clientCanSee(taskVisibility),
                      ),
                    )
                  }
                />{" "}
                Agent
              </label>
              <label>
                <input
                  type="checkbox"
                  aria-label="New step visible to client"
                  checked={clientCanSee(taskVisibility)}
                  onChange={(e) => {
                    setTaskVisibility(
                      audienceVisibility(
                        agentCanSee(taskVisibility),
                        e.target.checked,
                      ),
                    );
                    if (!e.target.checked) setClientRequest(false);
                  }}
                />{" "}
                Client link
              </label>
            </fieldset>
            <label>
              Due date (optional)
              <input
                className={s.input}
                aria-label="New step due date"
                type="date"
                value={taskDueDate}
                onChange={(e) => setTaskDueDate(e.target.value)}
              />
            </label>
          </div>
          <label>
            <input
              type="checkbox"
              checked={clientRequest}
              onChange={(e) => {
                setClientRequest(e.target.checked);
                if (e.target.checked)
                  setTaskVisibility(
                    audienceVisibility(agentCanSee(taskVisibility), true),
                  );
              }}
            />{" "}
            Display as read-only client instructions
          </label>
          <label>
            Short note
            <textarea
              aria-label="New step note"
              className={s.input}
              maxLength={1000}
              value={taskNoteValue}
              onChange={(e) => setTaskNoteValue(e.target.value)}
            />
          </label>
          <label>
            Appointment (your local time)
            <input
              className={s.input}
              aria-label="New step appointment"
              type="datetime-local"
              value={taskAppointmentValue}
              onChange={(e) => setTaskAppointmentValue(e.target.value)}
            />
          </label>
          <button className={s.buttonSmall} disabled={!!busy || !task.trim()}>
            <Plus size={13} />
            Add
          </button>
        </BusyForm>
      </div>
    </section>
  );
}
