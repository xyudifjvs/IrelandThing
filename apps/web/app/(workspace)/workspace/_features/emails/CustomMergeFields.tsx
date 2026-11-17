"use client";

import { useState } from "react";
import { useData, mutate } from "../../_components/data";
import s from "../../_components/workspace.module.css";

export type CustomField = {
  key: string;
  label: string;
  defaultValue: string;
  revision: number;
};

export function CustomMergeFields() {
  const query = useData<CustomField[]>(
    "/api/v1/communications/custom-merge-fields",
  );
  const [editing, setEditing] = useState<CustomField | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  return (
    <section
      style={{ marginTop: 30 }}
      aria-labelledby="custom-merge-fields-heading"
    >
      <h3 id="custom-merge-fields-heading">Custom merge fields</h3>
      <p className={s.fieldHint}>
        Create fields to reuse in any email template. Give a field a default
        value, or fill it in for each email before applying the template.
      </p>
      {query.error && (
        <p className={s.error} role="alert">
          {query.error}
        </p>
      )}
      {query.loading && <p>Loading merge fields…</p>}
      {query.data?.map((field) => (
        <div key={field.key} className={s.actions}>
          <div>
            <strong>{field.label}</strong> · <code>{`{{${field.key}}}`}</code>
            <p className={s.tiny}>
              <span style={{ whiteSpace: "pre-wrap" }}>
                {field.defaultValue || "Fill in for each email"}
              </span>
            </p>
          </div>
          <button
            type="button"
            className={s.buttonSmall}
            disabled={busy}
            onClick={() => {
              setEditing(field);
              setError("");
              setMessage("");
            }}
          >
            Edit {field.label}
          </button>
        </div>
      ))}
      <form
        key={editing?.key ?? "new-field"}
        style={{ marginTop: 18 }}
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const values = new FormData(form);
          setBusy(true);
          setError("");
          setMessage("");
          try {
            const label = String(values.get("label") || "").trim();
            const defaultValue = String(values.get("defaultValue") || "");
            await mutate(
              `/api/v1/communications/custom-merge-fields${editing ? "/" + encodeURIComponent(editing.key) : ""}`,
              editing
                ? { label, defaultValue, expectedRevision: editing.revision }
                : {
                    label,
                    defaultValue,
                    key: String(values.get("key") || "").trim(),
                  },
              editing ? "PATCH" : "POST",
            );
            form.reset();
            setEditing(null);
            await query.refresh();
            setMessage(
              "Merge field saved. You can use its code in a template subject or body.",
            );
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Could not save the merge field.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
          <h4>{editing ? "Edit merge field" : "New merge field"}</h4>
          <div className={s.formGrid}>
            <label className={s.field}>
              Field name
              <input
                className={s.input}
                name="label"
                required
                maxLength={100}
                defaultValue={editing?.label}
                placeholder="e.g. Closing instructions"
              />
            </label>
            {editing ? (
              <p className={s.fieldHint}>
                Template code: <code>{`{{${editing.key}}}`}</code>
              </p>
            ) : (
              <label className={s.field}>
                Field key
                <input
                  className={s.input}
                  name="key"
                  required
                  pattern="[a-z][a-z0-9_]{0,79}"
                  maxLength={80}
                  placeholder="closing_instructions"
                />
                <small>
                  Letters, numbers, and underscores. Example code:{" "}
                  {"{{closing_instructions}}"}. Your key is used exactly as
                  entered.
                </small>
              </label>
            )}
          </div>
          <label className={s.field}>
            Default value (optional)
            <textarea
              className={s.textarea}
              name="defaultValue"
              maxLength={2000}
              defaultValue={editing?.defaultValue}
            />
          </label>
          <div className={s.formRow} style={{ marginTop: 12 }}>
            <button className={s.buttonSmall}>
              {busy
                ? "Saving…"
                : editing
                  ? "Save merge field"
                  : "Create merge field"}
            </button>
            {editing && (
              <button
                type="button"
                className={s.buttonSecondary}
                onClick={() => setEditing(null)}
              >
                Cancel edit
              </button>
            )}
          </div>
        </fieldset>
      </form>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className={s.notice} role="status">
          {message}
        </p>
      )}
    </section>
  );
}
