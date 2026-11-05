"use client";
import { useEffect, useState } from "react";
import { useData, type Session, label } from "./data";
import s from "./workspace.module.css";
export const businessContactKinds = [
  "agent",
  "co_op_agent",
  "title_company",
  "title_rep",
  "lender",
  "loan_officer",
  "other",
] as const;
export type BusinessContactKind = (typeof businessContactKinds)[number];
export type BusinessContact = {
  id: string;
  ownerId: string;
  kind: BusinessContactKind;
  name: string;
  company: string;
  email: string;
  phone: string;
  favorite: boolean;
  revision: number;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type BusinessContactSnapshot = {
  directoryContactId: string;
  directoryRevision: number;
  snapshotAt: string;
  role: string;
  name: string;
  company: string;
  email: string;
  phone: string;
};
export function businessContactSnapshot(
  contact: BusinessContact,
  role: string = contact.kind,
): BusinessContactSnapshot {
  return {
    directoryContactId: contact.id,
    directoryRevision: contact.revision,
    snapshotAt: new Date().toISOString(),
    role,
    name: contact.name,
    company: contact.company,
    email: contact.email,
    phone: contact.phone,
  };
}
/** Suggestions only. Caller explicitly reviews replacement conflicts and saves a snapshot. */
export default function BusinessContactPicker({
  kind,
  query = "",
  onSelect,
}: {
  kind?: BusinessContactKind;
  query?: string;
  onSelect: (contact: BusinessContact) => void;
}) {
  const session = useData<Session>("/api/v1/session"),
    allowed = session.data?.user?.role === "coordinator";
  const [text, setText] = useState(query),
    [search, setSearch] = useState(query),
    [filter, setFilter] = useState(kind || ""),
    [sort, setSort] = useState("frequent"),
    [favorites, setFavorites] = useState(false);
  useEffect(() => setText(query), [query]);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text), 250);
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(() => setFilter(kind || ""), [kind]);
  const params = new URLSearchParams({ q: search, sort, limit: "25" });
  if (filter) params.set("kind", filter);
  if (favorites) params.set("favorites", "true");
  const result = useData<{ items: BusinessContact[]; hasMore: boolean }>(
    allowed ? `/api/v1/contacts?${params}` : null,
  );
  if (!allowed) return null;
  return (
    <div
      style={{
        padding: 14,
        border: "1px solid #dfd4c4",
        borderRadius: 8,
        display: "grid",
        gap: 10,
      }}
    >
      <strong>Choose from your private business contacts</strong>
      <label className={s.field}>
        Search name or company
        <input
          className={s.input}
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          placeholder="Name, company, email or phone"
        />
      </label>
      <div className={s.formGrid}>
        <label className={s.field}>
          Contact type
          <select
            className={s.select}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">All business contacts</option>
            {businessContactKinds.map((k) => (
              <option key={k} value={k}>
                {label(k)}
              </option>
            ))}
          </select>
        </label>
        <label className={s.field}>
          Order
          <select
            className={s.select}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="frequent">Frequently used</option>
            <option value="recent">Recently used</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      <label>
        <input
          type="checkbox"
          checked={favorites}
          onChange={(e) => setFavorites(e.target.checked)}
        />{" "}
        Favorites only
      </label>
      {result.loading ? (
        <p>Finding saved contacts…</p>
      ) : result.error ? (
        <p className={s.error} role="alert">
          {result.error}
          <button type="button" onClick={() => void result.refresh()}>
            Retry
          </button>
        </p>
      ) : result.data?.items.length ? (
        <div
          style={{ display: "grid", gap: 8, maxHeight: 320, overflowY: "auto" }}
        >
          {result.data.items.map((c) => (
            <div
              key={c.id}
              style={{
                padding: 10,
                border: "1px solid #e5dac9",
                borderRadius: 6,
              }}
            >
              <strong>{c.name}</strong>
              {c.favorite ? " ★" : ""}
              <p className={s.fieldHint}>
                {c.company || "Company not provided"} · {label(c.kind)}
                <br />
                {c.email || "Email not provided"} ·{" "}
                {c.phone || "Phone not provided"}
              </p>
              <button
                type="button"
                className={s.buttonSmall}
                onClick={() => onSelect(c)}
              >
                Use {c.name}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className={s.fieldHint}>
          No saved contacts match. Enter a new contact or change the search.
        </p>
      )}
      {result.data?.hasMore && (
        <p className={s.fieldHint}>
          More matches exist. Add a name or company to narrow the search.
        </p>
      )}
      <p className={s.fieldHint}>
        Choosing a result does not save, send or invite anyone. Review the
        details before adding them to this transaction.
      </p>
    </div>
  );
}
