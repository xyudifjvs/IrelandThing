"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { api, mutate, type Matter, label } from "./data";
import s from "./workspace.module.css";
import UserPicker from "./UserPicker";
import BusinessContactPicker, {
  businessContactSnapshot,
  businessContactKinds,
  type BusinessContact,
  type BusinessContactKind,
} from "./BusinessContactPicker";
import {
  contactValuesConflict,
  transactionContactSources,
  prefillPriorContact,
  type PriorContactSource,
} from "./transaction-contact-sources";
type Contact = {
  id: string;
  name: string;
  role: string;
  company?: string;
  email: string;
  phone?: string;
  directoryContactId?: string;
  directoryRevision?: number;
  snapshotAt?: string;
  directorySnapshotModified?: boolean;
  reviewedSourceConflict?: boolean;
  priorSourceSnapshot?: PriorContactSource[];
  sourceConflictReason?: string;
};
type Entry = {
  name: string;
  company: string;
  role: string;
  email: string;
  phone: string;
};
const blank: Entry = {
  name: "",
  company: "",
  role: "lender",
  email: "",
  phone: "",
};
const entry = (c: Contact): Entry => ({
  name: c.name,
  company: c.company || "",
  role: c.role,
  email: c.email,
  phone: c.phone || "",
});
export default function Contacts({
  matter: m,
  refresh,
}: {
  matter: Matter;
  refresh: () => Promise<void>;
}) {
  const contacts = (
    Array.isArray(m.details?.contacts) ? m.details.contacts : []
  ) as Contact[];
  const clients = (
    Array.isArray(m.details?.clients) ? m.details.clients : []
  ) as { name: string; email: string; phone?: string }[];
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [edit, setEdit] = useState<Contact | null>(null),
    [form, setForm] = useState<Entry>(blank),
    [selected, setSelected] = useState<BusinessContact | null>(null),
    [candidate, setCandidate] = useState<BusinessContact | null>(null),
    [priorSources, setPriorSources] = useState<PriorContactSource[]>([]),
    [sourceReview, setSourceReview] = useState<PriorContactSource[] | null>(
      null,
    ),
    [saveReusable, setSaveReusable] = useState(false),
    [open, setOpen] = useState(false);
  function start(c?: Contact) {
    setEdit(c || null);
    setForm(c ? entry(c) : blank);
    setSelected(null);
    setCandidate(null);
    setPriorSources([]);
    setSourceReview(null);
    setSaveReusable(false);
    setError("");
    setNotice("");
    setOpen(true);
  }
  function apply(c: BusinessContact, reviewed = false) {
    setSourceReview(
      reviewed && priorSources.length ? structuredClone(priorSources) : null,
    );
    setPriorSources([]);
    setSelected(c);
    setCandidate(null);
    setForm({
      name: c.name,
      company: c.company,
      email: c.email,
      phone: c.phone,
      role: c.kind,
    });
    setSaveReusable(false);
  }
  function choose(c: BusinessContact) {
    const sources = transactionContactSources(m.details, c.kind, edit?.id);
    const conflicts = sources.filter((source) =>
      contactValuesConflict(source, c),
    );
    const enteredConflict = contactValuesConflict(form, c);
    if (conflicts.length || enteredConflict) {
      setPriorSources([
        ...sources,
        ...(enteredConflict ? [{ ...form, source: "Entered contact" }] : []),
      ]);
      setSourceReview(null);
      setForm((current) => ({
        ...current,
        ...prefillPriorContact(sources, current),
      }));
      setCandidate(c);
    } else apply(c);
  }
  async function save(next: Contact[]) {
    await mutate(
      `/api/v1/matters/${m.id}`,
      {
        expectedRevision: m.revision,
        details: { ...m.details, contacts: next },
      },
      "PATCH",
    );
    await refresh();
  }
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2>People on this deal</h2>
          <p>
            Client, agent, lender and title company contact details. Directory
            selections are saved copies for this transaction.
          </p>
        </div>
      </div>
      <div className={s.sectionBody}>
        {clients.map((c, i) => (
          <div className={s.attention} key={`client-${i}`}>
            <div className={s.avatar}>{c.name?.[0]}</div>
            <div>
              <strong>{c.name}</strong>
              <p>
                Client · from intake
                <br />
                {c.email}
                <br />
                {c.phone}
              </p>
            </div>
          </div>
        ))}
        {contacts.map((c) => (
          <div className={s.attention} key={c.id}>
            <div className={s.avatar}>{c.name?.[0]}</div>
            <div style={{ flex: 1 }}>
              <strong>{c.name}</strong>
              <p>
                {label(c.role)}
                {c.company ? ` · ${c.company}` : ""}
                <br />
                {c.email}
                <br />
                {c.phone}
              </p>
              {c.directoryContactId && (
                <p className={s.fieldHint}>
                  Saved directory snapshot · revision {c.directoryRevision}
                  {c.directorySnapshotModified
                    ? " · transaction details corrected"
                    : ""}
                </p>
              )}
              <button
                type="button"
                className={s.buttonSmall}
                disabled={busy}
                onClick={() => start(c)}
              >
                Edit contact
              </button>
            </div>
            <button
              type="button"
              className={s.buttonSmall}
              aria-label={`Remove ${c.name}`}
              disabled={busy}
              onClick={() =>
                void act(() => save(contacts.filter((x) => x.id !== c.id)))
              }
            >
              ×
            </button>
          </div>
        ))}
        {!clients.length && !contacts.length && (
          <p className={s.fieldHint}>
            Add a lender, title representative or other transaction contact.
          </p>
        )}
        <button
          type="button"
          className={s.buttonSmall}
          disabled={busy}
          onClick={() => start()}
        >
          Add a transaction contact
        </button>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className={s.notice} role="status">
            {notice}
          </p>
        )}
        {open && (
          <form
            style={{ display: "grid", gap: 12, marginTop: 17 }}
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                if (candidate)
                  throw Error(
                    "Review or dismiss the selected directory contact before saving.",
                  );
                let directory = selected;
                if (saveReusable) {
                  if (form.role === "client")
                    throw Error(
                      "Clients are not saved automatically in the business directory.",
                    );
                  const values = {
                    kind: (businessContactKinds.includes(
                      form.role as BusinessContactKind,
                    )
                      ? form.role
                      : "other") as BusinessContactKind,
                    name: form.name,
                    company: form.company,
                    email: form.email,
                    phone: form.phone,
                  };
                  directory = selected
                    ? await mutate<BusinessContact>(
                        `/api/v1/contacts/${selected.id}`,
                        { ...values, expectedRevision: selected.revision },
                        "PATCH",
                      )
                    : await mutate<BusinessContact>("/api/v1/contacts", values);
                  setSelected(directory);
                  setSaveReusable(false);
                }
                const source = directory
                  ? businessContactSnapshot(directory, form.role)
                  : edit?.directoryContactId
                    ? {
                        directoryContactId: edit.directoryContactId,
                        directoryRevision: edit.directoryRevision,
                        snapshotAt: edit.snapshotAt,
                      }
                    : {};
                const modified = directory
                  ? ["name", "company", "email", "phone"].some(
                      (k) =>
                        form[k as keyof Entry] !==
                        directory![k as "name" | "company" | "email" | "phone"],
                    )
                  : !!edit?.directoryContactId &&
                    (edit.directorySnapshotModified ||
                      ["name", "company", "email", "phone"].some(
                        (k) =>
                          form[k as keyof Entry] !==
                          entry(edit)[k as keyof Entry],
                      ));
                const contact: Contact = {
                  ...source,
                  id: edit?.id || crypto.randomUUID(),
                  ...form,
                  ...(sourceReview
                    ? {
                        reviewedSourceConflict: true,
                        priorSourceSnapshot: sourceReview,
                        sourceConflictReason:
                          "Coordinator explicitly chose these directory details after reviewing existing transaction contact values.",
                      }
                    : !directory && edit?.reviewedSourceConflict
                      ? {
                          reviewedSourceConflict: true,
                          priorSourceSnapshot: edit.priorSourceSnapshot,
                          sourceConflictReason: edit.sourceConflictReason,
                        }
                      : {}),
                  ...(Object.keys(source).length
                    ? { directorySnapshotModified: modified }
                    : {}),
                };
                await save(
                  edit
                    ? contacts.map((c) => (c.id === edit.id ? contact : c))
                    : [...contacts, contact],
                );
                setOpen(false);
                setEdit(null);
                setForm(blank);
                setSelected(null);
                if (directory) {
                  try {
                    await mutate(`/api/v1/contacts/${directory.id}/usage`, {
                      expectedRevision: directory.revision,
                      matterId: m.id,
                    });
                  } catch {
                    setNotice(
                      "Transaction contact saved. Directory usage was not updated; the saved transaction snapshot is unchanged.",
                    );
                  }
                }
              });
            }}
          >
            <fieldset
              disabled={busy}
              style={{
                display: "grid",
                gap: 12,
                border: 0,
                padding: 0,
                margin: 0,
              }}
            >
              <h3>
                {edit ? "Edit transaction contact" : "Add transaction contact"}
              </h3>
              <BusinessContactPicker
                query={form.company || form.name}
                onSelect={choose}
              />
              {candidate && (
                <div className={s.notice} role="alert">
                  <strong>Review replacement before choosing</strong>
                  {priorSources.map((source, index) => (
                    <p key={index}>
                      {source.source}: {source.name} · {source.company} ·{" "}
                      {source.email} · {source.phone}
                    </p>
                  ))}
                  <p>
                    Entered: {form.name} · {form.company} · {form.email} ·{" "}
                    {form.phone}
                  </p>
                  <p>
                    Directory: {candidate.name} · {candidate.company} ·{" "}
                    {candidate.email} · {candidate.phone}
                  </p>
                  <button
                    type="button"
                    className={s.buttonSmall}
                    onClick={() => apply(candidate, true)}
                  >
                    Replace entered details with this directory contact
                  </button>
                  <button
                    type="button"
                    className={s.buttonSmall}
                    onClick={() => {
                      setCandidate(null);
                      setPriorSources([]);
                    }}
                  >
                    Keep entered details
                  </button>
                  <p className={s.fieldHint}>
                    Saved intake and source records remain unchanged. Adding
                    another representative does not choose between multiple
                    people for future messages.
                  </p>
                </div>
              )}
              <label className={s.field}>
                Full name
                <input
                  className={s.input}
                  value={form.name}
                  maxLength={200}
                  required
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className={s.field}>
                Company
                <input
                  className={s.input}
                  value={form.company}
                  maxLength={250}
                  onChange={(e) =>
                    setForm({ ...form, company: e.target.value })
                  }
                />
              </label>
              <label className={s.field}>
                Role
                <select
                  className={s.select}
                  value={form.role}
                  onChange={(e) => {
                    setForm({ ...form, role: e.target.value });
                    if (e.target.value === "client") {
                      setSaveReusable(false);
                      setSelected(null);
                    }
                  }}
                >
                  {[...businessContactKinds, "client", "my_agent"].map((v) => (
                    <option key={v} value={v}>
                      {label(v)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={s.field}>
                Email
                <input
                  className={s.input}
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
              <label className={s.field}>
                Phone
                <input
                  className={s.input}
                  type="tel"
                  value={form.phone}
                  maxLength={60}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </label>
              {form.role !== "client" && (
                <label>
                  <input
                    type="checkbox"
                    checked={saveReusable}
                    onChange={(e) => setSaveReusable(e.target.checked)}
                  />{" "}
                  {selected
                    ? "Save corrected details to this reusable contact"
                    : "Save reusable contact"}
                </label>
              )}
              <p className={s.fieldHint}>
                Changes affect this transaction only unless you explicitly save
                reusable details. Existing directory snapshots, sent messages
                and other transactions are not rewritten. Saving does not create
                accounts, grant access or send email.
              </p>
              <button className={s.buttonSmall} disabled={!!candidate}>
                <Plus size={12} />
                {busy ? "Saving…" : edit ? "Save contact" : "Add to this deal"}
              </button>
              <button
                type="button"
                className={s.buttonSmall}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
            </fieldset>
          </form>
        )}
      </div>
    </section>
  );
}

export function AgentAssignment({
  matter: m,
  refresh,
}: {
  matter: Matter;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <h2>Agent on this file</h2>
      </div>
      <div className={s.sectionBody}>
        <UserPicker
          label="Assigned agent"
          role="agent"
          value={m.agentId || ""}
          disabled={busy}
          onChange={async (userId) => {
            if (!userId) return;
            setBusy(true);
            setError("");
            try {
              await mutate(
                `/api/v1/matters/${m.id}`,
                { expectedRevision: m.revision, agentId: userId },
                "PATCH",
              );
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
        <p className={s.fieldHint}>
          Assignment controls agent access and the agent copied on permitted
          client communications.
        </p>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
