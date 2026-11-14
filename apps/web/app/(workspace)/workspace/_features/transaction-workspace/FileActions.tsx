import { useEffect, useRef, useState } from "react";
import { api, mutate } from "../../_components/data";
import type { TransactionAction } from "../../_components/transaction-controls";
import s from "../../_components/workspace.module.css";
import {
  isActiveFile,
  lifecycleDate,
  type TransactionFile,
} from "./file-model";
import styles from "./file-workspace.module.css";

type CloseOutPreview = {
  expectedRevision: number;
  uncheckedItems: { id: string; title: string }[];
};

type Confirmation =
  | ({ action: "close-out" } & CloseOutPreview)
  | { action: "terminate" | "reopen" | "delete"; expectedRevision: number };

const confirmationTitles = {
  "close-out": "Close out this file?",
  terminate: "Terminate this file?",
  reopen: "Reopen this file?",
  delete: "Permanently delete this file?",
};

const confirmationLabels = {
  "close-out": "Confirm close out",
  terminate: "Confirm termination",
  reopen: "Confirm reopen",
  delete: "Permanently delete file",
};

export function FileActions({
  file,
  act,
  busy,
  error,
  onDeleted,
}: {
  file: TransactionFile;
  act: TransactionAction;
  busy: boolean;
  error?: string;
  onDeleted: () => void;
}) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const previewLock = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const base = `/api/v1/matters/${encodeURIComponent(file.id)}`;
  const closeable = file.stage === "under_contract" || file.stage === "closing";
  const closed = file.stage === "closed";
  const terminated = file.stage === "terminated";
  const unavailable = busy || previewing || !file.revision;
  const stale =
    !!confirmation && confirmation.expectedRevision !== file.revision;

  useEffect(() => {
    if (confirmation) heading.current?.focus();
    else trigger.current?.focus();
  }, [confirmation]);

  function dismiss() {
    setConfirmation(null);
  }

  async function begin(
    action: Confirmation["action"],
    button: HTMLButtonElement,
  ) {
    if (!file.revision || unavailable || previewLock.current) return;
    trigger.current = button;
    setPreviewError("");
    if (action !== "close-out") {
      setConfirmation({ action, expectedRevision: file.revision });
      return;
    }
    previewLock.current = true;
    setPreviewing(true);
    try {
      const preview = await api<CloseOutPreview>(`${base}/close-out`);
      setConfirmation({ action, ...preview });
    } catch (failure) {
      setPreviewError(
        failure instanceof Error
          ? failure.message
          : "Could not preview close out.",
      );
    } finally {
      previewLock.current = false;
      setPreviewing(false);
    }
  }

  function confirm(data: FormData) {
    if (!confirmation || stale || busy) return;
    const { action, expectedRevision } = confirmation;
    if (action === "delete" && data.get("confirmation") !== "DELETE") return;
    void act(`lifecycle:${action}`, async () => {
      if (action === "delete") {
        await mutate(
          base,
          { expectedRevision, confirmation: "DELETE" },
          "DELETE",
        );
        onDeleted();
      } else {
        const reason = String(data.get("reason") ?? "").trim();
        await mutate(`${base}/${action}`, {
          expectedRevision,
          ...(action === "terminate" && reason ? { reason } : {}),
        });
        dismiss();
      }
    });
  }

  const closedOn = lifecycleDate(file, "closeOut");
  const terminatedOn = lifecycleDate(file, "termination");
  return (
    <section className={styles.fileActions} aria-label="File actions">
      {closed && (
        <p>
          <strong>{closedOn ? `Closed out ${closedOn}` : "Closed"}</strong>
        </p>
      )}
      {terminated && (
        <p>
          <strong>
            {terminatedOn ? `Terminated ${terminatedOn}` : "Terminated"}
          </strong>
        </p>
      )}
      {file.stage === "archived" && (
        <p>
          <strong>Archived file</strong>
        </p>
      )}
      {previewError && (
        <p className={s.error} role="alert">
          {previewError}
        </p>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <div hidden={!!confirmation}>
        {closeable && (
          <button
            type="button"
            className={s.button}
            disabled={unavailable}
            onClick={(event) => void begin("close-out", event.currentTarget)}
          >
            {previewing ? "Checking open items…" : "Close out this file"}
          </button>
        )}
        {(closed || terminated) && (
          <button
            type="button"
            className={s.button}
            disabled={unavailable}
            onClick={(event) => void begin("reopen", event.currentTarget)}
          >
            Reopen file
          </button>
        )}
        <div className={styles.secondaryActions}>
          {isActiveFile(file) && (
            <button
              type="button"
              className={styles.textButton}
              disabled={unavailable}
              onClick={(event) => void begin("terminate", event.currentTarget)}
            >
              Terminate file
            </button>
          )}
          <button
            type="button"
            className={`${styles.textButton} ${styles.danger}`}
            disabled={unavailable}
            onClick={(event) => void begin("delete", event.currentTarget)}
          >
            Delete file
          </button>
        </div>
      </div>
      {confirmation && (
        <form
          className={styles.confirmation}
          aria-labelledby="file-action-confirmation"
          onSubmit={(event) => {
            event.preventDefault();
            confirm(new FormData(event.currentTarget));
          }}
        >
          <h3 id="file-action-confirmation" ref={heading} tabIndex={-1}>
            {confirmationTitles[confirmation.action]}
          </h3>
          {confirmation.action === "close-out" && (
            <>
              <p>
                The file will move to Closed in Transactions and in the
                authorized portals.{" "}
                {file.business === "hto" &&
                  "Its linked HTO Operations row will also show Closed."}
              </p>
              {!!confirmation.uncheckedItems.length && (
                <div className={s.notice}>
                  <strong>
                    {confirmation.uncheckedItems.length} unchecked{" "}
                    {confirmation.uncheckedItems.length === 1
                      ? "item"
                      : "items"}
                  </strong>
                  <ul>
                    {confirmation.uncheckedItems.map(({ id, title }) => (
                      <li key={id}>{title}</li>
                    ))}
                  </ul>
                  <p>You can still close out this file.</p>
                </div>
              )}
            </>
          )}
          {confirmation.action === "terminate" && (
            <>
              <p>
                The file will move to Terminated.{" "}
                {file.business === "hto"
                  ? "Its linked HTO Operations row will show Fell through."
                  : "The service fee is waived for a termination before closing."}
              </p>
              <label className={s.field}>
                Reason (optional)
                <textarea
                  className={s.textarea}
                  name="reason"
                  maxLength={1000}
                  rows={3}
                  disabled={busy}
                />
              </label>
            </>
          )}
          {confirmation.action === "reopen" && (
            <p>
              The file will return to Active and its checklist will be editable
              again.
            </p>
          )}
          {confirmation.action === "delete" && (
            <>
              <p>
                This permanently deletes the file, checklist, documents, notes
                and email history. Its intake stays processed.
              </p>
              <label className={s.field}>
                Type DELETE to confirm
                <input
                  className={s.input}
                  name="confirmation"
                  autoComplete="off"
                  pattern="DELETE"
                  required
                  disabled={busy}
                />
              </label>
            </>
          )}
          {stale && (
            <p role="alert">
              The file changed. Cancel and reopen this action to review the
              current file.
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="submit"
              className={
                confirmation.action === "delete"
                  ? styles.deleteButton
                  : s.button
              }
              disabled={busy || stale}
            >
              {busy ? "Saving…" : confirmationLabels[confirmation.action]}
            </button>
            <button
              type="button"
              className={styles.textButton}
              onClick={dismiss}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
