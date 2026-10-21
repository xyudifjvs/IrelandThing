"use client";
import { useEffect, useState } from "react";
import { Mail, Send, Save, Link2, RefreshCw, Plus } from "lucide-react";
import {
  api,
  useData,
  mutate,
  address,
  label,
  date,
  type Matter,
} from "./data";
import s from "./workspace.module.css";
import MatterPicker from "./MatterPicker";
type Template = {
  id: string;
  name: string;
  side: string;
  phase: string;
  subject: string;
  body: string;
  revision: number;
};
type Draft = {
  id: string;
  matterId: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  attachmentIds: string[];
  status: string;
  revision: number;
  details?: {
    templateId?: string;
    templateRevision?: number;
    templateValues?: Record<string, string>;
    reviewNeeded?: boolean;
    mergeError?: string | null;
  };
};
export function GmailConnection() {
  const integrations = useData<{ provider: string; status: string }[]>(
    "/api/v1/integrations",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const status = integrations.data?.find((i) => i.provider === "gmail")?.status;
  const available = status === "configured" || status === "connected";
  async function perform(action: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await mutate<{ url?: string; status?: string }>(
        `/api/v1/communications/${action}`,
        {},
      );
      if (action === "connect") {
        if (!result.url)
          throw new Error("Google authorization URL was not returned.");
        window.location.href = result.url;
      } else {
        setMessage(
          action === "disconnect"
            ? "Mailbox access has been disconnected."
            : "Mailbox sync request recorded.",
        );
        await integrations.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={s.section} style={{ marginTop: 25 }}>
      <div className={s.sectionHead}>
        <div>
          <h2>Your Gmail connection</h2>
          <p>Only an approved, authorized mailbox can sync or send.</p>
        </div>
        <Mail size={18} strokeWidth={1.3} />
      </div>
      <div className={s.sectionBody}>
        {!available && (
          <div className={s.notice}>
            Configure approved Google OAuth credentials and the real sending
            mailbox before connecting. ireland@ireland.com is a placeholder and
            cannot be used.
          </div>
        )}
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
        <div className={s.formRow}>
          {status !== "connected" ? (
            <button
              className={s.buttonSecondary}
              disabled={!available || busy}
              onClick={() => void perform("connect")}
            >
              <Link2 />
              Connect approved Gmail
            </button>
          ) : (
            <>
              <button
                className={s.buttonSecondary}
                disabled={busy}
                onClick={() => void perform("sync")}
              >
                <RefreshCw />
                Sync mailbox
              </button>
              <button
                className={s.buttonSecondary}
                disabled={busy}
                onClick={() => void perform("disconnect")}
              >
                Disconnect Gmail
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
export function Templates() {
  const q = useData<Template[]>("/api/v1/communications/templates");
  const [selected, setSelected] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  return (
    <section className={s.section} style={{ marginTop: 25 }}>
      <div className={s.sectionHead}>
        <div>
          <h2>Your email templates</h2>
          <p>
            Thoughtful starting points. Review merged details before sending.
          </p>
        </div>
        <button
          className={s.buttonSmall}
          onClick={() => {
            setSelected(null);
            setCreating(true);
            setMessage("");
          }}
        >
          <Plus size={12} />
          New template
        </button>
      </div>
      <div className={s.sectionBody}>
        {q.error && <p className={s.error}>{q.error}</p>}
        {q.loading ? (
          <div className={s.loading}>Loading templates…</div>
        ) : (
          q.data?.map((t) => (
            <button
              className={s.message}
              key={t.id}
              style={{ padding: "13px 0" }}
              onClick={() => {
                setSelected(t);
                setCreating(false);
                setError("");
                setMessage("");
              }}
            >
              <strong>{t.name}</strong>
              <small style={{ display: "block", marginTop: 6 }}>
                {label(t.side)} · {label(t.phase)}
              </small>
            </button>
          ))
        )}
        {!q.loading && !q.data?.length && !creating && (
          <p className={s.tiny}>
            No approved templates yet. Create one with your preferred
            communication language.
          </p>
        )}
        {selected || creating ? (
          <form
            key={selected?.id || "new"}
            style={{ marginTop: 22 }}
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              setMessage("");
              const values = {
                name: String(f.get("name")),
                side: String(f.get("side")),
                phase: String(f.get("phase")),
                subject: String(f.get("subject")),
                body: String(f.get("body")),
              };
              try {
                const saved = await mutate<Template>(
                  `/api/v1/communications/templates${selected ? "/" + selected.id : ""}`,
                  selected
                    ? { expectedRevision: selected.revision, ...values }
                    : values,
                  selected ? "PATCH" : "POST",
                );
                setSelected(saved);
                setCreating(false);
                await q.refresh();
                setMessage(
                  "Template saved. Existing drafts are not changed automatically.",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className={s.formGrid}>
              <label className={s.field}>
                Template name
                <input
                  className={s.input}
                  name="name"
                  required
                  defaultValue={selected?.name}
                />
              </label>
              <label className={s.field}>
                Who it’s for
                <select
                  className={s.select}
                  name="side"
                  defaultValue={selected?.side || "both"}
                >
                  <option value="both">Both sides</option>
                  <option value="buyer">Buyer side</option>
                  <option value="seller">Seller side</option>
                </select>
              </label>
              <label className={s.field}>
                Transaction phase
                <input
                  className={s.input}
                  name="phase"
                  required
                  defaultValue={selected?.phase || "under_contract"}
                  placeholder="e.g. closing"
                />
              </label>
              <label className={s.field}>
                Subject
                <input
                  className={s.input}
                  name="subject"
                  required
                  defaultValue={selected?.subject}
                />
              </label>
            </div>
            <label className={s.field} style={{ marginTop: 18 }}>
              Email body
              <textarea
                className={s.textarea}
                style={{ minHeight: 180 }}
                name="body"
                required
                defaultValue={selected?.body}
              />
            </label>
            <p className={s.fieldHint}>
              Merge fields:{" "}
              {
                "{{propertyAddress}}, {{agentName}}, {{agentEmail}}, {{clientNames}}, {{closingDate}}, {{packageName}}, {{recipientName}}, {{coordinatorName}}"
              }
              . Missing required values prevent rendering.
            </p>
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
            <div className={s.formRow}>
              <button className={s.button} disabled={busy}>
                <Save />
                {busy ? "Saving…" : "Save template"}
              </button>
              <button
                type="button"
                className={s.buttonSecondary}
                onClick={() => {
                  setSelected(null);
                  setCreating(false);
                }}
              >
                Close editor
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}
export function Composer() {
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
  const [matter, setMatter] = useState("");
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
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [dirty, setDirty] = useState(true),
    [confirmed, setConfirmed] = useState(false),
    [template, setTemplate] = useState(""),
    [recipientName, setRecipientName] = useState("");
  const connected = integrations.data?.some(
    (i) => i.provider === "gmail" && i.status === "connected",
  );
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("matterId");
    if (value) setMatter(value);
  }, []);
  useEffect(() => {
    function receive(event: Event) {
      const value = (
        event as CustomEvent<{
          matterId: string;
          subject: string;
          body: string;
        }>
      ).detail;
      if (!value?.matterId) return;
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
  }, []);
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
  async function save() {
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
      setDraft(saved);
      setDirty(false);
      setConfirmed(false);
      await drafts.refresh();
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
          <h2>A thoughtful note, ready for your review</h2>
          <p>
            Saved drafts are never sent automatically. Client contact
            instructions apply.
          </p>
        </div>
        <Mail size={19} strokeWidth={1.3} />
      </div>
      <div className={s.sectionBody}>
        <div className={s.formGrid}>
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
                      (t) => t.side === "both" || t.side === detail.data?.side,
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
                        detail.data?.details?.directContact === "through_agent"
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
                {draft.details.mergeError && <p>{draft.details.mergeError}</p>}
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
                    `Sending request saved with status: ${label(sent.status)}. Provider delivery status is tracked on the draft.`,
                  );
                  await drafts.refresh();
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
      </div>
    </section>
  );
}
export function MessageReview({
  message,
  onChanged,
}: {
  message: Record<string, unknown>;
  onChanged: () => void;
}) {
  const threads = useData<
    { id: string; matterId?: string | null; revision: number }[]
  >("/api/v1/communications/threads");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const thread = threads.data?.find((t) => t.id === message.threadId);
  const [confirmed, setConfirmed] = useState(false);
  const [association, setAssociation] = useState(
    String(message.matterId || ""),
  );
  return (
    <div
      style={{ marginTop: 25, borderTop: "1px solid #e3d6c1", paddingTop: 20 }}
    >
      <p className={s.eyebrow}>Reviewed file association & sharing</p>
      {error && <p className={s.error}>{error}</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            if (!thread)
              throw new Error(
                "Refresh this conversation before changing its association.",
              );
            await mutate(
              `/api/v1/communications/threads/${thread.id}`,
              {
                expectedRevision: thread.revision,
                matterId: String(f.get("matterId") || "") || null,
              },
              "PATCH",
            );
            onChanged();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <MatterPicker
          label="Associate this conversation with a transaction"
          name="matterId"
          value={association}
          onChange={setAssociation}
          emptyLabel="Unassigned — coordinator review"
        />
        <button
          className={s.buttonSmall}
          style={{ marginTop: 12 }}
          disabled={busy || !thread}
        >
          Save reviewed association
        </button>
      </form>
      <form
        style={{ marginTop: 22 }}
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await mutate(
              `/api/v1/communications/messages/${String(message.id)}`,
              {
                expectedRevision: Number(message.revision),
                visibility: String(f.get("visibility")),
              },
              "PATCH",
            );
            onChanged();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className={s.field}>
          Share this message with
          <select
            className={s.select}
            name="visibility"
            defaultValue={String(
              (message.details as { visibility?: string } | undefined)
                ?.visibility || "coordinator",
            )}
          >
            <option value="coordinator">Coordinator only</option>
            <option value="agent">Assigned agent & coordinator</option>
            <option value="client">
              Authorized client, agent & coordinator
            </option>
          </select>
        </label>
        <label className={s.todo}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I reviewed this individual message and its contents for the selected
          audience.
        </label>
        <p className={s.fieldHint}>
          Associating a conversation never shares its entire history. Sharing is
          reviewed per message.
        </p>
        <button className={s.buttonSmall} disabled={busy || !confirmed}>
          Save message visibility
        </button>
      </form>
    </div>
  );
}
