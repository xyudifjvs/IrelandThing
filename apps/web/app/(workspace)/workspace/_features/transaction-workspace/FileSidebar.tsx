import Link from "next/link";
import ChecklistShare from "../../../../_components/ChecklistShare";
import ChecklistTask from "../../../../_components/ChecklistTask";
import { date, label } from "../../_components/data";
import type { TransactionAction } from "../../_components/transaction-controls";
import { hasVersionedChecklist } from "../checklist/canonical-checklist-model";
import { PeopleOnFilePanel } from "../people/PeopleOnFilePanel";
import { PrivateTodoPanel } from "../private-notes/PrivateTodoPanel";
import { SavedTask } from "./SavedTask";
import { isLegacyFileTask, legacyPeople, type TransactionFile } from "./file-model";
import styles from "./file-workspace.module.css";

export function FileSidebar({
  file,
  readOnly,
  busy,
  act,
  refresh,
}: {
  file: TransactionFile;
  readOnly: boolean;
  busy: boolean;
  act: TransactionAction;
  refresh: () => Promise<void>;
}) {
  const saved = legacyPeople(file);
  const savedNotes = file.notes ?? [];
  const versioned = hasVersionedChecklist(file);
  const savedTodos = versioned
    ? []
    : (file.tasks ?? [])
        .filter(isLegacyFileTask)
        .filter(({ visibility }) => visibility === "coordinator");
  const rosterUrl = file.agentRosterId
    ? `/workspace/roster?agent=${encodeURIComponent(file.agentRosterId)}`
    : "/workspace/roster";
  return (
    <aside
      className={styles.sidebar}
      aria-label="Transaction people, sharing, and private notes"
    >
      <div>
        <PeopleOnFilePanel
          matterId={file.id}
          people={file.contacts ?? []}
          readOnly={readOnly}
          refresh={refresh}
        />
        {!!saved.length && (
          <details className={styles.savedPeople}>
            <summary>People from the original file</summary>
            <ul>
              {saved.map((person, index) => (
                <li key={index}>
                  {person.name && <strong>{person.name}</strong>}
                  {person.role && <span>{label(person.role)}</span>}
                  {person.email && <span>{person.email}</span>}
                  {person.phone && <span>{person.phone}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <details className={styles.share}>
        <summary>Share</summary>
        <ChecklistShare
          matterId={file.id}
          tasks={(file.tasks ?? []).filter(
            (task) =>
              task.status !== "not_applicable" &&
              (versioned || isLegacyFileTask(task)),
          )}
        />
        <Link href={rosterUrl} className={styles.textButton}>
          Manage agent access
        </Link>
      </details>
      <PrivateTodoPanel
        matterId={file.id}
        allowAdding={!readOnly}
        existingItems={
          savedNotes.length || savedTodos.length ? (
            <div className={styles.savedItems}>
              <h3>From the original file</h3>
              {(savedNotes.length > 0 || readOnly) && (
                <ul className={styles.readOnlyChecklist}>
                  {savedNotes.map((note) => (
                    <li key={note.id}>
                      <p>{note.content || note.text || note.body}</p>
                      <span>{date(note.createdAt)}</span>
                    </li>
                  ))}
                  {readOnly && savedTodos.map((task) => (
                    <SavedTask key={task.id} task={task} />
                  ))}
                </ul>
              )}
              {!readOnly && savedTodos.map((task) => (
                <ChecklistTask
                  key={task.id}
                  task={task}
                  matterId={file.id}
                  busy={busy}
                  act={act}
                />
              ))}
            </div>
          ) : null
        }
      />
    </aside>
  );
}
