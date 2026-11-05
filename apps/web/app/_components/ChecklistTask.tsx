"use client";
import { useState } from "react";
import {
  mutate,
  date,
  appointment,
  label,
  type Task,
} from "../(workspace)/workspace/_components/data";
import s from "./checklist.module.css";
import {agentCanSee,clientCanSee,audienceVisibility,localAppointment} from "../_lib/checklist-audiences";
type Draft = {
  title: string;
  visibility: string;
  dueDate: string;
  status: string;
  note: string;
  appointmentAt: string;
  revision?: number;
};
export default function ChecklistTask({
  task,
  matterId,
  busy,
  act,
  moveUp,
  moveDown,
}: {
  task: Task;
  matterId: string;
  busy: boolean;
  act: (key: string, fn: () => Promise<unknown>) => Promise<void>;
  moveUp?: () => Promise<unknown>;
  moveDown?: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const path = `/api/v1/matters/${matterId}/tasks/${task.id}`;
  return (
    <div className={s.editor}>
      <div className={s.editorTop}>
        <input
          type="checkbox"
          aria-label={`Mark ${task.title} complete`}
          checked={["completed", "signed", "not_applicable"].includes(
            task.status,
          )}
          disabled={busy}
          onChange={(event) =>
            void act(task.id, () =>
              mutate(
                path,
                {
                  expectedRevision: task.revision,
                  status: event.target.checked ? "completed" : "pending",
                },
                "PATCH",
              ),
            )
          }
        />
        <div className={s.editorText}>
          <strong>{task.title}</strong>
          <small>
            {task.visibility === "client_only" ? "Client only" : task.visibility === "client"
              ? "Clients & agent"
              : task.visibility === "coordinator"
                ? "Coordinator only"
                : "Agent only"}{" "}
            · {date(task.dueDate)} · {label(task.status)}
          </small>
          {task.note && <p>{task.note}</p>}
          {task.appointmentAt && <small>{appointment(task.appointmentAt)}</small>}
        </div>
      </div>
      <div className={s.editorActions}>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            setDraft({
              title: task.title,
              visibility: task.visibility || "agent",
              dueDate: task.dueDate?.slice(0, 10) || "",
              status: task.status,
              note:task.note||"",
              appointmentAt:localAppointment(task.appointmentAt),
              revision: task.revision,
            })
          }
        >
          Edit step
        </button>
        <button
          type="button"
          disabled={busy || !moveUp}
          aria-label={`Move ${task.title} up`}
          onClick={() => moveUp && void act(task.id, moveUp)}
        >
          ↑ Move up
        </button>
        <button
          type="button"
          disabled={busy || !moveDown}
          aria-label={`Move ${task.title} down`}
          onClick={() => moveDown && void act(task.id, moveDown)}
        >
          ↓ Move down
        </button>
      </div>
      {draft && (
        <form
          className={s.editorForm}
          onSubmit={(event) => {
            event.preventDefault();
            void act(task.id, async () => {
              await mutate(
                path,
                {
                  expectedRevision: draft.revision,
                  title: draft.title.trim(),
                  visibility: draft.visibility,
                  dueDate: draft.dueDate || null,
                  status: draft.status,
                  note:draft.note,
                  appointmentAt:draft.appointmentAt?new Date(draft.appointmentAt).toISOString():null,
                },
                "PATCH",
              );
              setDraft(null);
            });
          }}
        >
          <fieldset disabled={busy} style={{display:"contents"}}>
          {draft.revision !== task.revision && (
            <p className={s.error}>
              This step changed while you were editing. Cancel and reopen to use
              the latest version.
            </p>
          )}
          <label>
            Step title
            <input
              aria-label="Step title"
              value={draft.title}
              required
              maxLength={300}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
            />
          </label>
          <div className={s.editorFields}>
            <fieldset style={{border:0,padding:0,margin:0}}><legend>Visible to</legend><label><input type="checkbox" aria-label="Visible to agent" checked={agentCanSee(draft.visibility)} onChange={e=>setDraft({...draft,visibility:audienceVisibility(e.target.checked,clientCanSee(draft.visibility))})}/> Agent</label><label><input type="checkbox" aria-label="Visible to client" checked={clientCanSee(draft.visibility)} onChange={e=>setDraft({...draft,visibility:audienceVisibility(agentCanSee(draft.visibility),e.target.checked)})}/> Client link</label></fieldset>
            <label>
              Due date
              <input
                aria-label="Step due date"
                type="date"
                value={draft.dueDate}
                onChange={(event) =>
                  setDraft({ ...draft, dueDate: event.target.value })
                }
              />
            </label>
            <label><input type="checkbox" aria-label="Step completed" checked={['completed','signed','not_applicable'].includes(draft.status)} onChange={e=>setDraft({...draft,status:e.target.checked?'completed':'pending'})}/> Completed</label>
            <label>Short note<textarea aria-label="Step note" maxLength={1000} value={draft.note} onChange={e=>setDraft({...draft,note:e.target.value})}/></label>
            <label>Appointment (your local time)<input aria-label="Step appointment" type="datetime-local" value={draft.appointmentAt} onChange={e=>setDraft({...draft,appointmentAt:e.target.value})}/></label>
          </div>
          <p className={s.hint}>
            Client-visible steps appear on the client link. Changing visibility
            takes effect on open client checklists automatically.
          </p>
          <div className={s.actions}>
            <button
              className={s.primary}
              disabled={
                busy || !draft.title.trim() || draft.revision !== task.revision
              }
            >
              Save step
            </button>
            <button
              className={s.secondary}
              type="button"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
            <button
              className={s.secondary}
              type="button"
              disabled={busy}
              onClick={() =>
                void act(task.id, () =>
                  mutate(path, { expectedRevision: task.revision }, "DELETE"),
                )
              }
            >
              Delete step
            </button>
          </div>
          </fieldset>
        </form>
      )}
    </div>
  );
}
