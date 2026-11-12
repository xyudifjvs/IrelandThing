"use client";

import { useEffect, useState, useRef } from "react";
import { Mail, Send, Save } from "lucide-react";
import {
  api,
  useData,
  mutate,
  label,
  type Matter,
} from "../../_components/data";
import s from "../../_components/workspace.module.css";
import MatterPicker from "../../_components/MatterPicker";
import type { Template, Draft } from "./email-model";
import { EmailWorkControls } from "./EmailWorkControls";

export function Composer({
  fixedMatterId,
  initialTemplateId,
  initialDraftId,
  initialRecipient,
  onWorkChanged,
}: {
  fixedMatterId?: string;
  initialTemplateId?: string;
  initialDraftId?: string;
  initialRecipient?: { name: string; email: string };
  onWorkChanged?: () => Promise<void>;
} = {}) {
  const users =
    useData<{ id: string; name: string; email: string; role: string }[]>(
      "/api/v1/users",
    );
  const templates = useData<Template[]>("/api/v1/communications/templates");
  const integrations = useData<{ provider: string; status: string }[]>(
    "/api/v1/integrations",
  );
  const [binding, setBinding] = useState<{
    id: string;
    revision: number;
    recipientName: string;
  } | null>(null);
  const [matter, setMatter] = useState(fixedMatterId || "");
  const detail = useData<Matter>(matter ? `/api/v1/matters/${matter}` : null);
  const mergeFields = useData<
    { key: string; label: string; value: string | null; status: string }[]
  >(
    matter
      ? `/api/v1/communications/merge-fields?matterId=${encodeURIComponent(matter)}`
      : null,
  );
  const drafts = useData<Draft[]>(
    `/api/v1/communications/drafts${matter ? "?matterId=" + encodeURIComponent(matter) : ""}`,
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [to, setTo] = useState(""),
    [cc, setCc] = useState(""),
    [subject, setSubject] = useState(""),
    [body, setBody] = useState(""),
    [attachments, setAttachments] = useState<string[]>([]);
  const [busy, setBusyState] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [dirty, setDirty] = useState(true),
    [confirmed, setConfirmed] = useState(false),
    [template, setTemplate] = useState(initialTemplateId || ""),
    [recipientName, setRecipientName] = useState(initialRecipient?.name || "");
  const busyRef = useRef(false);
  function setBusy(value: boolean) {
    busyRef.current = value;
    setBusyState(value);
  }
  const connected = integrations.data?.some(
    (i) => i.provider === "gmail" && i.status === "connected",
  );
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
      setTemplate("");
      setBinding(null);
      setRecipientName("");
      setTo("");
      setCc("");
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
  function loadDraft(d: Draft) {
    setDraft(d);
    setMatter(d.matterId);
    setTo(d.to.join(", "));
    setCc(d.cc.join(", "));
    setSubject(d.subject);
    setBody(d.body);
    setAttachments(d.attachmentIds || []);
    setTemplate(d.details?.templateId || "");
    setRecipientName(d.details?.templateValues?.recipientName || "");
    setBinding(
      d.details?.templateId && d.details.templateRevision
        ? {
            id: d.details.templateId,
            revision: d.details.templateRevision,
            recipientName: d.details.templateValues?.recipientName || "",
          }
        : null,
    );
    setDirty(false);
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

  const defaultRecipientName = initialRecipient?.name ?? "";
  const defaultRecipientEmail = initialRecipient?.email ?? "";
  useEffect(() => {
    if (!initialTemplateId || initialDraftId || !fixedMatterId) return;
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
        setSubject(rendered.subject);
        setBody(rendered.body);
        setTo(defaultRecipientEmail);
        setBinding({
          id: rendered.templateId,
          revision: rendered.templateRevision,
          recipientName: defaultRecipientName,
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
    defaultRecipientName,
    defaultRecipientEmail,
  ]);
  async function save() {
    if (busyRef.current) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const values = {
        ...(draft ? {} : { matterId: matter }),
        to: to
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        cc: cc
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        subject,
        body,
        attachmentIds: attachments,
        ...(!draft && binding
          ? {
              templateId: binding.id,
              templateRevision: binding.revision,
              templateValues: binding.recipientName
                ? { recipientName: binding.recipientName }
                : {},
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
                  setSubject("");
                  setBody("");
                  setRecipientName("");
                  setTemplate("");
                  setBinding(null);
                  setDraft(null);
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
                    setTemplate("");
                    setBinding(null);
                    setRecipientName("");
                    setTo("");
                    setCc("");
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
                    disabled={!!draft}
                    onChange={(e) => {
                      setTemplate(e.target.value);
                      setBinding(null);
                    }}
                  >
                    <option value="">Choose a template</option>
                    {templates.data
                      ?.filter(
                        (t) =>
                          (t.side === "both" || t.side === detail.data?.side) &&
                          (!t.serviceGroup ||
                            t.serviceGroup ===
                              `${detail.data?.side}_${detail.data?.packageCode === "complete" ? "compliance" : "ctc"}`),
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
                disabled={!template || busy || !!draft}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const result = await mutate<{
                      subject: string;
                      body: string;
                      templateId: string;
                      templateRevision: number;
                    }>(`/api/v1/communications/templates/${template}/render`, {
                      matterId: matter,
                      values: recipientName ? { recipientName } : {},
                    });
                    setSubject(result.subject);
                    setBody(result.body);
                    setBinding({
                      id: result.templateId,
                      revision: result.templateRevision,
                      recipientName,
                    });
                    setDirty(true);
                    setConfirmed(false);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
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
              {mergeFields.error && (
                <p className={s.error}>{mergeFields.error}</p>
              )}
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
          {detail.data && (
            <p className={s.notice}>
              Client contact:{" "}
              {detail.data.details?.directContact === "through_agent"
                ? "Only through the agent. Direct client sending is restricted."
                : "Copy the agent on direct client communication."}
            </p>
          )}
          {detail.data && (
            <div style={{ margin: "18px 0" }}>
              <p className={s.fieldHint}>People saved on this deal</p>
              <div className={s.formRow} style={{ flexWrap: "wrap" }}>
                {users.data
                  ?.filter((u) => u.id === detail.data?.agentId)
                  .map((u) => (
                    <button
                      className={s.buttonSmall}
                      key={u.id}
                      onClick={() => {
                        if (
                          detail.data?.details?.directContact ===
                          "through_agent"
                        )
                          setTo(u.email);
                        else
                          setCc((v) =>
                            Array.from(
                              new Set([
                                ...v
                                  .split(",")
                                  .map((x) => x.trim())
                                  .filter(Boolean),
                                u.email,
                              ]),
                            ).join(", "),
                          );
                        setDirty(true);
                        setConfirmed(false);
                      }}
                    >
                      {detail.data?.details?.directContact === "through_agent"
                        ? "To agent: "
                        : "CC agent: "}
                      {u.name}
                    </button>
                  ))}
                {[
                  ...(Array.isArray(detail.data.details?.contacts)
                    ? detail.data.details.contacts
                    : []),
                  ...(detail.data.details?.directContact === "through_agent"
                    ? []
                    : Array.isArray(detail.data.details?.clients)
                      ? detail.data.details.clients
                      : []),
                ].map((raw, i) => {
                  const contact = raw as {
                    name?: string;
                    email?: string;
                    role?: string;
                  };
                  if (!contact.email) return null;
                  return (
                    <button
                      key={i}
                      className={s.buttonSmall}
                      onClick={() => {
                        setTo((v) =>
                          Array.from(
                            new Set([
                              ...v
                                .split(",")
                                .map((x) => x.trim())
                                .filter(Boolean),
                              contact.email!,
                            ]),
                          ).join(", "),
                        );
                        setDirty(true);
                        setConfirmed(false);
                      }}
                    >
                      {contact.name || contact.email}
                      {contact.role ? " · " + label(contact.role) : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className={s.formGrid} style={{ marginTop: 20 }}>
              <label className={s.field}>
                To (comma-separated emails)
                <input
                  className={s.input}
                  value={to}
                  onChange={(e) => edit(setTo, e.target.value)}
                  required
                  placeholder="Name@example.com"
                />
              </label>
              <label className={s.field}>
                CC (comma-separated emails)
                <input
                  className={s.input}
                  value={cc}
                  onChange={(e) => edit(setCc, e.target.value)}
                />
              </label>
            </div>
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
                (!draft &&
                  !!template &&
                  (!binding || binding.recipientName !== recipientName)) ||
                ["queued", "sent"].includes(draft?.status || "")
              }
            >
              <Save />
              {busy ? "Saving…" : "Save reviewed draft"}
            </button>
          </form>
          {draft && (
            <div style={{ marginTop: 20 }}>
              {draft.details?.reviewNeeded && (
                <div className={s.notice}>
                  <strong>
                    The transaction changed. Review this draft again.
                  </strong>
                  <p>
                    Confirmed dates may have refreshed. Hand-edited text was
                    preserved and may need a correction before sending.
                  </p>
                  {draft.details.mergeError && (
                    <p>{draft.details.mergeError}</p>
                  )}
                </div>
              )}
              <div className={s.formRow} style={{ flexWrap: "wrap" }}>
                <button
                  className={s.buttonSmall}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const saved = await api<Draft[]>(
                        `/api/v1/communications/drafts?matterId=${encodeURIComponent(matter)}`,
                      );
                      const latest = saved.find((d) => d.id === draft.id);
                      if (!latest)
                        throw new Error("This draft is no longer available.");
                      loadDraft(latest);
                      await drafts.refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Reload saved draft (replace unsaved changes)
                </button>
                {draft.details?.templateId && draft.status === "draft" && (
                  <button
                    className={s.buttonSmall}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        const reset = await mutate<Draft>(
                          `/api/v1/communications/drafts/${draft.id}/reset-template`,
                          {
                            expectedRevision: draft.revision,
                            values: recipientName ? { recipientName } : {},
                          },
                        );
                        loadDraft(reset);
                        await drafts.refresh();
                        setMessage(
                          "The message was replaced with current template text. Review before sending.",
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Replace message with current template
                  </button>
                )}
              </div>
              <p className={s.fieldHint}>
                Saved draft: {label(draft.status)}
                {dirty ? " · Unsaved changes" : ""}
              </p>
              <label className={s.todo}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={dirty || busy}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I reviewed the recipients, contact permissions, content and
                attachments, and authorize sending this saved draft.
              </label>
              <button
                className={s.button}
                disabled={
                  busy ||
                  dirty ||
                  !confirmed ||
                  !connected ||
                  ["queued", "sent"].includes(draft.status)
                }
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const sent = await mutate<Draft>(
                      `/api/v1/communications/drafts/${draft.id}/send`,
                      { revision: draft.revision, confirmed: true },
                    );
                    setDraft(sent);
                    setMessage(
                      `Sending request saved with status: ${label(sent.status)}. Check this draft for sending updates before trying again.`,
                    );
                    await drafts.refresh();
                    await onWorkChanged?.();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Send />
                Send approved draft
              </button>
            </div>
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
