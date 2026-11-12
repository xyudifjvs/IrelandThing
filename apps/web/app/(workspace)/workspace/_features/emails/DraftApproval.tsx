"use client";

import { Send } from "lucide-react";
import { api, label, mutate } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import type { Draft } from "./email-model";

export function DraftApproval({
  draft,
  matter,
  dirty,
  confirmed,
  connected,
  busy,
  recipientName,
  setBusy,
  setError,
  setMessage,
  setConfirmed,
  setDraft,
  loadDraft,
  refresh,
  onWorkChanged,
}: {
  draft: Draft;
  matter: string;
  dirty: boolean;
  confirmed: boolean;
  connected: boolean;
  busy: boolean;
  recipientName: string;
  setBusy: (value: boolean) => void;
  setError: (value: string) => void;
  setMessage: (value: string) => void;
  setConfirmed: (value: boolean) => void;
  setDraft: (value: Draft) => void;
  loadDraft: (value: Draft) => void;
  refresh: () => Promise<void>;
  onWorkChanged?: () => Promise<void>;
}) {
  return (
    <div style={{ marginTop: 20 }}>
      {draft.details?.reviewNeeded && (
        <div className={s.notice}>
          <strong>The transaction changed. Review this draft again.</strong>
          <p>
            Confirmed dates may have refreshed. Hand-edited text was preserved
            and may need a correction before sending.
          </p>
          {draft.details.mergeError && <p>{draft.details.mergeError}</p>}
        </div>
      )}
      <div className={s.formRow} style={{ flexWrap: "wrap" }}>
        <button
          className={s.buttonSmall}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const saved = await api<Draft[]>(
                `/api/v1/communications/drafts?matterId=${encodeURIComponent(matter)}`,
              );
              const latest = saved.find((d) => d.id === draft.id);
              if (!latest)
                throw new Error("This draft is no longer available.");
              loadDraft(latest);
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Reload saved draft (replace unsaved changes)
        </button>
        {draft.details?.templateId && draft.status === "draft" && (
          <button
            className={s.buttonSmall}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const reset = await mutate<Draft>(
                  `/api/v1/communications/drafts/${draft.id}/reset-template`,
                  {
                    expectedRevision: draft.revision,
                    values: recipientName ? { recipientName } : {},
                  },
                );
                loadDraft(reset);
                await refresh();
                setMessage(
                  "The message was replaced with current template text. Review before sending.",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Replace message with current template
          </button>
        )}
      </div>
      <p className={s.fieldHint}>
        Saved draft: {label(draft.status)}
        {dirty ? " · Unsaved changes" : ""}
      </p>
      <label className={s.todo}>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={dirty || busy}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I reviewed the recipients, contact permissions, content and attachments,
        and authorize sending this saved draft.
      </label>
      <button
        className={s.button}
        disabled={
          busy ||
          dirty ||
          !confirmed ||
          !connected ||
          ["queued", "sending", "sent", "delivery_unknown"].includes(
            draft.status,
          )
        }
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const sent = await mutate<Draft>(
              `/api/v1/communications/drafts/${draft.id}/send`,
              { revision: draft.revision, confirmed: true },
            );
            setDraft(sent);
            setMessage(
              `Sending request saved with status: ${label(sent.status)}. Check this draft for sending updates before trying again.`,
            );
            await refresh();
            await onWorkChanged?.();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Send />
        Send approved draft
      </button>
    </div>
  );
}
