"use client";

import { useEffect, useState } from "react";
import { useLiveData } from "../../../../_components/useLiveData";
import { date, useData, mutate } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import { Composer } from "./Composer";
import { FileEmailHistory } from "./FileEmailHistory";
import type {
  Draft,
  EmailWork,
  FileEmailMessage,
  FileEmailThread,
  Template,
} from "./email-model";
import {
  defaultEmailRecipients,
  type EmailRecipient,
} from "./recipient-defaults";
import styles from "./file-email.module.css";

type Selection = {
  templateId?: string;
  draftId?: string;
  reply?: FileEmailMessage;
};

export function FileEmailWorkspace({
  matterId,
  side,
  packageCode,
  contacts = [],
  directContact,
  readOnly,
  initialTemplateId,
}: {
  matterId: string;
  side: string;
  packageCode: string;
  contacts?: readonly EmailRecipient[];
  directContact?: unknown;
  readOnly: boolean;
  initialTemplateId?: string;
}) {
  const [selection, setSelection] = useState<Selection | null>(
    initialTemplateId ? { templateId: initialTemplateId } : null,
  );
  const [workError, setWorkError] = useState("");
  const [changingWork, setChangingWork] = useState("");
  const [editorGeneration, setEditorGeneration] = useState(0);
  useEffect(() => {
    if (!initialTemplateId) return;
    setSelection({ templateId: initialTemplateId });
    setEditorGeneration((generation) => generation + 1);
  }, [initialTemplateId]);
  const encoded = encodeURIComponent(matterId);
  const templates = useData<Template[]>("/api/v1/communications/templates");
  const work = useLiveData<EmailWork[]>(
    `/api/v1/communications/work?matterId=${encoded}&view=all`,
  );
  const drafts = useLiveData<Draft[]>(
    `/api/v1/communications/drafts?matterId=${encoded}`,
  );
  const threads = useLiveData<FileEmailThread[]>(
    `/api/v1/communications/threads?matterId=${encoded}`,
  );
  const group = `${side}_${packageCode === "complete" ? "compliance" : "ctc"}`;
  const available = (templates.data || []).filter(
    (entry) =>
      (entry.side === side || entry.side === "both") &&
      (!entry.serviceGroup || entry.serviceGroup === group),
  );
  const byGroup = new Map<string, Template[]>();
  for (const entry of available) {
    const name = entry.recipientGroup || "Other templates";
    byGroup.set(name, [...(byGroup.get(name) ?? []), entry]);
  }
  const currentTemplate = available.find(
    (entry) => entry.id === selection?.templateId,
  );
  const recipients = currentTemplate
    ? defaultEmailRecipients(
        contacts,
        currentTemplate.recipientRoles ?? [],
        directContact,
        side,
      )
    : undefined;
  const sent = (drafts.data || []).filter((entry) => entry.status === "sent");
  const toSend = (work.data || []).filter((entry) => entry.toSend);
  async function refresh() {
    await Promise.all([work.refresh(), drafts.refresh(), threads.refresh()]);
  }
  function open(next: Selection) {
    setSelection(next);
    setEditorGeneration((generation) => generation + 1);
  }
  function openWork(item: EmailWork) {
    const draft = drafts.data?.find(
      (entry) => entry.workItemId === item.id && entry.status === "draft",
    );
    open({ templateId: item.templateId ?? undefined, draftId: draft?.id });
  }
  return (
    <div className={styles.workspace}>
      <section className={s.section} aria-label="Email templates and reminders">
        <div className={s.sectionHead}>
          <h2>Emails</h2>
          {!readOnly && (
            <button
              type="button"
              className={s.buttonSmall}
              onClick={() => open({})}
            >
              New email
            </button>
          )}
        </div>
        <div className={s.sectionBody}>
          {(templates.error || work.error || drafts.error || threads.error) && (
            <p role="alert" className={s.error}>
              Could not load file email.
            </p>
          )}
          {workError && (
            <p className={s.error} role="alert">
              {workError}
            </p>
          )}
          {!readOnly && toSend.length > 0 && (
            <div className={styles.group}>
              <h3>To send</h3>
              {toSend.map((item) => (
                <button
                  type="button"
                  className={styles.entry}
                  key={item.id}
                  onClick={() => openWork(item)}
                >
                  <strong>{item.title}</strong>
                  <span>
                    {item.remindOn
                      ? `Reminder ${date(item.remindOn)}`
                      : "Saved for later"}
                  </span>
                </button>
              ))}
            </div>
          )}
          {!readOnly &&
            [...byGroup.entries()].map(([recipient, entries]) => (
              <div className={styles.group} key={recipient}>
                <h3>{recipient}</h3>
                {entries.map((entry) => {
                  const status = work.data?.find(
                    (item) => item.templateId === entry.id,
                  );
                  return (
                    <div
                      key={entry.id}
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Check off ${entry.name}`}
                        checked={
                          status?.checked ??
                          !!(status?.sentAt || status?.manualCompletedAt)
                        }
                        disabled={!!changingWork || work.loading}
                        onChange={async (event) => {
                          const checked = event.target.checked;
                          setChangingWork(entry.id);
                          setWorkError("");
                          try {
                            await mutate(
                              status
                                ? `/api/v1/communications/work/${status.id}`
                                : `/api/v1/communications/matters/${matterId}/templates/${entry.id}/work`,
                              {
                                action: checked ? "manual_complete" : "uncheck",
                                expectedRevision: status?.revision ?? null,
                              },
                              status ? "PATCH" : "POST",
                            );
                            await refresh();
                          } catch (failure) {
                            setWorkError((failure as Error).message);
                          } finally {
                            setChangingWork("");
                          }
                        }}
                      />
                      <button
                        type="button"
                        className={styles.entry}
                        key={entry.id}
                        onClick={() => {
                          const existing = drafts.data?.find(
                            (draft) =>
                              draft.details?.templateId === entry.id &&
                              draft.status === "draft",
                          );
                          open({ templateId: entry.id, draftId: existing?.id });
                        }}
                      >
                        <strong>{entry.name}</strong>
                        {status?.sentAt ? (
                          <span>
                            Sent {date(status.sentAt)}
                            {status.checked === false
                              ? " · Unchecked manually"
                              : ""}
                          </span>
                        ) : status?.manualCompletedAt ? (
                          <span>
                            Checked off {date(status.manualCompletedAt)}
                          </span>
                        ) : entry.isPlaceholder ? (
                          <span>Placeholder</span>
                        ) : null}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          <FileEmailHistory
            sent={sent}
            threads={threads.data ?? []}
            reply={readOnly ? undefined : (message) => open({ reply: message })}
          />
        </div>
      </section>
      {!readOnly && selection && (
        <Composer
          key={editorGeneration}
          fixedMatterId={matterId}
          initialTemplateId={selection.templateId}
          initialDraftId={selection.draftId}
          initialRecipients={recipients}
          initialReply={selection.reply}
          onWorkChanged={refresh}
        />
      )}
    </div>
  );
}
