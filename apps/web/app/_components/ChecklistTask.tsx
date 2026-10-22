"use client";
import { useState } from "react";
import {
  mutate,
  date,
  label,
  type Task,
} from "../(workspace)/workspace/_components/data";
import s from "./checklist.module.css";
type Draft = {
  title: string;
  visibility: string;
  dueDate: string;
  status: string;
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
            {task.visibility === "client"
              ? "Clients & agent"
              : task.visibility === "coordinator"
                ? "Coordinator only"
                : "Agent only"}{" "}
            · {date(task.dueDate)} · {label(task.status)}
          </small>
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
                },
                "PATCH",
              );
              setDraft(null);
            });
          }}
        >
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
            <label>
              Who can see this step
              <select
                aria-label="Step visibility"
                value={draft.visibility}
                onChange={(event) =>
                  setDraft({ ...draft, visibility: event.target.value })
                }
              >
                <option value="agent">Agent only</option>
                <option value="client">Clients & agent</option>
                <option value="coordinator">Coordinator only</option>
              </select>
            </label>
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
            <label>
              Status
              <select
                aria-label="Step status"
                value={draft.status}
                onChange={(event) =>
                  setDraft({ ...draft, status: event.target.value })
                }
              >
                {[
                  "pending",
                  "received",
                  "proposed",
                  "completed",
                  "signed",
                  "not_applicable",
                ].map((value) => (
                  <option key={value} value={value}>
                    {label(value)}
                  </option>
                ))}
              </select>
            </label>
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
        </form>
      )}
    </div>
  );
}
