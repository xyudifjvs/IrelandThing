import { useState } from "react";
import type { TransactionBusiness } from "@weatherly/platform/handoff-contracts";
import { address, date, label, mutate } from "../../_components/data";
import type { TransactionAction } from "../../_components/transaction-controls";
import s from "../../_components/workspace.module.css";
import {
  businessLabel,
  closingDate,
  fileClientNames,
  nextChecklistDate,
  type TransactionFile,
} from "./file-model";
import styles from "./file-workspace.module.css";

function ChangeBusiness({
  file,
  busy,
  act,
  close,
}: {
  file: TransactionFile;
  busy: boolean;
  act: TransactionAction;
  close: () => void;
}) {
  const [expectedRevision] = useState(file.revision);
  const [business, setBusiness] = useState(file.business ?? "weatherly");
  const [service, setService] = useState<"essentials" | "complete" | "">(
    file.packageCode === "essentials" || file.packageCode === "complete"
      ? file.packageCode
      : "",
  );
  const selection: TransactionBusiness | null =
    business === "hto"
      ? { business, packageCode: "hto_included" }
      : service
        ? { business, packageCode: service }
        : null;
  const stale = file.revision !== expectedRevision;
  const same =
    selection !== null &&
    selection.business === file.business &&
    selection.packageCode === file.packageCode;
  return (
    <form
      className={styles.businessForm}
      aria-label="Change business"
      onSubmit={(event) => {
        event.preventDefault();
        if (!expectedRevision || stale || busy || !selection || same) return;
        void act("business", async () => {
          await mutate(
            `/api/v1/matters/${encodeURIComponent(file.id)}/business`,
            {
              expectedRevision,
              business: selection,
            },
            "PATCH",
          );
          close();
        });
      }}
    >
      <label className={s.field}>
        Business
        <select
          className={s.select}
          value={business}
          disabled={busy}
          onChange={(event) =>
            setBusiness(event.target.value === "hto" ? "hto" : "weatherly")
          }
        >
          <option value="weatherly">Weatherly TC</option>
          <option value="hto">Home Team Ohio</option>
        </select>
      </label>
      {business === "weatherly" && (
        <label className={s.field}>
          Service
          <select
            className={s.select}
            value={service}
            disabled={busy}
            required
            onChange={(event) => {
              const value = event.target.value;
              setService(
                value === "complete" || value === "essentials" ? value : "",
              );
            }}
          >
            <option value="">Choose a service</option>
            <option value="essentials">Contract to Close</option>
            <option value="complete">Contract to Close + Compliance</option>
          </select>
        </label>
      )}
      <div className={styles.actions}>
        <button
          className={s.buttonSmall}
          type="submit"
          disabled={busy || stale || !selection || same}
        >
          Save business
        </button>
        <button
          className={styles.textButton}
          type="button"
          disabled={busy}
          onClick={close}
        >
          Cancel
        </button>
      </div>
      {stale && (
        <p role="alert" className={styles.formNotice}>
          The file changed. Reopen this form to use the current file.
        </p>
      )}
    </form>
  );
}

export function FileHeader({
  file,
  canEdit,
  busy,
  act,
}: {
  file: TransactionFile;
  canEdit: boolean;
  busy: boolean;
  act: TransactionAction;
}) {
  const [editing, setEditing] = useState(false);
  const clients = fileClientNames(file);
  const closing = closingDate(file);
  const next = nextChecklistDate(file);
  return (
    <header className={styles.header}>
      <div className={styles.headerSummary}>
        <div>
          <h1>{address(file)}</h1>
          <div className={styles.fileFacts}>
            {file.side && <span>{label(file.side)} side</span>}
            {!!clients.length && <span>{clients.join(", ")}</span>}
            <span
              className={styles.business}
              data-business={file.business ?? undefined}
            >
              {businessLabel(file.business)}
            </span>
            {canEdit && (
              <button
                type="button"
                className={styles.textButton}
                aria-expanded={editing}
                disabled={busy}
                onClick={() => setEditing(!editing)}
              >
                Change business
              </button>
            )}
          </div>
        </div>
        <dl className={styles.dates}>
          {next &&
            !(
              next.dueDate === closing && next.title.toLowerCase() === "closing"
            ) && (
              <div>
                <dt>Next</dt>
                <dd>
                  {next.title} · {date(next.dueDate)}
                </dd>
              </div>
            )}
          <div>
            <dt>Closing</dt>
            <dd>{date(closing)}</dd>
          </div>
        </dl>
      </div>
      {editing && canEdit && (
        <ChangeBusiness
          file={file}
          busy={busy}
          act={act}
          close={() => setEditing(false)}
        />
      )}
    </header>
  );
}
