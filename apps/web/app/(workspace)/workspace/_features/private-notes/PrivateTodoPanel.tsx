"use client";

import { useState } from "react";
import Link from "next/link";
import { useLiveData } from "../../../../_components/useLiveData";
import { address, mutate, useAllMatters } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import styles from "./private-notes.module.css";

const endpoint = "/api/v1/private-notes/todos";
type Todo = {
  id: string;
  matterId: string | null;
  body: string;
  completedAt: string | null;
  revision: number;
  matter: { propertyAddress: string } | null;
};
type TodoPage = { items: Todo[]; total: number; nextCursor: string | null };

export function PrivateTodoPanel({
  matterId,
  overview = false,
}: {
  matterId?: string;
  overview?: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matters = useAllMatters(!matterId && !overview);
  const filters = new URLSearchParams({ limit: overview ? "5" : "50" });
  if (matterId) filters.set("matterId", matterId);
  if (cursor) filters.set("cursor", cursor);
  const query = useLiveData<TodoPage>(
    `${endpoint}?${filters}`,
    undefined,
    true,
  );

  async function change(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Your change could not be saved.",
      );
    } finally {
      await query.refresh();
      setBusy(false);
    }
  }

  return (
    <section
      className={s.section}
      aria-label={matterId ? "My notes and to-dos" : "Notes and to-dos"}
    >
      <div className={s.sectionHead}>
        <h2>{matterId ? "My notes & to-dos" : "Notes & to-dos"}</h2>
      </div>
      <div className={s.sectionBody}>
        {!overview && (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void change(async () => {
                await mutate(endpoint, {
                  body: draft,
                  matterId: matterId || attachment || undefined,
                });
                setDraft("");
                setCursor(null);
              });
            }}
          >
            <label className={s.field}>
              Add a to-do or note
              <textarea
                className={s.textarea}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={5000}
                required
                rows={3}
              />
            </label>
            {!matterId && (
              <label className={s.field}>
                Attach to a transaction
                <select
                  className={s.select}
                  value={attachment}
                  onChange={(event) => setAttachment(event.target.value)}
                >
                  <option value="">Not attached to a file</option>
                  {matters.data
                    .filter((matter) =>
                      ["under_contract", "closing", "listing"].includes(
                        matter.stage ?? "",
                      ),
                    )
                    .map((matter) => (
                      <option key={matter.id} value={matter.id}>
                        {address(matter)}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <button className={s.button} disabled={busy || !draft.trim()}>
              Add
            </button>
          </form>
        )}
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {query.error && (
          <p className={s.error} role="alert">
            Could not load your notes.
          </p>
        )}
        {query.loading && !query.data && <p role="status">Loading notes…</p>}
        {query.data?.total === 0 && (
          <p className={s.muted}>No notes or to-dos yet.</p>
        )}
        <ul className={styles.todos}>
          {query.data?.items.map((item) => (
            <li key={item.id} className={styles.todo}>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={Boolean(item.completedAt)}
                  disabled={busy}
                  onChange={(event) => {
                    const completed = event.currentTarget.checked;
                    void change(() =>
                      mutate(
                        `${endpoint}/${item.id}`,
                        { expectedRevision: item.revision, completed },
                        "PATCH",
                      ),
                    );
                  }}
                />
                <span
                  className={item.completedAt ? styles.completed : undefined}
                >
                  {item.body}
                </span>
              </label>
              {!matterId && (
                <small className={styles.fileLabel}>
                  {item.matter?.propertyAddress || "General"}
                </small>
              )}
              {!overview && (
                <button
                  type="button"
                  className={styles.remove}
                  disabled={busy}
                  aria-label={`Delete note: ${item.body.slice(0, 80)}`}
                  onClick={() =>
                    void change(() =>
                      mutate(
                        `${endpoint}/${item.id}`,
                        { expectedRevision: item.revision },
                        "DELETE",
                      ),
                    )
                  }
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
        {overview && (query.data?.total ?? 0) > 5 && (
          <Link href="/workspace/notes">View all in Notes</Link>
        )}
        {!overview && (!!query.data?.total || cursor) && (
          <div className={styles.actions}>
            {!!query.data?.total && (
              <button
                type="button"
                className={s.buttonSmall}
                disabled={busy}
                onClick={() =>
                  void change(async () => {
                    await mutate(`${endpoint}/clear-completed`, { matterId });
                    setCursor(null);
                  })
                }
              >
                Clear completed
              </button>
            )}
            {cursor && (
              <button
                type="button"
                className={s.buttonSmall}
                onClick={() => setCursor(null)}
              >
                First page
              </button>
            )}
            {query.data?.nextCursor && (
              <button
                type="button"
                className={s.buttonSmall}
                onClick={() => setCursor(query.data?.nextCursor ?? null)}
              >
                Next page
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
