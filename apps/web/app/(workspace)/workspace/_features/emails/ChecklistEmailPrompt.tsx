"use client";

import { useState } from "react";
import { mutate, useData } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import type { EmailWork, Template } from "./email-model";

/** Mount after Ireland checks off a step. Rendering the prompt does not queue anything. */
export function ChecklistEmailPrompt({
  matterId,
  stepKey,
  side,
  packageCode,
  openTemplate,
}: {
  matterId: string;
  stepKey: string;
  side: string;
  packageCode: string;
  openTemplate: (templateId: string) => void;
}) {
  const templates = useData<Template[]>("/api/v1/communications/templates");
  const work = useData<EmailWork[]>(
    `/api/v1/communications/work?matterId=${encodeURIComponent(matterId)}&view=all`,
  );
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const group = `${side}_${packageCode === "complete" ? "compliance" : "ctc"}`;
  if (!templates.data || !work.data) return null;
  const candidates = templates.data.filter((template) => {
    const existing = work.data?.find((item) => item.templateId === template.id);
    return (
      template.linkedStepKey === stepKey &&
      (template.side === side || template.side === "both") &&
      (!template.serviceGroup || template.serviceGroup === group) &&
      !dismissed.includes(template.id) &&
      !existing?.sentAt &&
      !existing?.manualCompletedAt
    );
  });

  function skip(id: string) {
    setDismissed((previous) => [...previous, id]);
  }
  async function later(templateId: string) {
    setBusy(templateId);
    setError("");
    try {
      const existing = work.data?.find(
        (item) => item.templateId === templateId,
      );
      await mutate(
        `/api/v1/communications/matters/${matterId}/templates/${templateId}/work`,
        {
          action: "later",
          expectedRevision: existing?.revision ?? null,
        },
      );
      skip(templateId);
      await work.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not add this email to To send.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {candidates.map((template) => (
        <div className={s.notice} key={template.id}>
          <p>Send the {template.name} email?</p>
          <div className={s.actions}>
            <button
              type="button"
              className={s.buttonSmall}
              disabled={!!busy}
              onClick={() => {
                skip(template.id);
                openTemplate(template.id);
              }}
            >
              Send now
            </button>
            <button
              type="button"
              className={s.buttonSmall}
              disabled={!!busy}
              onClick={() => void later(template.id)}
            >
              Later
            </button>
            <button
              type="button"
              className={s.buttonSmall}
              disabled={!!busy}
              onClick={() => skip(template.id)}
            >
              Skip
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
