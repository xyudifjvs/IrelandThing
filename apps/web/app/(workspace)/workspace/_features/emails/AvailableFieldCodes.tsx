"use client";

import { useData } from "../../_components/data";
import type { CustomField } from "./CustomMergeFields";
import s from "../../_components/workspace.module.css";

export function AvailableFieldCodes() {
  const builtins = useData<{
    definitions: {
      key: string;
      label: string;
      comesFrom: string;
      source: { kind: string; reason?: string };
    }[];
  }>("/api/v1/communications/field-configuration");
  const custom = useData<CustomField[]>(
    "/api/v1/communications/custom-merge-fields",
  );
  const customKeys = new Set(custom.data?.map((field) => field.key));
  return (
    <details style={{ marginTop: 16 }}>
      <summary className={s.fieldHint}>View all available merge fields</summary>
      <p className={s.fieldHint}>
        Use a code in either the subject or body. Dates use M/D/YY. Fixed text
        keeps its line breaks.
      </p>
      {(builtins.error || custom.error) && (
        <p className={s.error} role="alert">
          {builtins.error || custom.error}
        </p>
      )}
      <dl style={{ maxHeight: 360, overflowY: "auto" }}>
        {builtins.data?.definitions
          .filter((field) => !customKeys.has(field.key))
          .map((field) => (
            <div key={field.key} style={{ marginBottom: 12 }}>
              <dt>
                <code>{`{{${field.key}}}`}</code>
              </dt>
              <dd style={{ marginLeft: 0 }}>
                {field.label}
                <small style={{ display: "block" }}>
                  {field.source.kind === "unsupported"
                    ? `Not connected: ${field.source.reason}`
                    : field.comesFrom}
                </small>
              </dd>
            </div>
          ))}
        {custom.data?.map((field) => (
          <div key={field.key} style={{ marginBottom: 12 }}>
            <dt>
              <code>{`{{${field.key}}}`}</code>
            </dt>
            <dd style={{ marginLeft: 0 }}>
              {field.label} · Settings fixed text
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
