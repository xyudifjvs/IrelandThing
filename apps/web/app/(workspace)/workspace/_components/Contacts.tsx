"use client";
import { useState } from "react";
import { Plus, Mail, Phone } from "lucide-react";
import { mutate, type Matter, label } from "./data";
import s from "./workspace.module.css";
type Contact = {
  id: string;
  name: string;
  role: string;
  email: string;
  phone?: string;
};
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
    [error, setError] = useState("");
  const [edit, setEdit] = useState<Contact | null>(null);
  async function save(contacts: Contact[]) {
    setBusy(true);
    setError("");
    try {
      await mutate(
        `/api/v1/matters/${m.id}`,
        { expectedRevision: m.revision, details: { ...m.details, contacts } },
        "PATCH",
      );
      await refresh();
      setEdit(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2>People on this deal</h2>
          <p>Contact details for clear, thoughtful communication.</p>
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
                <br />
                {c.email}
                <br />
                {c.phone}
              </p>
              <button
                className={s.buttonSmall}
                disabled={busy}
                onClick={() => setEdit(c)}
              >
                Edit contact
              </button>
            </div>
            <button
              className={s.buttonSmall}
              title={`Remove ${c.name}`}
              aria-label={`Remove ${c.name}`}
              disabled={busy}
              onClick={() => void save(contacts.filter((x) => x.id !== c.id))}
            >
              ×
            </button>
          </div>
        ))}
        {!clients.length && !contacts.length && (
          <p className={`${s.muted} ${s.tiny}`}>
            Add your lender, title representative and other transaction contacts
            here.
          </p>
        )}
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <details
          key={edit?.id || "new"}
          open={edit ? true : undefined}
          style={{ marginTop: 20 }}
        >
          <summary
            style={{ cursor: "pointer", fontSize: 11, color: "#8b7151" }}
          >
            {edit ? "Edit contact" : "Add a transaction contact"}
          </summary>
          <form
            style={{ display: "grid", gap: 12, marginTop: 17 }}
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              const contact: Contact = {
                id: edit?.id || crypto.randomUUID(),
                name: String(f.get("name")),
                role: String(f.get("role")),
                email: String(f.get("email")),
                ...(f.get("phone") ? { phone: String(f.get("phone")) } : {}),
              };
              const next = edit
                ? contacts.map((c) => (c.id === edit.id ? contact : c))
                : [...contacts, contact];
              if (await save(next)) form.reset();
            }}
          >
            <label className={s.field}>
              Full name
              <input
                className={s.input}
                name="name"
                defaultValue={edit?.name}
                required
              />
            </label>
            <label className={s.field}>
              Role
              <select
                className={s.select}
                name="role"
                defaultValue={edit?.role || "lender"}
              >
                {[
                  "lender",
                  "title_rep",
                  "co_op_agent",
                  "client",
                  "my_agent",
                  "other",
                ].map((v) => (
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
                name="email"
                type="email"
                defaultValue={edit?.email}
                required
              />
            </label>
            <label className={s.field}>
              Phone
              <input
                className={s.input}
                name="phone"
                type="tel"
                defaultValue={edit?.phone}
              />
            </label>
            <p className={s.fieldHint}>
              Saving a contact does not create an account, grant portal access
              or send an email. Contact preferences from the intake still apply.
            </p>
            <button className={s.buttonSmall} disabled={busy}>
              <Plus size={12} />
              {busy ? "Saving…" : edit ? "Save contact" : "Add to this deal"}
            </button>
            {edit && (
              <button
                type="button"
                className={s.buttonSmall}
                onClick={() => setEdit(null)}
              >
                Cancel edit
              </button>
            )}
          </form>
        </details>
      </div>
    </section>
  );
}
