"use client";

import { useEffect, useRef, useState } from "react";
import { api, mutate, useData } from "../../_components/data";
import s from "../../_components/workspace.module.css";

type Detail = { key: string; label: string; value: string };
function DetailInput({
  field,
  matterId,
  readOnly,
}: {
  field: Detail;
  matterId: string;
  readOnly: boolean;
}) {
  const [value, setValue] = useState(field.value);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const saved = useRef(field.value),
    latest = useRef(value),
    saving = useRef(false),
    alive = useRef(true);
  latest.current = value;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (latest.current === saved.current) {
      saved.current = field.value;
      setValue(field.value);
    }
  }, [field.value]);
  async function save() {
    if (readOnly || saving.current || latest.current === saved.current || error)
      return;
    saving.current = true;
    const sending = latest.current,
      expectedValue = saved.current;
    if (alive.current) setStatus("Saving…");
    try {
      await mutate(
        `/api/v1/communications/matters/${encodeURIComponent(matterId)}/details`,
        { key: field.key, value: sending, expectedValue },
        "PATCH",
      );
      saved.current = sending;
      if (alive.current)
        setStatus(latest.current === sending ? "Saved" : "Unsaved changes");
    } catch (failure) {
      if (alive.current) {
        setError((failure as Error).message);
        setStatus("Not saved");
      }
    } finally {
      saving.current = false;
      if (alive.current) setTick((count) => count + 1);
    }
  }
  useEffect(() => {
    if (value === saved.current || readOnly || error) return;
    const timer = setTimeout(() => void save(), 650);
    return () => clearTimeout(timer);
    // A successful save schedules any text typed while the request was in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, tick, readOnly, error]);
  return (
    <label className={s.field} style={{ marginTop: 12 }}>
      {field.label}
      <textarea
        className={s.textarea}
        rows={3}
        maxLength={8000}
        value={value}
        disabled={readOnly}
        onChange={(event) => {
          setValue(event.target.value);
          setStatus("Unsaved changes");
        }}
        onBlur={() => void save()}
      />
      <small>
        <code>{`{{${field.key}}}`}</code> <span role="status">{status}</span>
      </small>
      {error && (
        <span className={s.error} role="alert">
          {error}{" "}
          <button
            type="button"
            className={s.buttonSmall}
            onClick={() => {
              setError("");
              setTick((count) => count + 1);
            }}
          >
            Retry save
          </button>
          <button
            type="button"
            className={s.buttonSmall}
            onClick={async () => {
              try {
                const fields = await api<Detail[]>(
                  `/api/v1/communications/matters/${encodeURIComponent(matterId)}/details`,
                );
                const current = fields.find((entry) => entry.key === field.key);
                if (!current) return;
                saved.current = current.value;
                latest.current = current.value;
                setValue(current.value);
                setError("");
                setStatus("Saved value reloaded");
              } catch (failure) {
                setError((failure as Error).message);
              }
            }}
          >
            Reload saved value (replace my text)
          </button>
        </span>
      )}
    </label>
  );
}

export function TransactionDetailsCard({
  matterId,
  readOnly,
  area = "details",
}: {
  matterId: string;
  readOnly: boolean;
  area?: "details" | "commission";
}) {
  const query = useData<Detail[]>(
    `/api/v1/communications/matters/${encodeURIComponent(matterId)}/details`,
  );
  return (
    <section
      className={s.section}
      style={{ padding: 16 }}
      aria-labelledby={`transaction-${area}-heading`}
    >
      <h3 id={`transaction-${area}-heading`}>
        {area === "commission" ? "Commission" : "Details"}
      </h3>
      <p className={s.fieldHint}>
        {area === "commission"
          ? "Enter the buyer-agent commission for this transaction, such as 3% or a dollar amount. Saves as you type and fills your emails."
          : "Saves as you type. These values fill the matching email fields."}
      </p>
      {query.loading && <p>Loading details…</p>}
      {query.error && (
        <p role="alert" className={s.error}>
          {query.error}
        </p>
      )}
      {query.data
        ?.filter(
          (field) =>
            (field.key === "buyer_agent_commission") ===
            (area === "commission"),
        )
        .map((field) => (
          <DetailInput
            key={`${matterId}:${field.key}`}
            field={field}
            matterId={matterId}
            readOnly={readOnly}
          />
        ))}
    </section>
  );
}
