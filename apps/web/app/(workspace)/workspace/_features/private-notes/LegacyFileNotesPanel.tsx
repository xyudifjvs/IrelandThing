"use client";

import { LockKeyhole } from "lucide-react";
import ChecklistTask from "../../../../_components/ChecklistTask";
import { mutate, label, date, type Matter } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import {
  BusyForm,
  type TransactionAction,
} from "../../_components/transaction-controls";

export function LegacyFileNotesPanel({
  matter: m,
  id,
  busy,
  act,
  note,
  setNote,
}: {
  matter: Matter;
  id: string;
  busy: string;
  act: TransactionAction;
  note: string;
  setNote: (note: string) => void;
}) {
  const tasks = m.tasks || [];
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2>Private notes</h2>
          <p className={s.privateLabel}>
            <LockKeyhole />
            Coordinator only. Agents and clients cannot see this.
          </p>
        </div>
      </div>
      <div className={s.sectionBody}>
        {tasks
          .filter((t) => t.visibility === "coordinator")
          .map((t) => (
            <ChecklistTask
              key={t.id}
              task={t}
              matterId={id}
              busy={!!busy}
              act={act}
            />
          ))}
        {m.notes?.map((n) => (
          <div className={s.note} key={n.id}>
            <p>{n.content || n.text || n.body}</p>
            <small>{date(n.createdAt)}</small>
          </div>
        ))}
        <BusyForm
          busy={!!busy}
          style={{ marginTop: 20 }}
          onSubmit={(e) => {
            e.preventDefault();
            void act("note", async () => {
              await mutate(`/api/v1/matters/${id}/notes`, {
                body: note,
                visibility: "coordinator",
              });
              setNote("");
            });
          }}
        >
          <label className={s.field}>
            Notes on this transaction
            <textarea
              className={s.textarea}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required
              placeholder="Add a note about this transaction…"
            />
          </label>
          <button
            className={s.button}
            style={{ marginTop: 12 }}
            disabled={!!busy || !note.trim()}
          >
            {busy === "note" ? "Saving…" : "Save private note"}
          </button>
        </BusyForm>
      </div>
    </section>
  );
}
