"use client";

import { useState } from "react";
import { useData, mutate } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import MatterPicker from "../../_components/MatterPicker";

export function MessageReview({
  message,
  onChanged,
}: {
  message: Record<string, unknown>;
  onChanged: () => void;
}) {
  const threads = useData<
    { id: string; matterId?: string | null; revision: number }[]
  >("/api/v1/communications/threads");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const thread = threads.data?.find((t) => t.id === message.threadId);
  const [association, setAssociation] = useState(
    String(message.matterId || ""),
  );
  return (
    <div
      style={{ marginTop: 25, borderTop: "1px solid #e3d6c1", paddingTop: 20 }}
    >
      <p className={s.eyebrow}>File association</p>
      {error && <p className={s.error}>{error}</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            if (!thread)
              throw new Error(
                "Refresh this conversation before changing its association.",
              );
            await mutate(
              `/api/v1/communications/threads/${thread.id}`,
              {
                expectedRevision: thread.revision,
                matterId: String(f.get("matterId") || "") || null,
              },
              "PATCH",
            );
            onChanged();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <MatterPicker
          label="Associate this conversation with a transaction"
          name="matterId"
          value={association}
          onChange={setAssociation}
          emptyLabel="Unassigned (needs coordinator review)"
        />
        <button
          className={s.buttonSmall}
          style={{ marginTop: 12 }}
          disabled={busy || !thread}
        >
          Save reviewed association
        </button>
      </form>
    </div>
  );
}
