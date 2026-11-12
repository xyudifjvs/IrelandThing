import { useState } from "react";
import { date } from "../../_components/data";
import type { TransactionAction } from "../../_components/transaction-controls";
import s from "../../_components/workspace.module.css";
import { CanonicalChecklistPanel } from "../checklist/CanonicalChecklistPanel";
import {
  hasVersionedChecklist,
  isComplete,
} from "../checklist/canonical-checklist-model";
import {
  TransactionChecklistPanel,
  useChecklistDraft,
} from "../checklist/TransactionChecklistPanel";
import { ChecklistEmailPrompt } from "../emails/ChecklistEmailPrompt";
import { FileActions } from "./FileActions";
import type { TransactionFile } from "./file-model";
import styles from "./file-workspace.module.css";

export function FileChecklist({
  file,
  readOnly,
  busy,
  act,
  actionError,
  openTemplate,
  onDeleted,
}: {
  file: TransactionFile;
  readOnly: boolean;
  busy: string;
  act: TransactionAction;
  actionError?: string;
  openTemplate: (templateId: string) => void;
  onDeleted: () => void;
}) {
  const legacyDraft = useChecklistDraft();
  const [prompt, setPrompt] = useState<{ stepKey: string; attempt: number }>();
  return (
    <>
      {hasVersionedChecklist(file) ? (
        <CanonicalChecklistPanel
          matter={file}
          busy={!!busy}
          act={act}
          onComplete={(stepKey) =>
            setPrompt((old) => ({ stepKey, attempt: (old?.attempt ?? 0) + 1 }))
          }
          renderAfterStep={(task) =>
            !readOnly &&
            isComplete(task) &&
            prompt?.stepKey === task.stepKey ? (
              <ChecklistEmailPrompt
                key={prompt.attempt}
                matterId={file.id}
                stepKey={task.stepKey}
                side={file.side ?? ""}
                packageCode={file.packageCode ?? ""}
                openTemplate={openTemplate}
              />
            ) : null
          }
        />
      ) : readOnly ? (
        <section className={s.section} aria-labelledby="legacy-file-checklist">
          <div className={s.sectionHead}>
            <h2 id="legacy-file-checklist">Transaction checklist</h2>
          </div>
          <div className={s.sectionBody}>
            <ul className={styles.readOnlyChecklist}>
              {(file.tasks ?? [])
                .filter(({ visibility }) => visibility !== "coordinator")
                .map((task) => (
                  <li key={task.id}>
                    <strong>{task.title}</strong>
                    {task.status === "not_applicable" && (
                      <span>Not needed</span>
                    )}
                    {isComplete(task) && <span>Complete</span>}
                    {task.dueDate && <span>{date(task.dueDate)}</span>}
                    {task.note && <p>{task.note}</p>}
                  </li>
                ))}
            </ul>
          </div>
        </section>
      ) : (
        <TransactionChecklistPanel
          matter={file}
          id={file.id}
          busy={busy}
          act={act}
          draft={legacyDraft}
        />
      )}
      <FileActions
        file={file}
        act={act}
        busy={!!busy}
        error={actionError}
        onDeleted={onDeleted}
      />
    </>
  );
}
