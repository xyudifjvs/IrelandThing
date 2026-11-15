"use client";

import { useEffect, useState, useRef } from "react";
import { Mail, Save } from "lucide-react";
import { useData, mutate, label, type Matter } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import MatterPicker from "../../_components/MatterPicker";
import type { Draft, FileEmailMessage, Template } from "./email-model";
import {
  defaultEmailRecipients,
  emailRoleFamily,
  recipientGreeting,
  type EmailRecipient,
} from "./recipient-defaults";
import { ComposerTemplateFields } from "./ComposerTemplateFields";
import { DraftApproval } from "./DraftApproval";
import { EmailWorkControls } from "./EmailWorkControls";
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
    const savedCustomValues = Object.fromEntries(
      Object.entries(d.details?.templateValues ?? {}).filter(([key]) =>
        key.startsWith("custom_"),
      ),
    );
    setCustomValues(savedCustomValues);
    setReplyToMessageId(undefined);
    setMatter(d.matterId);
    setNewPersonEmail("");
    setSubject(d.subject);
    setBody(d.body);
    setTemplate(d.details?.templateId || "");
    setRecipientName(d.details?.templateValues?.recipientName || "");
    setBinding(
      d.details?.templateId && d.details.templateRevision
        ? {
            id: d.details.templateId,
            revision: d.details.templateRevision,
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

  async function save() {
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
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const values = {
        ...(draft
          ? {}
          : { matterId: matter, enteredRecipients: enteredRecipients.current }),
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
      loadDraft(saved);
      await drafts.refresh();
      await onWorkChanged?.();
      setMessage(
        "Draft saved. Review the recipients, message and attachments before sending.",
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
            <label className={s.field}>
              Existing draft
              <select
                className={s.select}
                value={draft?.id || ""}
                onChange={(e) => {
                  const selected = drafts.data?.find(
                    (d) => d.id === e.target.value,
                  );
                  if (selected) loadDraft(selected);
                  else {
                    setDraft(null);
                    setReplyToMessageId(undefined);
                    setTemplate("");
                    setBinding(null);
                    setCustomValues({});
                    setRecipientName("");
                    setTo("");
                    setCc("");
                    enteredRecipients.current = [];
                    setSubject("");
                    setBody("");
                    setAttachments([]);
                    setDirty(true);
                  }
                }}
              >
                <option value="">Write a new draft</option>
                {drafts.data
                  ?.filter((d) => !["sent", "queued"].includes(d.status))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.subject || "Untitled draft"}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {fixedMatterId && (
            <EmailWorkControls
              matterId={fixedMatterId}
              workItemId={draft?.workItemId}
              templateId={binding?.id ?? (template || undefined)}
              refresh={onWorkChanged}
            />
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
          {detail.data && (
            <div style={{ margin: "18px 0" }}>
              <p className={s.fieldHint}>People saved on this deal</p>
              <div className={s.formRow} style={{ flexWrap: "wrap" }}>
                {servingAgent && (
                  <button
                    type="button"
                    className={s.buttonSmall}
                    onClick={() => {
                      const previous = throughAgent ? to : cc;
                      edit(
                        throughAgent ? setTo : setCc,
                        addresses(previous + "," + servingAgent.email).join(
                          ", ",
                        ),
                      );
                    }}
                  >
                    {throughAgent ? "To agent · " : "CC agent · "}
                    {servingAgent.name}
                  </button>
                )}
                {suggestions.map((person, index) => (
                  <button
                    type="button"
                    className={s.buttonSmall}
                    key={person.email + ":" + index}
                    onClick={() =>
                      edit(setTo, addresses(to + "," + person.email).join(", "))
                    }
                  >
                    {person.name || person.email}
                    {person.role ? " · " + label(person.role) : ""}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className={s.formGrid} key={`recipients:${matter}`}>
            <RecipientField
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
              title="CC"
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
              void save();
            }}
          >
            <label className={s.field} style={{ marginTop: 18 }}>
              Subject
              <input
                className={s.input}
                value={subject}
                onChange={(e) => edit(setSubject, e.target.value)}
                required
              />
            </label>
            <label className={s.field} style={{ marginTop: 18 }}>
              Message
              <textarea
                className={s.textarea}
                style={{ minHeight: 200 }}
                value={body}
                onChange={(e) => edit(setBody, e.target.value)}
                required
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
            <button
              className={s.buttonSecondary}
              style={{ marginTop: 20 }}
              disabled={
                busy ||
                !matter ||
                (!!draft && customValuesChanged) ||
                addresses(to).length === 0 ||
                (!draft &&
                  !!template &&
                  (!binding ||
                    binding.recipientName !== recipientName ||
                    JSON.stringify(binding.customValues) !==
                      JSON.stringify(customValues))) ||
                ["queued", "sent"].includes(draft?.status || "")
              }
            >
              <Save />
              {busy ? "Saving…" : "Save reviewed draft"}
            </button>
          </form>
          {draft && (
            <DraftApproval
              draft={draft}
              matter={matter}
              dirty={dirty || customValuesChanged}
              confirmed={confirmed}
              connected={!!connected}
              busy={busy}
              recipientName={recipientName}
              setBusy={setBusy}
              setError={setError}
              setMessage={setMessage}
              setConfirmed={setConfirmed}
              setDraft={setDraft}
              loadDraft={loadDraft}
              refresh={drafts.refresh}
              onWorkChanged={onWorkChanged}
            />
          )}
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
