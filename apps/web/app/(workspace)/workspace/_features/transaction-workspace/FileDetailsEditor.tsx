"use client";

import { useState } from "react";
import { mutate } from "../../_components/data";
import {
  BusyForm,
  type TransactionAction,
} from "../../_components/transaction-controls";
import { ReviewAgentPicker } from "../creation/ReviewAgentPicker";
import { hasVersionedChecklist } from "../checklist/canonical-checklist-model";
import { businessLabel, type TransactionFile } from "./file-model";
import {
  fileDetailsDraft,
  fileDetailsPatch,
  type FileDetailsDraft,
} from "./file-details-model";
import s from "../creation/creation.module.css";
import controls from "../../_components/workspace.module.css";

export function FileDetailsEditor({
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
  const [initial] = useState(() => fileDetailsDraft(file));
  const [expectedRevision] = useState(file.revision);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const stale = expectedRevision !== file.revision;
  const changed = JSON.stringify(initial) !== JSON.stringify(draft);
  const versioned = hasVersionedChecklist(file);
  const change = (patch: Partial<FileDetailsDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError("");
  };
  const moneyInput = (
    key: "purchasePrice" | "earnestMoney" | "homeWarranty",
    title: string,
  ) => (
    <label>
      {title}
      <input
        inputMode="decimal"
        value={draft[key]}
        onChange={(event) => change({ [key]: event.target.value })}
      />
    </label>
  );

  return (
    <BusyForm
      busy={busy}
      className={s.section}
      aria-label="Edit transaction details"
      id="edit-transaction-details"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || stale || !expectedRevision) return;
        try {
          const patch = fileDetailsPatch(initial, draft);
          if (!Object.keys(patch).length) {
            close();
            return;
          }
          void act("file-details", async () => {
            await mutate(
              `/api/v1/matters/${encodeURIComponent(file.id)}/facts`,
              { expectedRevision, ...patch },
              "PATCH",
            );
            close();
          });
        } catch (reason) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Check the transaction details.",
          );
        }
      }}
    >
      <h2>Edit transaction details</h2>
      <p>
        Business: {businessLabel(file.business)}. Use “Change business” above to
        update the business or service.
      </p>
      <div className={s.grid}>
        <label className={s.fullWidth}>
          Property address
          <input
            required
            maxLength={500}
            value={draft.propertyAddress}
            onChange={(event) =>
              change({ propertyAddress: event.target.value })
            }
          />
        </label>
        <label>
          Representing
          <select
            value={draft.side}
            onChange={(event) =>
              change({
                side: event.target.value === "seller" ? "seller" : "buyer",
              })
            }
          >
            <option value="buyer">Buyer</option>
            <option value="seller">Seller</option>
          </select>
        </label>
        <label>
          Purchase type
          <select
            disabled={!versioned}
            value={draft.purchaseType}
            onChange={(event) =>
              change({
                purchaseType:
                  event.target.value === "cash"
                    ? "cash"
                    : event.target.value === "financed"
                      ? "financed"
                      : "",
              })
            }
          >
            <option value="">Not specified</option>
            <option value="cash">Cash</option>
            <option value="financed">Financed</option>
          </select>
        </label>
        {moneyInput("purchasePrice", "Purchase price ($)")}
        <ReviewAgentPicker
          agentId={draft.agentId}
          agentRosterId={draft.agentRosterId}
          onChange={(choice) =>
            change({
              agentId: choice.agentId ?? null,
              agentRosterId: choice.agentRosterId ?? null,
            })
          }
        />
        {versioned && (
          <>
            {moneyInput("earnestMoney", "Earnest money amount ($)")}
            <label>
              Earnest money held by
              <input
                maxLength={300}
                value={draft.earnestMoneyHolder}
                onChange={(event) =>
                  change({ earnestMoneyHolder: event.target.value })
                }
              />
            </label>
            {moneyInput("homeWarranty", "Home warranty amount ($)")}
            <label>
              Home warranty company
              <input
                maxLength={300}
                value={draft.homeWarrantyCompany}
                onChange={(event) =>
                  change({ homeWarrantyCompany: event.target.value })
                }
              />
            </label>
          </>
        )}
      </div>
      {draft.purchaseType !== initial.purchaseType && (
        <p role="status">
          Changing to cash moves Loan Application and Financing Approved to Not
          needed. Changing back restores their previous status. The Pre-Approval
          / Proof of Funds label also follows the purchase type.
        </p>
      )}
      {!versioned && (
        <p>
          This file uses its original checklist. Edit its earnest-money and
          warranty details through those checklist controls.
        </p>
      )}
      {error && (
        <p className={controls.error} role="alert">
          {error}
        </p>
      )}
      {stale && (
        <p className={controls.error} role="alert">
          This transaction changed while you were editing. Cancel and reopen
          these details to load the current values.
        </p>
      )}
      <div className={s.actions}>
        <button
          className={controls.button}
          disabled={busy || stale || !changed}
        >
          {busy ? "Saving…" : "Save transaction details"}
        </button>
        <button
          className={controls.buttonSmall}
          type="button"
          disabled={busy}
          onClick={close}
        >
          Cancel
        </button>
      </div>
    </BusyForm>
  );
}
