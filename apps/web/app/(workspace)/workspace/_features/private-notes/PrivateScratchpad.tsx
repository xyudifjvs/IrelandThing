"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, mutate, useData } from "../../_components/data";
import s from "../../_components/workspace.module.css";

const endpoint = "/api/v1/private-notes/scratchpad";
type Snapshot = { body: string; revision: number };

function ScratchpadEditor({ initial }: { initial: Snapshot }) {
  const [body, setBody] = useState(initial.body);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const latestDraft = useRef(initial.body);
  const latestSaved = useRef(initial);
  const dirty = body !== saved.body;

  const flush = useCallback(async () => {
    if (
      inFlight.current ||
      latestDraft.current === latestSaved.current.body ||
      error
    )
      return;
    inFlight.current = true;
    setSaving(true);
    try {
      while (latestDraft.current !== latestSaved.current.body) {
        const snapshot = await mutate<Snapshot>(
          endpoint,
          {
            body: latestDraft.current,
            expectedRevision: latestSaved.current.revision,
          },
          "PATCH",
        );
        latestSaved.current = snapshot;
        setSaved(snapshot);
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save your notes.",
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [error]);

  useEffect(() => {
    if (!dirty || error || saving) return;
    const timer = setTimeout(() => void flush(), 450);
    return () => clearTimeout(timer);
  }, [body, dirty, error, flush, saving]);

  async function loadLatest() {
    setReloading(true);
    try {
      const latest = await api<Snapshot>(endpoint);
      latestSaved.current = latest;
      latestDraft.current = latest.body;
      setSaved(latest);
      setBody(latest.body);
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not load your saved notes.",
      );
    } finally {
      setReloading(false);
    }
  }

  return (
    <>
      <textarea
        aria-label="My notes"
        className={s.textarea}
        value={body}
        rows={13}
        maxLength={50000}
        disabled={reloading}
        onChange={(event) => {
          latestDraft.current = event.target.value;
          setBody(event.target.value);
        }}
        onBlur={() => void flush()}
      />
      {error ? (
        <p role="alert" className={s.error}>
          {error}{" "}
          <button
            className={s.buttonSmall}
            type="button"
            disabled={reloading}
            onClick={() => setError("")}
          >
            Retry
          </button>{" "}
          <button
            className={s.buttonSmall}
            type="button"
            disabled={reloading}
            onClick={() => void loadLatest()}
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
  const query = useData<Snapshot>(endpoint);
  return (
    <section className={s.section} aria-label="My notes">
      <div className={s.sectionHead}>
        <h2>My notes</h2>
      </div>
      <div className={s.sectionBody}>
        {query.loading && !query.data && <p role="status">Loading notes…</p>}
        {query.error && (
          <p className={s.error} role="alert">
            {query.error}{" "}
            <button
              type="button"
              className={s.buttonSmall}
              onClick={() => void query.refresh()}
            >
              Retry
            </button>
          </p>
        )}
        {query.data && <ScratchpadEditor initial={query.data} />}
      </div>
    </section>
  );
}
