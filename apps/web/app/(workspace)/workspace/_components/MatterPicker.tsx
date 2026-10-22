"use client";
import { useId, useState } from "react";
import { useData, address, type Matter } from "./data";
import s from "./workspace.module.css";
/** Server search and cursor navigation preserve access to historical files. */
export default function MatterPicker({
  value,
  onChange,
  label = "Transaction",
  name,
  required = false,
  emptyLabel = "Choose a transaction",
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  name?: string;
  required?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [cursor, setCursor] = useState("");
  const [earlier, setEarlier] = useState<Matter[]>([]);
  const params = new URLSearchParams({ limit: "50" });
  if (submitted) params.set("q", submitted);
  if (cursor) params.set("cursor", cursor);
  const query = useData<Matter[]>(`/api/v1/matters?${params}`);
  const options = [...earlier, ...(query.data || [])].filter(
    (m, i, all) => all.findIndex((other) => other.id === m.id) === i,
  );
  const selected = useData<Matter>(
    value && !options.some((m) => m.id === value)
      ? `/api/v1/matters/${encodeURIComponent(value)}`
      : null,
  );
  function find() {
    setEarlier([]);
    setCursor("");
    setSubmitted(search.trim());
  }
  return (
    <div>
      <label className={s.field} htmlFor={id}>
        {label}
      </label>
      <div className={s.formRow} style={{ marginBottom: 8 }}>
        <input
          className={s.input}
          aria-label={`Search all ${label.toLowerCase()} records`}
          value={search}
          disabled={disabled || query.loading}
          placeholder="Search all addresses or names…"
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              find();
            }
          }}
        />
        <button
          type="button"
          className={s.buttonSmall}
          disabled={disabled || query.loading}
          onClick={find}
        >
          Search
        </button>
      </div>
      <select
        id={id}
        name={name}
        className={s.select}
        value={value}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{emptyLabel}</option>
        {value && !options.some((m) => m.id === value) && (
          <option value={value}>
            {selected.data
              ? address(selected.data)
              : selected.loading
                ? "Loading selected transaction…"
                : `Selected transaction ${value}`}
          </option>
        )}
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {address(m)}
          </option>
        ))}
      </select>
      {query.loading && (
        <p className={s.fieldHint}>Loading transaction choices…</p>
      )}
      {(query.error || selected.error) && (
        <p className={s.error} role="alert">
          {query.error || selected.error}
          <button
            type="button"
            className={s.buttonSmall}
            onClick={() => void query.refresh()}
          >
            Retry search
          </button>
        </p>
      )}
      {query.data?.length === 50 && (
        <button
          type="button"
          className={s.buttonSmall}
          style={{ marginTop: 8 }}
          disabled={disabled || query.loading}
          onClick={() => {
            const last = options.at(-1);
            if (last) {
              setEarlier(options);
              setCursor(last.id);
            }
          }}
        >
          Load older transaction choices
        </button>
      )}
      {!query.loading && !query.error && !options.length && (
        <p className={s.fieldHint}>
          No matching transactions. Try another address or name.
        </p>
      )}
    </div>
  );
}
