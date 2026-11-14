"use client";

import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import { LockKeyhole, Users } from "lucide-react";
import Contacts, { AgentAssignment } from "../../_components/Contacts";
import UserPicker from "../../_components/UserPicker";
import ChecklistShare from "../../../../_components/ChecklistShare";
import { mutate, label, date, type Matter } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import {
  BusyForm,
  type TransactionAction,
} from "../../_components/transaction-controls";

type PersonDraft = { userId: string; role: string };

export function LegacyFilePeoplePanel({
  matter: m,
  id,
  busy,
  act,
  person,
  setPerson,
  refresh,
}: {
  matter: Matter;
  id: string;
  busy: string;
  act: TransactionAction;
  person: PersonDraft;
  setPerson: Dispatch<SetStateAction<PersonDraft>>;
  refresh: () => Promise<void>;
}) {
  const tasks = m.tasks || [];
  return (
    <aside>
      <ChecklistShare matterId={id} tasks={tasks} />
      <AgentAssignment matter={m} refresh={refresh} />
      <Contacts matter={m} refresh={refresh} />
      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <h2>Portal access</h2>
            <p>Access for existing agent and client accounts.</p>
          </div>
          <Users size={17} strokeWidth={1.3} />
        </div>
        <div className={s.sectionBody}>
          {m.participants?.length ? (
            m.participants.map((p) => (
              <div className={s.attention} key={p.id}>
                <div className={s.avatar}>
                  {p.name?.slice(0, 1) ||
                    p.role?.slice(0, 1).toUpperCase() ||
                    "?"}
                </div>
                <div>
                  <strong>{p.name || p.userId || label(p.role)}</strong>
                  <p>
                    {label(p.role)}
                    <br />
                    {p.email}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <p className={`${s.muted} ${s.tiny}`}>
              No additional participants have been added.
            </p>
          )}
          <details style={{ marginTop: 18 }}>
            <summary
              style={{ cursor: "pointer", fontSize: 11, color: "#8b7151" }}
            >
              Grant portal access
            </summary>
            <BusyForm
              busy={!!busy}
              onSubmit={(e) => {
                e.preventDefault();
                void act("person", async () => {
                  await mutate(`/api/v1/matters/${id}/participants`, person);
                  setPerson({ userId: "", role: "client" });
                });
              }}
              style={{ display: "grid", gap: 10, marginTop: 15 }}
            >
              <UserPicker
                label="Portal account"
                role={person.role}
                value={person.userId}
                onChange={(userId) => setPerson({ ...person, userId })}
                disabled={!!busy}
              />
              <p className={s.fieldHint}>
                Grant access only to an existing agent or client account.
                Contact details from the intake remain in its saved record.
              </p>
              <select
                className={s.select}
                aria-label="Participant role"
                value={person.role}
                onChange={(e) =>
                  setPerson({ userId: "", role: e.target.value })
                }
              >
                {["client", "agent"].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <button className={s.buttonSmall} disabled={!!busy}>
                Add to this file
              </button>
            </BusyForm>
          </details>
        </div>
      </section>
      <div className={s.notice}>
        <LockKeyhole size={16} />
        <p style={{ margin: "7px 0 0" }}>
          Coordinator: complete file.
          <br />
          Agent: assigned file and shared updates.
          <br />
          Client: permitted timeline and documents.
        </p>
        <p className={s.tiny}>
          Private notes stay private. Portal access requires an authorized
          invitation.
        </p>
      </div>
      <Link href="/portal" className={s.buttonSecondary}>
        Open your portal
      </Link>
    </aside>
  );
}
