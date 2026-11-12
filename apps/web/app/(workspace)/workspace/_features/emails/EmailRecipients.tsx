"use client";

import { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import { label, mutate, useData } from "../../_components/data";
import type { BusinessContact } from "../../_components/BusinessContactPicker";
import { emailRoleFamily } from "./recipient-defaults";
import type { FilePerson } from "../people/PeopleOnFilePanel";
import s from "../../_components/workspace.module.css";
import styles from "./file-email.module.css";

export function addresses(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

const validAddress = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;

export function RecipientField({
  title,
  value,
  change,
  addToDeal,
  existingEmails,
  searchDirectory = false,
}: {
  title: string;
  value: string;
  change: (value: string, entered?: string[]) => void;
  addToDeal?: (email: string) => void;
  existingEmails: ReadonlySet<string>;
  searchDirectory?: boolean;
}) {
  const [entry, setEntry] = useState("");
  const [error, setError] = useState("");
  const term = entry.trim();
  const [lookup, setLookup] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setLookup(term), 200);
    return () => clearTimeout(timer);
  }, [term]);
  const saved = useData<{ items: BusinessContact[] }>(
    searchDirectory &&
      term === lookup &&
      term.length >= 2 &&
      !term.includes(",")
      ? `/api/v1/contacts?q=${encodeURIComponent(term)}&limit=8`
      : null,
  );
  const selected = addresses(value);
  const options = (saved.data?.items ?? []).filter(
    ({ email }) =>
      validAddress.test(email) &&
      !selected.includes(email.trim().toLowerCase()),
  );
  function select(next: string[]) {
    change([...new Set([...selected, ...next])].join(", "), next);
    setEntry("");
    setError("");
  }
  function add() {
    const next = addresses(entry);
    if (!next.length) return;
    if (next.some((email) => !validAddress.test(email))) {
      setError("Enter a valid email address.");
      return;
    }
    select(next);
  }
  return (
    <fieldset className={styles.recipients}>
      <legend>{title}</legend>
      {selected.length > 0 && (
        <ul className={styles.chips}>
          {selected.map((email) => (
            <li className={styles.chip} key={email}>
              <span>{email}</span>
              <button
                type="button"
                aria-label={`Remove ${email} from ${title}`}
                onClick={() =>
                  change(selected.filter((entry) => entry !== email).join(", "))
                }
              >
                <X size={14} aria-hidden="true" />
              </button>
              {addToDeal && !existingEmails.has(email) && (
                <button
                  type="button"
                  onClick={() => addToDeal(email)}
                  aria-label={`Add ${email} to this deal`}
                >
                  Add to deal
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className={styles.addressEntry}>
        <input
          className={s.input}
          aria-label={`${title} email address`}
          inputMode="email"
          autoCapitalize="none"
          autoComplete="off"
          value={entry}
          onChange={(event) => {
            setEntry(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
        />
        <button
          type="button"
          className={s.buttonSmall}
          onClick={add}
          disabled={!entry.trim()}
        >
          Add {title}
        </button>
      </div>
      {options.length > 0 && (
        <div
          className={styles.contactSuggestions}
          role="group"
          aria-label="Saved contacts"
        >
          {options.map((contact) => (
            <button
              key={contact.id}
              type="button"
              className={s.buttonSmall}
              onClick={() => select(addresses(contact.email))}
            >
              {contact.name} · {contact.email}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

const roles = ["Title rep", "Lender", "Co-op agent", "Other"];

export function AddEmailRecipientToDeal({
  matterId,
  email,
  people,
  close,
  saved,
}: {
  matterId: string;
  email: string;
  people: readonly FilePerson[];
  close: () => void;
  saved: () => void;
}) {
  const fieldId = useId();
  const [name, setName] = useState("");
  const [role, setRole] = useState("Other");
  const [replaceId, setReplaceId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const replacements = people.filter(
    (person) => emailRoleFamily(person.role) === emailRoleFamily(role),
  );
  async function save() {
    setSaving(true);
    setError("");
    try {
      const replace = replacements.find((person) => person.id === replaceId);
      await mutate(`/api/v1/matters/${encodeURIComponent(matterId)}/people`, {
        name,
        email,
        role,
        phone: "",
        ...(replace
          ? { replace: { id: replace.id, expectedRevision: replace.revision } }
          : {}),
      });
      saved();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <fieldset className={styles.recipients} disabled={saving}>
      <legend>Add {email} to this deal</legend>
      <div className={s.formGrid}>
        <label className={s.field}>
          Name
          <input
            className={s.input}
            value={name}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className={s.field}>
          <label htmlFor={fieldId + "-role"}>Role</label>
          <select
            id={fieldId + "-role"}
            className={s.select}
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              setReplaceId("");
            }}
          >
            {roles.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </div>
        {replacements.length > 0 && (
          <div className={s.field}>
            <label htmlFor={fieldId + "-replacement"}>Existing contact</label>
            <select
              id={fieldId + "-replacement"}
              className={s.select}
              value={replaceId}
              onChange={(event) => setReplaceId(event.target.value)}
            >
              <option value="">Add alongside existing contacts</option>
              {replacements.map((person) => (
                <option key={person.id} value={person.id}>
                  Replace {person.name} · {label(person.role)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <div className={s.formRow}>
        <button
          type="button"
          className={s.buttonSmall}
          disabled={!name.trim()}
          onClick={() => void save()}
        >
          {replaceId ? "Replace contact" : "Add to this deal"}
        </button>
        <button type="button" className={s.buttonSmall} onClick={close}>
          Cancel
        </button>
      </div>
    </fieldset>
  );
}
