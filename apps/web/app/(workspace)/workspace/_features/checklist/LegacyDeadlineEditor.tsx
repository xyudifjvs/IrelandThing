"use client";

import { useState } from "react";
import {
  agentCanSee,
  clientCanSee,
  audienceVisibility,
} from "../../../../_lib/checklist-audiences";
import { mutate, label, date, type Matter } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import {
  BusyForm,
  type TransactionAction,
} from "../../_components/transaction-controls";

export function DeadlineEditor({
  matterId,
  deadline: d,
  busy,
  act,
}: {
  matterId: string;
  deadline: NonNullable<Matter["deadlines"]>[number];
  busy: boolean;
  act: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<{
    value: string;
    status: string;
    revision?: number;
    visibility?: string;
  } | null>(null);
  const value = draft?.value ?? d.date?.slice(0, 10) ?? "";
  const status = draft?.status ?? d.status;
  const visibility = draft?.visibility ?? d.visibility ?? "client";
  const conflict = !!draft && draft.revision !== d.revision;
  return (
    <BusyForm
      busy={!!busy}
      className={s.taskLine}
      style={{ alignItems: "flex-start", flexWrap: "wrap" }}
      onSubmit={(e) => {
        e.preventDefault();
        void act(d.id, async () => {
          await mutate(
            `/api/v1/matters/${matterId}/deadlines/${d.id}`,
            {
              expectedRevision: draft?.revision ?? d.revision,
              date: value || null,
              status: value ? status : "unknown",
              ...(draft?.visibility !== undefined
                ? { visibility: draft.visibility }
                : {}),
            },
            "PATCH",
          );
          setDraft(null);
        });
      }}
    >
      <div style={{ flex: "1 1 150px" }}>
        <strong style={{ fontWeight: 500, fontSize: 12 }}>{d.label}</strong>
        <p className={s.fieldHint}>
          {label(d.status)}
          {d.sourceDocumentId && (
            <>
              {" "}
              ·{" "}
              <a
                href={`/api/v1/documents/${d.sourceDocumentId}/download`}
                target="_blank"
                rel="noreferrer"
              >
                Review source
              </a>
            </>
          )}
        </p>
      </div>
      <label className={s.field} style={{ maxWidth: 160 }}>
        Contract date
        <input
          className={s.input}
          type="date"
          value={value}
          disabled={busy}
          onChange={(e) =>
            setDraft({
              value: e.target.value,
              status,
              revision: draft?.revision ?? d.revision,
              ...(draft?.visibility !== undefined
                ? { visibility: draft.visibility }
                : {}),
            })
          }
        />
      </label>
      <label className={s.field} style={{ maxWidth: 135 }}>
        Review status
        <select
          className={s.select}
          value={status}
          disabled={busy}
          onChange={(e) =>
            setDraft({
              value,
              status: e.target.value,
              revision: draft?.revision ?? d.revision,
              ...(draft?.visibility !== undefined
                ? { visibility: draft.visibility }
                : {}),
            })
          }
        >
          {["unknown", "proposed", "confirmed", "rejected"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>Visible to</legend>
        <label>
          <input
            type="checkbox"
            aria-label={`Show ${d.label} date to agent`}
            checked={agentCanSee(visibility)}
            onChange={(e) =>
              setDraft({
                value,
                status,
                revision: draft?.revision ?? d.revision,
                visibility: audienceVisibility(
                  e.target.checked,
                  clientCanSee(visibility),
                ),
              })
            }
          />{" "}
          Agent
        </label>
        <label>
          <input
            type="checkbox"
            aria-label={`Show ${d.label} date to client`}
            checked={clientCanSee(visibility)}
            onChange={(e) =>
              setDraft({
                value,
                status,
                revision: draft?.revision ?? d.revision,
                visibility: audienceVisibility(
                  agentCanSee(visibility),
                  e.target.checked,
                ),
              })
            }
          />{" "}
          Client link
        </label>
        {d.linkedToTask && (
          <p className={s.fieldHint}>
            This date also follows its milestone’s audience. Sharing the date
            cannot reveal a hidden milestone.
          </p>
        )}
      </fieldset>
      <button
        className={s.buttonSmall}
        style={{ marginTop: 23 }}
        disabled={busy || conflict}
      >
        Save date
      </button>
      {conflict && (
        <p className={s.error}>
          This date changed while you were editing. Your draft is preserved.{" "}
          <button type="button" onClick={() => setDraft(null)}>
            Use latest date
          </button>
        </p>
      )}
    </BusyForm>
  );
}
