"use client";
import { useEffect, useId, useState } from "react";
import { useData } from "./data";
import s from "./workspace.module.css";
export type PortalUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};
export default function UserPicker({
  value,
  onChange,
  role,
  required = true,
  label = "Account",
  disabled = false,
}: {
  value: string;
  onChange: (id: string) => void;
  role?: string;
  required?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [cursor, setCursor] = useState(""),
    [earlier, setEarlier] = useState<PortalUser[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setCursor("");
      setEarlier([]);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams({ limit: "50" });
  if (query) params.set("q", query);
  if (cursor) params.set("cursor", cursor);
  const q = useData<PortalUser[]>(`/api/v1/users?${params}`);
  const all = [...earlier, ...(q.data || [])].filter(
    (u, i, rows) => rows.findIndex((x) => x.id === u.id) === i,
  );
  const users = all.filter(
    (u) => (!role || u.role === role) && ["agent", "client"].includes(u.role),
  );
  return (
    <div>
      <label className={s.field} htmlFor={`${id}-search`}>
        Find {label.toLowerCase()} by name or email
        <input
          id={`${id}-search`}
          className={s.input}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={disabled}
        />
      </label>
      <label className={s.field} htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className={s.select}
        required={required}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose an account</option>
        {value && !users.some((u) => u.id === value) && (
          <option value={value}>Selected account (search to change)</option>
        )}
        {users.map((u) => (
          <option value={u.id} key={u.id}>
            {u.name} · {u.email} · {u.role}
          </option>
        ))}
      </select>
      {q.loading && (
        <p className={s.fieldHint} role="status">
          Loading accounts…
        </p>
      )}
      {q.error && (
        <p className={s.error} role="alert">
          {q.error}{" "}
          <button
            type="button"
            className={s.buttonSmall}
            onClick={() => void q.refresh()}
          >
            Try again
          </button>
        </p>
      )}
      {!q.loading && !q.error && !users.length && (
        <p className={s.fieldHint}>
          No matching {role || "agent or client"} accounts on this page. Search
          by email or load more results.
        </p>
      )}
      {q.data?.length === 50 && (
        <button
          type="button"
          className={s.buttonSmall}
          disabled={disabled || q.loading}
          onClick={() => {
            const last = all.at(-1);
            if (last) {
              setEarlier(all);
              setCursor(last.id);
            }
          }}
        >
          Load more accounts
        </button>
      )}
    </div>
  );
}
