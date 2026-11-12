import Link from "next/link";
import ChecklistShare from "../../../../_components/ChecklistShare";
import { label } from "../../_components/data";
import { PeopleOnFilePanel } from "../people/PeopleOnFilePanel";
import { PrivateTodoPanel } from "../private-notes/PrivateTodoPanel";
import { legacyPeople, type TransactionFile } from "./file-model";
import styles from "./file-workspace.module.css";

export function FileSidebar({
  file,
  readOnly,
  refresh,
}: {
  file: TransactionFile;
  readOnly: boolean;
  refresh: () => Promise<void>;
}) {
  const saved = legacyPeople(file);
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
            ({ status }) => status !== "not_applicable",
          )}
        />
        <Link href={rosterUrl} className={styles.textButton}>
          Manage agent access
        </Link>
      </details>
      <PrivateTodoPanel matterId={file.id} allowAdding={!readOnly} />
    </aside>
  );
}
