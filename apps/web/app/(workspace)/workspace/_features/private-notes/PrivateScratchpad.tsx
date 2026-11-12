"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useData, type Session } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import {
  scratchpadDraft,
  scratchpadPath,
  type ScratchpadSnapshot,
} from "./scratchpad-draft";

function ScratchpadEditor({
  ownerId,
  initial,
}: {
  ownerId: string;
  initial: ScratchpadSnapshot;
}) {
  const [draft] = useState(() => scratchpadDraft(ownerId, initial));
  const { body, saved, saving, reloading, error } = useSyncExternalStore(
    draft.subscribe,
    draft.getSnapshot,
  );
  const dirty = body !== saved.body;

  useEffect(() => {
    if (!dirty || error || saving || reloading) return;
    const timer = setTimeout(() => void draft.flush(), 450);
    return () => clearTimeout(timer);
  }, [body, dirty, draft, error, reloading, saving]);

  return (
    <>
      <textarea
        aria-label="My notes"
        className={s.textarea}
        value={body}
        rows={13}
        maxLength={50000}
        disabled={reloading}
        onChange={(event) => draft.edit(event.target.value)}
        onBlur={() => void draft.flush()}
      />
      {error ? (
        <p role="alert" className={s.error}>
          {error}{" "}
          <button
            className={s.buttonSmall}
            type="button"
            disabled={reloading}
            onClick={draft.retry}
          >
            Retry
          </button>{" "}
          <button
            className={s.buttonSmall}
            type="button"
            disabled={reloading}
            onClick={() => void draft.discard()}
          >
            Discard draft and load saved notes
          </button>
        </p>
      ) : (
        <p className={s.muted} role="status">
          {saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}
        </p>
      )}
    </>
  );
}

export function PrivateScratchpad() {
  const session = useData<Session>("/api/v1/session");
  const user = session.data?.user;
  const ownerId = user?.role === "coordinator" ? user.id : undefined;
  const query = useData<ScratchpadSnapshot>(
    ownerId ? scratchpadPath(ownerId) : null,
  );
  const error = session.error || query.error;
  return (
    <section className={s.section} aria-label="My notes">
      <div className={s.sectionHead}>
        <h2>My notes</h2>
      </div>
      <div className={s.sectionBody}>
        {(session.loading || (query.loading && !query.data)) && (
          <p role="status">Loading notes…</p>
        )}
        {error && (
          <p className={s.error} role="alert">
            {error}{" "}
            <button
              type="button"
              className={s.buttonSmall}
              onClick={() =>
                void (session.error ? session.refresh() : query.refresh())
              }
            >
              Retry
            </button>
          </p>
        )}
        {ownerId && query.data && (
          <ScratchpadEditor
            key={ownerId}
            ownerId={ownerId}
            initial={query.data}
          />
        )}
      </div>
    </section>
  );
}
