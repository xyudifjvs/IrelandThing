"use client";

import { useId, useState } from "react";
import BusinessContactPicker, {
  type BusinessContact,
} from "../../_components/BusinessContactPicker";
import { label, mutate } from "../../_components/data";
import s from "../../_components/workspace.module.css";

type ContactFields = {
  name: string;
  role: string;
  email: string;
  phone: string;
  company?: string;
};
export type FilePerson = ContactFields & {
  id: string;
  revision: number;
  shareWithAgent: boolean;
  shareWithClient: boolean;
};

const empty: ContactFields = {
  name: "",
  role: "",
  email: "",
  phone: "",
  company: "",
};
const roleOptions = [
  "My agent",
  "Client",
  "Title rep",
  "Lender",
  "Co-op agent",
  "Other",
];
const sameRole = (left: string, right: string) =>
  left
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_") ===
  right
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");

function PersonFields({
  draft,
  change,
}: {
  draft: ContactFields;
  change: (draft: ContactFields) => void;
}) {
  const roles = useId();
  return (
    <div className={s.twoCol}>
      <label className={s.field}>
        Name
        <input
          className={s.input}
          required
          maxLength={200}
          value={draft.name}
          onChange={(event) => change({ ...draft, name: event.target.value })}
        />
      </label>
      <label className={s.field}>
        Role
        <input
          className={s.input}
          list={roles}
          required
          maxLength={80}
          value={draft.role}
          onChange={(event) => change({ ...draft, role: event.target.value })}
        />
        <datalist id={roles}>
          {roleOptions.map((role) => (
            <option key={role} value={role} />
          ))}
        </datalist>
      </label>
      <label className={s.field}>
        Email
        <input
          className={s.input}
          type="email"
          maxLength={254}
          value={draft.email}
          onChange={(event) => change({ ...draft, email: event.target.value })}
        />
      </label>
      <label className={s.field}>
        Phone
        <input
          className={s.input}
          type="tel"
          maxLength={60}
          value={draft.phone}
          onChange={(event) => change({ ...draft, phone: event.target.value })}
        />
      </label>
      <label className={s.field}>
        Company
        <input
          className={s.input}
          maxLength={200}
          value={draft.company ?? ""}
          onChange={(event) =>
            change({ ...draft, company: event.target.value })
          }
        />
      </label>
    </div>
  );
}

export function PeopleOnFilePanel({
  matterId,
  people,
  readOnly,
  refresh,
}: {
  matterId: string;
  people: readonly FilePerson[];
  readOnly: boolean;
  refresh: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [newPerson, setNewPerson] = useState(empty);
  const [selected, setSelected] = useState<BusinessContact | null>(null);
  const [replaceId, setReplaceId] = useState("");
  const [editing, setEditing] = useState<{
    person: FilePerson;
    draft: ContactFields;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const path = `/api/v1/matters/${matterId}/people`;
  const replacements = people.filter((person) =>
    sameRole(person.role, newPerson.role),
  );

  async function save(action: () => Promise<unknown>, onSaved?: () => void) {
    setBusy(true);
    setError("");
    try {
      await action();
      onSaved?.();
      await refresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save this person.",
      );
    } finally {
      setBusy(false);
    }
  }

  function add() {
    const replace = replacements.find((person) => person.id === replaceId);
    void save(
      () =>
        mutate(path, {
          ...newPerson,
          ...(selected
            ? {
                directory: {
                  id: selected.id,
                  expectedRevision: selected.revision,
                },
              }
            : {}),
          ...(replace
            ? {
                replace: { id: replace.id, expectedRevision: replace.revision },
              }
            : {}),
        }),
      () => {
        setAdding(false);
        setSelected(null);
        setReplaceId("");
        setNewPerson(empty);
      },
    );
  }

  return (
    <section className={s.section} aria-label="People on this deal">
      <div className={s.sectionHead}>
        <h2>People on this deal</h2>
        {!readOnly && (
          <button
            type="button"
            className={s.buttonSmall}
            onClick={() => setAdding(!adding)}
          >
            {adding ? "Close" : "Add a person"}
          </button>
        )}
      </div>
      <div className={s.sectionBody}>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {!people.length && (
          <p className={s.muted}>No people have been added.</p>
        )}
        {people.map((person) => (
          <div className={s.attention} key={person.id}>
            <div>
              <strong>{person.name}</strong>
              <p>{label(person.role)}</p>
              {person.email && (
                <a href={`mailto:${person.email}`}>{person.email}</a>
              )}
              {person.phone && <p>{person.phone}</p>}
            </div>
            {!readOnly && (
              <div>
                {(
                  [
                    ["shareWithAgent", "Show to agent"],
                    ["shareWithClient", "Show to client"],
                  ] as const
                ).map(([key, text]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      aria-label={`${text} for ${person.name}`}
                      checked={person[key]}
                      disabled={busy}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        void save(() =>
                          mutate(
                            `${path}/${person.id}`,
                            {
                              expectedRevision: person.revision,
                              [key]: checked,
                            },
                            "PATCH",
                          ),
                        );
                      }}
                    />{" "}
                    {text}
                  </label>
                ))}
                <button
                  className={s.buttonSmall}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setEditing({
                      person,
                      draft: {
                        name: person.name,
                        role: person.role,
                        email: person.email,
                        phone: person.phone,
                        company: person.company ?? "",
                      },
                    })
                  }
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        ))}
        {!readOnly && adding && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <details>
              <summary>Choose a saved contact</summary>
              <BusinessContactPicker
                query={newPerson.name}
                onSelect={(contact) => {
                  setSelected(contact);
                  setNewPerson({
                    name: contact.name,
                    role: contact.kind,
                    email: contact.email,
                    phone: contact.phone,
                    company: contact.company,
                  });
                }}
              />
            </details>
            <PersonFields draft={newPerson} change={setNewPerson} />
            {replacements.length > 0 && (
              <label className={s.field}>
                Another person has this role
                <select
                  className={s.select}
                  value={replaceId}
                  onChange={(event) => setReplaceId(event.target.value)}
                >
                  <option value="">Add alongside</option>
                  {replacements.map((person) => (
                    <option key={person.id} value={person.id}>
                      Replace {person.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button className={s.button} disabled={busy}>
              Add person
            </button>
          </form>
        )}
        {!readOnly && editing && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save(
                () =>
                  mutate(
                    `${path}/${editing.person.id}`,
                    {
                      ...editing.draft,
                      expectedRevision: editing.person.revision,
                    },
                    "PATCH",
                  ),
                () => setEditing(null),
              );
            }}
          >
            <PersonFields
              draft={editing.draft}
              change={(draft) => setEditing({ ...editing, draft })}
            />
            <button className={s.button} disabled={busy}>
              Save person
            </button>
            <button
              className={s.buttonSmall}
              type="button"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
            <button
              className={s.buttonSmall}
              type="button"
              disabled={busy}
              onClick={() =>
                void save(
                  () =>
                    mutate(
                      `${path}/${editing.person.id}`,
                      { expectedRevision: editing.person.revision },
                      "DELETE",
                    ),
                  () => setEditing(null),
                )
              }
            >
              Remove from deal
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
