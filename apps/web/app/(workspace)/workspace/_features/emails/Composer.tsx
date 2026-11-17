"use client";

import { useEffect, useState, useRef } from "react";
import { Mail, Save, Send } from "lucide-react";
import { useData, mutate, label, type Matter } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import MatterPicker from "../../_components/MatterPicker";
import type {
  Draft,
  EmailWork,
  FileEmailMessage,
  Template,
} from "./email-model";
import {
  defaultEmailRecipients,
  emailRoleFamily,
  recipientGreeting,
  type EmailRecipient,
} from "./recipient-defaults";
import { ComposerTemplateFields } from "./ComposerTemplateFields";
import { AvailableFieldCodes } from "./AvailableFieldCodes";
import { tomorrow } from "./EmailWorkControls";
import {
  addresses,
  AddEmailRecipientToDeal,
  RecipientField,
} from "./EmailRecipients";
import { EmailAttachmentUpload } from "./EmailAttachmentUpload";
import type { FilePerson } from "../people/PeopleOnFilePanel";

export function Composer({
  fixedMatterId,
  initialTemplateId,
  initialDraftId,
  initialRecipients,
  initialReply,
  onWorkChanged,
}: {
  fixedMatterId?: string;
  initialTemplateId?: string;
  initialDraftId?: string;
  initialRecipients?: EmailRecipient[];
  initialReply?: FileEmailMessage;
  onWorkChanged?: () => Promise<void>;
} = {}) {
  const users =
    useData<{ id: string; name: string; email: string; role: string }[]>(
      "/api/v1/users",
    );
  const integrations = useData<{ provider: string; status: string }[]>(
    "/api/v1/integrations",
  );
  const [binding, setBinding] = useState<{
    id: string;
    revision: number;
    recipientName: string;
    previewFingerprint?: string;
    customValues: Record<string, string>;
  } | null>(null);
  const [matter, setMatter] = useState(fixedMatterId || "");
  const detail = useData<
    Matter & { contacts?: FilePerson[]; checklistVersion?: number | null }
  >(matter ? `/api/v1/matters/${encodeURIComponent(matter)}` : null);
  const currentMatter = useRef(matter);
  currentMatter.current = matter;
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [newPersonEmail, setNewPersonEmail] = useState("");
  const drafts = useData<Draft[]>(
    `/api/v1/communications/drafts${matter ? "?matterId=" + encodeURIComponent(matter) : ""}`,
  );
  const work = useData<EmailWork[]>(
    matter
      ? `/api/v1/communications/work?matterId=${encodeURIComponent(matter)}&view=all`
      : null,
  );
  const [remindOn, setRemindOn] = useState("");
  const [preview, setPreview] = useState<{
    key: string;
    subject: string;
    body: string;
    missingFields: string[];
    fingerprint?: string;
  } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [replyToMessageId, setReplyToMessageId] = useState(initialReply?.id);
  const [to, setTo] = useState(initialReply?.fromEmail ?? ""),
    [cc, setCc] = useState(""),
    [subject, setSubject] = useState(
      initialReply
        ? /^re:/i.test(initialReply.subject)
          ? initialReply.subject
          : `Re: ${initialReply.subject}`
        : "",
    ),
    [body, setBody] = useState(""),
    [attachments, setAttachments] = useState<string[]>([]);
  const [busy, setBusyState] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [dirty, setDirty] = useState(true),
    [confirmed, setConfirmed] = useState(false),
    [template, setTemplate] = useState(initialTemplateId || ""),
    [recipientName, setRecipientName] = useState("");
  const previewKey = JSON.stringify([matter, subject, body, customValues]);
  useEffect(() => {
    if (!matter) {
      setPreview(null);
      return;
    }
    let current = true;
    setPreviewError("");
    if (!/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(subject + body)) {
      setPreview({ key: previewKey, subject, body, missingFields: [] });
      return;
    }
    const timer = setTimeout(() => {
      void mutate<{
        subject: string;
        body: string;
        missingFields: string[];
        fingerprint: string;
      }>("/api/v1/communications/render-fields", {
        matterId: matter,
        subject,
        body,
        values: customValues,
      })
        .then((filled) => {
          if (current) setPreview({ key: previewKey, ...filled });
        })
        .catch((failure) => {
          if (current) {
            setPreview(null);
            setPreviewError((failure as Error).message);
          }
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [matter, subject, body, customValues, previewKey]);
  const reminderLoaded = useRef("");
  useEffect(() => {
    if (!draft?.workItemId || !work.data || reminderLoaded.current === draft.id)
      return;
    const saved = work.data.find((item) => item.id === draft.workItemId);
    if (saved) {
      setRemindOn(saved.remindOn || "");
      reminderLoaded.current = draft.id;
    }
  }, [draft, work.data]);
  const customValuesChanged =
    !!binding &&
    JSON.stringify(binding.customValues) !== JSON.stringify(customValues);
  const sameSavedTemplate =
    draft?.status === "draft" &&
    !!template &&
    template === draft.details?.templateId;
  const replaceSavedWording = sameSavedTemplate && customValuesChanged;
  const enteredRecipients = useRef<string[]>([]);
  const busyRef = useRef(false);
  function setBusy(value: boolean) {
    busyRef.current = value;
    setBusyState(value);
  }
  const connected = integrations.data?.some(
    (i) => i.provider === "gmail" && i.status === "connected",
  );
  const servingAgent = users.data?.find(
    (user) => user.id === detail.data?.agentId,
  );
  const throughAgent = detail.data?.details?.directContact !== "copy_agent";
  const canonicalPeople = detail.data?.contacts ?? [];
  const legacyPeople =
    detail.data?.checklistVersion == null && canonicalPeople.length === 0
      ? ([
          ...(Array.isArray(detail.data?.details?.contacts)
            ? detail.data.details.contacts
            : []),
          ...(Array.isArray(detail.data?.details?.clients)
            ? detail.data.details.clients.map((contact) => ({
                ...contact,
                role: "client",
              }))
            : []),
        ] as { name?: string; email?: string; role?: string }[])
      : [];
  const suggestions = [...canonicalPeople, ...legacyPeople].filter(
    (person) =>
      person.email &&
      (!throughAgent || emailRoleFamily(person.role ?? "") !== "client"),
  );
  const clientEmails = [...canonicalPeople, ...legacyPeople]
    .filter((person) => emailRoleFamily(person.role ?? "") === "client")
    .map((person) => person.email?.toLowerCase())
    .filter(Boolean)
    .join(",");
  useEffect(() => {
    if (throughAgent || !servingAgent?.email) return;
    const selected = addresses(to + "," + cc),
      clients = addresses(clientEmails);
    if (
      !clients.some((email) => selected.includes(email)) ||
      selected.includes(servingAgent.email.toLowerCase())
    )
      return;
    setCc(addresses(cc + "," + servingAgent.email).join(", "));
    setDirty(true);
    setConfirmed(false);
  }, [to, cc, clientEmails, throughAgent, servingAgent?.email]);
  const existingEmails = new Set(
    [
      ...canonicalPeople.map((person) => person.email),
      ...legacyPeople.map((person) => person.email),
      servingAgent?.email,
    ]
      .filter((email): email is string => !!email)
      .map((email) => email.toLowerCase()),
  );
  const editablePeople =
    !!detail.data &&
    ["under_contract", "closing", "listing"].includes(detail.data.stage ?? "");
  useEffect(() => {
    if (fixedMatterId) return;
    const value = new URLSearchParams(window.location.search).get("matterId");
    if (value) setMatter(value);
  }, [fixedMatterId]);
  useEffect(() => {
    function receive(event: Event) {
      const value = (
        event as CustomEvent<{
          matterId: string;
          subject: string;
          body: string;
        }>
      ).detail;
      if (
        !value?.matterId ||
        busyRef.current ||
        (fixedMatterId && value.matterId !== fixedMatterId)
      )
        return;
      setMatter(value.matterId);
      setDraft(null);
      setReplyToMessageId(undefined);
      setTemplate("");
      setBinding(null);
      setCustomValues({});
      setRecipientName("");
      setNewPersonEmail("");
      setTo("");
      setCc("");
      enteredRecipients.current = [];
      setSubject(value.subject);
      setBody(value.body);
      setAttachments([]);
      setDirty(true);
      setConfirmed(false);
      setMessage(
        "Suggested text is ready in a new unsaved draft. Choose recipients and review every detail before saving.",
      );
    }
    window.addEventListener("weatherly:suggested-draft", receive);
    return () =>
      window.removeEventListener("weatherly:suggested-draft", receive);
  }, [fixedMatterId]);
  const edit = (setter: (v: string) => void, v: string) => {
    setter(v);
    setDirty(true);
    setConfirmed(false);
  };
  function changeRecipients(
    field: "to" | "cc",
    value: string,
    entered: string[] = [],
  ) {
    const remaining = addresses(value + "," + (field === "to" ? cc : to));
    enteredRecipients.current = [
      ...new Set([...enteredRecipients.current, ...entered]),
    ].filter((address) => remaining.includes(address));
    edit(field === "to" ? setTo : setCc, value);
  }
  function loadDraft(d: Draft, preserveEnvelope = false) {
    if (!preserveEnvelope) {
      enteredRecipients.current = [];
      setTo(d.to.join(", "));
      setCc(d.cc.join(", "));
      setAttachments(d.attachmentIds || []);
      setDirty(false);
    }
    setDraft(d);
    const savedCustomValues = { ...(d.details?.templateValues ?? {}) };
    setCustomValues(savedCustomValues);
    setReplyToMessageId(undefined);
    setMatter(d.matterId);
    setNewPersonEmail("");
    setSubject(d.details?.authoredMerge?.subjectSource ?? d.subject);
    setBody(d.details?.authoredMerge?.bodySource ?? d.body);
    setTemplate(d.details?.templateId || "");
    setRecipientName(d.details?.templateValues?.recipientName || "");
    setBinding(
      d.details?.templateId && d.details.templateRevision
        ? {
            id: d.details.templateId,
            revision: d.details.templateRevision,
            previewFingerprint: d.details.templatePreviewFingerprint,
            recipientName: d.details.templateValues?.recipientName || "",
            customValues: savedCustomValues,
          }
        : null,
    );
    setConfirmed(false);
    setMessage("");
    setError("");
  }
  const openedDraft = useRef(false);
  useEffect(() => {
    if (!initialDraftId || openedDraft.current) return;
    const initial = drafts.data?.find((entry) => entry.id === initialDraftId);
    if (initial) {
      openedDraft.current = true;
      loadDraft(initial);
    }
  }, [drafts.data, initialDraftId]);

  const defaultsReady = initialRecipients !== undefined;
  const defaultTemplateApplied = useRef(false);
  const defaultRecipientName = recipientGreeting(initialRecipients ?? []);
  const defaultRecipientEmail = (initialRecipients ?? [])
    .map(({ email }) => email)
    .join(", ");
  useEffect(() => {
    if (
      !initialTemplateId ||
      initialDraftId ||
      !fixedMatterId ||
      !defaultsReady ||
      defaultTemplateApplied.current
    )
      return;
    let current = true;
    busyRef.current = true;
    setBusyState(true);
    void mutate<{
      subject: string;
      body: string;
      templateId: string;
      templateRevision: number;
      missingFields?: string[];
      previewFingerprint: string;
    }>(`/api/v1/communications/templates/${initialTemplateId}/render`, {
      matterId: fixedMatterId,
      values: defaultRecipientName
        ? { recipientName: defaultRecipientName }
        : {},
    })
      .then((rendered) => {
        if (!current) return;
        defaultTemplateApplied.current = true;
        setSubject(rendered.subject);
        setBody(rendered.body);
        setTo(defaultRecipientEmail);
        setRecipientName(defaultRecipientName);
        setBinding({
          id: rendered.templateId,
          revision: rendered.templateRevision,
          previewFingerprint: rendered.previewFingerprint,
          recipientName: defaultRecipientName,
          customValues: {},
        });
        if (rendered.missingFields?.length)
          setMessage("Fill in or remove the blank fields before sending.");
      })
      .catch((failure: Error) => {
        if (current) setError(failure.message);
      })
      .finally(() => {
        if (!current) return;
        busyRef.current = false;
        setBusyState(false);
      });
    return () => {
      current = false;
    };
  }, [
    initialTemplateId,
    initialDraftId,
    fixedMatterId,
    defaultsReady,
    defaultRecipientName,
    defaultRecipientEmail,
  ]);
  function chooseTemplate(next: Template | undefined) {
    setTemplate(next?.id || "");
    setBinding(null);
    setCustomValues({});
    if (!next || draft || to) return;
    const people = [
      ...suggestions,
      ...(servingAgent ? [{ ...servingAgent, role: "agent" }] : []),
    ].filter((person): person is EmailRecipient =>
      Boolean(person.email && person.name && person.role),
    );
    const recipients = defaultEmailRecipients(
      people,
      next.recipientRoles ?? [],
      detail.data?.details?.directContact,
      detail.data?.side,
    );
    edit(setTo, recipients.map(({ email }) => email).join(", "));
    setRecipientName(recipientGreeting(recipients));
  }
  async function fillTemplate() {
    if (busyRef.current) return;
    setBusy(true);
    setError("");
    try {
      if (draft) {
        const rebound = await mutate<Draft>(
          `/api/v1/communications/drafts/${draft.id}/reset-template`,
          {
            expectedRevision: draft.revision,
            ...(replaceSavedWording ? {} : { templateId: template }),
            values: {
              ...customValues,
              ...(recipientName ? { recipientName } : {}),
            },
          },
        );
        const preserveEnvelope = replaceSavedWording && dirty;
        loadDraft(rebound, preserveEnvelope);
        await drafts.refresh();
        await onWorkChanged?.();
        setMessage(
          preserveEnvelope
            ? "Template refilled. Review the wording and save your draft changes."
            : "Template updated. Review the saved wording before sending.",
        );
        return;
      }
      const result = await mutate<{
        subject: string;
        body: string;
        templateId: string;
        templateRevision: number;
        missingFields: string[];
        previewFingerprint: string;
      }>(`/api/v1/communications/templates/${template}/render`, {
        matterId: matter,
        values: {
          ...customValues,
          ...(recipientName ? { recipientName } : {}),
        },
      });
      setSubject(result.subject);
      setBody(result.body);
      setBinding({
        id: result.templateId,
        revision: result.templateRevision,
        previewFingerprint: result.previewFingerprint,
        recipientName,
        customValues: { ...customValues },
      });
      setMessage(
        result.missingFields?.length
          ? "Fill in or remove the blank fields before sending."
          : "",
      );
      setDirty(true);
      setConfirmed(false);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save(sendNow = false) {
    if (busyRef.current) return;
    if (draft && customValuesChanged) {
      setError(
        "Apply the template again to include your current merge field values.",
      );
      return;
    }
    if (
      !draft &&
      template &&
      (!binding ||
        binding.recipientName !== recipientName ||
        JSON.stringify(binding.customValues) !== JSON.stringify(customValues))
    ) {
      setError(
        "Apply the template again to include your current merge field values.",
      );
      return;
    }
    if (
      sendNow &&
      (!confirmed ||
        !preview ||
        preview.key !== previewKey ||
        preview.missingFields.length ||
        !preview.subject.trim() ||
        !preview.body.trim() ||
        !addresses(to).length)
    ) {
      setError(
        "Review the filled preview and complete the recipients and message before sending.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const values = {
        saveForLater: !sendNow,
        ...(!sendNow ? { remindOn: remindOn || null } : {}),
        ...(preview?.key === previewKey && preview.fingerprint
          ? { fieldPreviewFingerprint: preview.fingerprint }
          : {}),
        enteredRecipients: enteredRecipients.current,
        ...(draft ? {} : { matterId: matter }),
        to: addresses(to),
        cc: addresses(cc),
        subject,
        body,
        attachmentIds: attachments,
        ...(!draft && replyToMessageId ? { replyToMessageId } : {}),
        ...(!draft && binding
          ? {
              templateId: binding.id,
              templateRevision: binding.revision,
              ...(binding.previewFingerprint
                ? { templatePreviewFingerprint: binding.previewFingerprint }
                : {}),
              templateValues: {
                ...binding.customValues,
                ...(binding.recipientName
                  ? { recipientName: binding.recipientName }
                  : {}),
              },
            }
          : {}),
      };
      const saved = await mutate<Draft>(
        `/api/v1/communications/drafts${draft ? "/" + draft.id : ""}`,
        draft ? { expectedRevision: draft.revision, ...values } : values,
        draft ? "PATCH" : "POST",
      );
      if (
        sendNow &&
        (JSON.stringify(addresses(saved.to.join(","))) !==
          JSON.stringify(addresses(to)) ||
          JSON.stringify(addresses(saved.cc.join(","))) !==
            JSON.stringify(addresses(cc)))
      ) {
        loadDraft(saved);
        await drafts.refresh();
        await onWorkChanged?.();
        setMessage(
          "The saved contact instructions updated the recipients. Review the displayed recipients and click Send when ready.",
        );
        return;
      }
      if (sendNow) {
        // Saving alone never sends; only this explicit Send action queues delivery.
        setDraft(saved);
        const queued = await mutate<Draft>(
          `/api/v1/communications/drafts/${saved.id}/send`,
          { revision: saved.revision, confirmed: true },
        );
        loadDraft(queued);
      } else loadDraft(saved);
      await work.refresh();
      await drafts.refresh();
      await onWorkChanged?.();
      setMessage(
        sendNow
          ? "Email queued. Delivery status will update in the template list and history."
          : "Saved for later with your edits. Nothing has been sent.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={s.section} style={{ marginTop: 5 }}>
      <div className={s.sectionHead}>
        <div>
          <h2>Compose an email</h2>
          <p>
            Drafts are sent only after your approval. Follow the contact
            instructions saved for this transaction.
          </p>
        </div>
        <Mail size={19} strokeWidth={1.3} />
      </div>
      <div className={s.sectionBody}>
        <fieldset
          disabled={busy}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <div className={s.formGrid}>
            {!fixedMatterId && (
              <MatterPicker
                value={matter}
                onChange={(value) => {
                  setMatter(value);
                  setTo("");
                  setCc("");
                  enteredRecipients.current = [];
                  setSubject("");
                  setBody("");
                  setRecipientName("");
                  setNewPersonEmail("");
                  setTemplate("");
                  setBinding(null);
                  setCustomValues({});
                  setDraft(null);
                  setReplyToMessageId(undefined);
                  setDirty(true);
                  setAttachments([]);
                  setConfirmed(false);
                }}
              />
            )}
          </div>
          {!fixedMatterId &&
            !!drafts.data?.some((entry) => entry.status === "draft") && (
              <details style={{ marginTop: 16 }}>
                <summary>Saved emails</summary>
                <div style={{ maxHeight: 220, overflowY: "auto" }}>
                  {drafts.data
                    .filter((entry) => entry.status === "draft")
                    .map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={s.buttonSmall}
                        onClick={() => loadDraft(entry)}
                      >
                        {entry.subject || "Untitled email"}
                      </button>
                    ))}
                </div>
              </details>
            )}
          {matter && (
            <ComposerTemplateFields
              matter={matter}
              side={detail.data?.side}
              packageCode={detail.data?.packageCode}
              template={template}
              chooseTemplate={chooseTemplate}
              recipientName={recipientName}
              setRecipientName={setRecipientName}
              customValues={customValues}
              setCustomValues={(values) => {
                setCustomValues(values);
                setConfirmed(false);
              }}
              disabled={
                !!draft &&
                (!draft.details?.templateId ||
                  dirty ||
                  draft.status !== "draft")
              }
              rebind={!!draft}
              customFieldsEditable={sameSavedTemplate}
              replaceSavedWording={replaceSavedWording}
              fill={() => void fillTemplate()}
            />
          )}
          {detail.data && (
            <p className={s.notice}>
              Client contact:{" "}
              {throughAgent
                ? "Only through the agent. Direct client sending is restricted."
                : "Copy the agent on direct client communication."}
            </p>
          )}
          <div style={{ display: "grid", gap: 0 }} key={`recipients:${matter}`}>
            <RecipientField
              people={[
                ...(servingAgent ? [{ ...servingAgent, role: "agent" }] : []),
                ...suggestions,
              ]}
              title="To"
              value={to}
              change={(value, entered) =>
                changeRecipients("to", value, entered)
              }
              addToDeal={editablePeople ? setNewPersonEmail : undefined}
              existingEmails={existingEmails}
              searchDirectory={editablePeople}
            />
            <RecipientField
              people={[
                ...(servingAgent ? [{ ...servingAgent, role: "agent" }] : []),
                ...suggestions,
              ]}
              title="Cc"
              value={cc}
              change={(value, entered) =>
                changeRecipients("cc", value, entered)
              }
              addToDeal={editablePeople ? setNewPersonEmail : undefined}
              existingEmails={existingEmails}
            />
          </div>
          {newPersonEmail && editablePeople && (
            <AddEmailRecipientToDeal
              key={matter + ":" + newPersonEmail}
              matterId={matter}
              email={newPersonEmail}
              people={canonicalPeople}
              close={() => setNewPersonEmail("")}
              saved={() => {
                setNewPersonEmail("");
                setConfirmed(false);
                void detail.refresh();
              }}
            />
          )}
          {editablePeople && (
            <EmailAttachmentUpload
              key={`attachments:${matter}`}
              matterId={matter}
              refresh={detail.refresh}
              attach={(id) => {
                if (currentMatter.current !== matter) return;
                setAttachments((previous) => [...new Set([...previous, id])]);
                setDirty(true);
                setConfirmed(false);
              }}
            />
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save(true);
            }}
          >
            <label className={s.field} style={{ marginTop: 18 }}>
              Subject
              <input
                className={s.input}
                value={subject}
                onChange={(e) => edit(setSubject, e.target.value)}
              />
            </label>
            <label className={s.field} style={{ marginTop: 18 }}>
              Message
              <textarea
                className={s.textarea}
                style={{ minHeight: 200 }}
                value={body}
                onChange={(e) => edit(setBody, e.target.value)}
              />
            </label>
            {detail.data?.documents?.length ? (
              <fieldset
                style={{
                  border: "1px solid #e3d6c1",
                  padding: 15,
                  marginTop: 18,
                }}
              >
                <legend className={s.fieldHint}>
                  Attachments from this file
                </legend>
                {detail.data.documents.map((d) => (
                  <label className={s.todo} key={d.id}>
                    <input
                      type="checkbox"
                      checked={attachments.includes(d.id)}
                      onChange={(e) => {
                        setAttachments((v) =>
                          e.target.checked
                            ? [...v, d.id]
                            : v.filter((x) => x !== d.id),
                        );
                        setDirty(true);
                        setConfirmed(false);
                      }}
                    />
                    {d.name || d.filename}
                  </label>
                ))}
              </fieldset>
            ) : null}
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
            <AvailableFieldCodes />
            <section
              aria-label="Filled email preview"
              style={{
                marginTop: 18,
                border: "1px solid var(--line)",
                padding: 15,
              }}
            >
              <h3>Filled preview</h3>
              {previewError ? (
                <p className={s.error} role="alert">
                  {previewError}
                </p>
              ) : preview?.key === previewKey ? (
                <>
                  <strong>{preview.subject || "No subject yet"}</strong>
                  <div
                    style={{
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      marginTop: 12,
                    }}
                  >
                    {preview.body || "No message yet"}
                  </div>
                  {!!preview.missingFields.length && (
                    <p className={s.error}>
                      Fill or remove:{" "}
                      {preview.missingFields
                        .map((key) => `{{${key}}}`)
                        .join(", ")}
                    </p>
                  )}
                </>
              ) : (
                <p role="status">Updating preview…</p>
              )}
            </section>
            {draft?.details?.reviewNeeded && (
              <p className={s.notice}>
                The transaction changed. Review the wording, recipients and
                attachments again.
                {draft.details.mergeError ? ` ${draft.details.mergeError}` : ""}
              </p>
            )}
            {draft?.details?.sendFailure && (
              <p className={s.notice}>
                The previous delivery stopped. Review before sending again.
              </p>
            )}
            <label className={s.todo} style={{ marginTop: 18 }}>
              <input
                type="checkbox"
                checked={confirmed}
                disabled={preview?.key !== previewKey}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I reviewed the filled message, recipients, contact permissions and
              attachments.
            </label>
            <div
              className={s.formRow}
              style={{ marginTop: 16, flexWrap: "wrap" }}
            >
              <button
                className={s.button}
                type="submit"
                disabled={
                  busy ||
                  !matter ||
                  !connected ||
                  !confirmed ||
                  preview?.key !== previewKey ||
                  !!preview?.missingFields.length ||
                  !subject.trim() ||
                  !body.trim() ||
                  !addresses(to).length ||
                  [
                    "queued",
                    "sending",
                    "sent",
                    "delivery_unknown",
                    "cancelled",
                  ].includes(draft?.status || "")
                }
              >
                <Send />
                Send
              </button>
              <label className={s.field}>
                Remind me
                <input
                  className={s.input}
                  type="date"
                  value={remindOn}
                  onChange={(event) => setRemindOn(event.target.value)}
                />
              </label>
              <button
                className={s.buttonSmall}
                type="button"
                onClick={() => setRemindOn(tomorrow())}
              >
                Tomorrow
              </button>
              <button
                className={s.buttonSecondary}
                type="button"
                disabled={
                  busy ||
                  !matter ||
                  [
                    "queued",
                    "sending",
                    "sent",
                    "delivery_unknown",
                    "cancelled",
                  ].includes(draft?.status || "")
                }
                onClick={() => void save(false)}
              >
                <Save />
                Save for later
              </button>
            </div>
          </form>
          {!connected && (
            <div className={s.notice}>
              Gmail is not connected to an approved mailbox. You can prepare
              drafts; sending stays disabled until the connection is authorized.
            </div>
          )}
        </fieldset>{" "}
      </div>
    </section>
  );
}
