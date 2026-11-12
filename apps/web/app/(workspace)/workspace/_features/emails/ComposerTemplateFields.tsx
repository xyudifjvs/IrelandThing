"use client";

import { label, useData } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import type { Template } from "./email-model";

export function ComposerTemplateFields({
  matter,
  side,
  packageCode,
  template,
  chooseTemplate,
  recipientName,
  setRecipientName,
  bound,
  fill,
}: {
  matter: string;
  side?: string;
  packageCode?: string;
  template: string;
  chooseTemplate: (id: string) => void;
  recipientName: string;
  setRecipientName: (value: string) => void;
  bound: boolean;
  fill: () => void;
}) {
  const templates = useData<Template[]>("/api/v1/communications/templates");
  const mergeFields = useData<
    { key: string; label: string; value: string | null; status: string }[]
  >(
    `/api/v1/communications/merge-fields?matterId=${encodeURIComponent(matter)}`,
  );
  return (
    <>
      {matter && (
        <details style={{ margin: "18px 0" }}>
          <summary className={s.fieldHint} style={{ cursor: "pointer" }}>
            Start with an email template
          </summary>
          <div className={s.formGrid} style={{ marginTop: 15 }}>
            <label className={s.field}>
              Template
              <select
                className={s.select}
                value={template}
                disabled={bound}
                onChange={(event) => chooseTemplate(event.target.value)}
              >
                <option value="">Choose a template</option>
                {templates.data
                  ?.filter(
                    (t) =>
                      (t.side === "both" || t.side === side) &&
                      (!t.serviceGroup ||
                        t.serviceGroup ===
                          `${side}_${packageCode === "complete" ? "compliance" : "ctc"}`),
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className={s.field}>
              Recipient name for the greeting
              <input
                className={s.input}
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
              />
            </label>
          </div>
          <button
            className={s.buttonSmall}
            disabled={!template || bound}
            type="button"
            onClick={fill}
          >
            Fill template with confirmed details
          </button>
        </details>
      )}
      {matter && (
        <details style={{ margin: "15px 0" }}>
          <summary className={s.fieldHint} style={{ cursor: "pointer" }}>
            Available confirmed merge fields
          </summary>
          {mergeFields.error && <p className={s.error}>{mergeFields.error}</p>}
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Value</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {mergeFields.data?.map((f) => (
                  <tr key={f.key}>
                    <td>
                      <code>{"{{" + f.key + "}}"}</code>
                      <small>{f.label}</small>
                    </td>
                    <td>{f.value || "Not confirmed"}</td>
                    <td>{label(f.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}
