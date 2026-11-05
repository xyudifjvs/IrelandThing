"use client";
import { useState } from "react";
import { api, mutate, useData, label, type Session } from "./data";
import {
  businessContactKinds,
  type BusinessContact,
  type BusinessContactKind,
} from "./BusinessContactPicker";
import s from "./workspace.module.css";
type Form = {
  kind: BusinessContactKind;
  name: string;
  company: string;
  email: string;
  phone: string;
  favorite: boolean;
};
const empty: Form = {
  kind: "other",
  name: "",
  company: "",
  email: "",
  phone: "",
  favorite: false,
};
export default function BusinessContactDirectory() {
  const session = useData<Session>("/api/v1/session"),
    allowed = session.data?.user?.role === "coordinator";
  const [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState("frequent"),
    [favorites, setFavorites] = useState(false);
  const [form, setForm] = useState<Form>(empty),
    [editing, setEditing] = useState<BusinessContact | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const params = new URLSearchParams({ q: search, sort, limit: "100" });
  if (favorites) params.set("favorites", "true");
  const contacts = useData<{ items: BusinessContact[]; hasMore: boolean }>(
    allowed ? `/api/v1/contacts?${params}` : null,
  );
  function open(c: BusinessContact) {
    setEditing(c);
    setForm({
      kind: c.kind,
      name: c.name,
      company: c.company,
      email: c.email,
      phone: c.phone,
      favorite: c.favorite,
    });
    setError("");
    setNotice("");
  }
  async function action(fn: () => Promise<void>) {
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
  if (session.loading) return <p>Opening private contacts…</p>;
  if (!allowed)
    return (
      <p role="alert">
        Only the coordinator can open the private business-contact directory.
      </p>
    );
  return (
    <>
      <div className={s.heading}>
        <div>
          <p className={s.eyebrow}>Coordinator only</p>
          <h1>Business contacts</h1>
          <p className={s.subtitle}>
            Your private reusable directory. Choosing a contact copies its
            current details into a transaction; later directory edits never
            rewrite that saved copy.
          </p>
        </div>
      </div>
      <section className={s.section}>
        <div className={s.sectionBody}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(q);
            }}
            style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
          >
            <label className={s.field} style={{ flex: 1 }}>
              Search people or companies
              <input
                className={s.input}
                value={q}
                maxLength={200}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <button className={s.buttonSmall}>Search</button>
          </form>
          <div className={s.formGrid}>
            <label className={s.field}>
              Order
              <select
                className={s.select}
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="frequent">Frequently used</option>
                <option value="recent">Recently used</option>
                <option value="name">Name</option>
              </select>
            </label>
            <label className={s.field}>
              <span>Favorites</span>
              <span>
                <input
                  type="checkbox"
                  checked={favorites}
                  onChange={(e) => setFavorites(e.target.checked)}
                />{" "}
                Show favorites only
              </span>
            </label>
          </div>
          {contacts.loading ? (
            <p>Loading contacts…</p>
          ) : contacts.error ? (
            <p className={s.error} role="alert">
              {contacts.error}
              <button onClick={() => void contacts.refresh()}>Retry</button>
            </p>
          ) : contacts.data?.items.length ? (
            contacts.data.items.map((c) => (
              <article key={c.id} className={s.attention}>
                <div style={{ flex: 1 }}>
                  <strong>{c.name}</strong>
                  <p>
                    {c.company || "Company not provided"} · {label(c.kind)}
                    <br />
                    {c.email || "Email not provided"} ·{" "}
                    {c.phone || "Phone not provided"}
                    <br />
                    {c.usageCount} explicit selection
                    {c.usageCount === 1 ? "" : "s"}
                    {c.lastUsedAt
                      ? ` · Last used ${new Date(c.lastUsedAt).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className={s.buttonSmall}
                    disabled={busy}
                    onClick={() => open(c)}
                  >
                    Edit {c.name}
                  </button>
                  <button
                    className={s.buttonSmall}
                    disabled={busy}
                    aria-label={`${c.favorite ? "Remove" : "Add"} ${c.name} ${c.favorite ? "from" : "to"} favorites`}
                    onClick={() =>
                      void action(async () => {
                        const next = await mutate<BusinessContact>(
                          `/api/v1/contacts/${c.id}`,
                          {
                            expectedRevision: c.revision,
                            favorite: !c.favorite,
                          },
                          "PATCH",
                        );
                        if (
                          editing?.id === c.id &&
                          editing.revision === c.revision
                        ) {
                          setEditing(next);
                          setForm((current) => ({
                            ...current,
                            favorite: next.favorite,
                          }));
                        }
                        await contacts.refresh();
                      })
                    }
                  >
                    {c.favorite ? "★ Favorite" : "☆ Favorite"}
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p>
              No business contacts found. Add one below, or change the search.
            </p>
          )}
          {contacts.data?.hasMore && (
            <p className={s.fieldHint}>
              More than 100 contacts match. Search by name, company, email or
              phone to narrow the results.
            </p>
          )}
        </div>
      </section>
      <section className={s.section} style={{ marginTop: 24 }}>
        <div className={s.sectionHead}>
          <h2>
            {editing
              ? `Correct ${editing.name}`
              : "Save a reusable business contact"}
          </h2>
          <button
            className={s.buttonSmall}
            disabled={busy}
            onClick={() => {
              setEditing(null);
              setForm(empty);
              setError("");
              setNotice("");
            }}
          >
            New contact
          </button>
        </div>
        <div className={s.sectionBody}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const saved = await mutate<BusinessContact>(
                  editing
                    ? `/api/v1/contacts/${editing.id}`
                    : "/api/v1/contacts",
                  editing
                    ? { ...form, expectedRevision: editing.revision }
                    : form,
                  editing ? "PATCH" : "POST",
                );
                open(saved);
                setNotice(
                  "Reusable business contact saved. Existing transaction contacts are unchanged.",
                );
                await contacts.refresh();
              });
            }}
            style={{ display: "grid", gap: 12 }}
          >
            <fieldset
              disabled={busy}
              style={{
                border: 0,
                padding: 0,
                margin: 0,
                display: "grid",
                gap: 12,
              }}
            >
              <label className={s.field}>
                Type
                <select
                  aria-label="Contact type"
                  className={s.select}
                  value={form.kind}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      kind: e.target.value as BusinessContactKind,
                    })
                  }
                >
                  {businessContactKinds.map((k) => (
                    <option value={k} key={k}>
                      {label(k)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={s.field}>
                Person or business name
                <input
                  className={s.input}
                  required
                  maxLength={200}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className={s.field}>
                Company
                <input
                  className={s.input}
                  maxLength={250}
                  value={form.company}
                  onChange={(e) =>
                    setForm({ ...form, company: e.target.value })
                  }
                />
              </label>
              <div className={s.formGrid}>
                <label className={s.field}>
                  Email
                  <input
                    className={s.input}
                    type="email"
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                  />
                </label>
                <label className={s.field}>
                  Phone
                  <input
                    className={s.input}
                    type="tel"
                    maxLength={60}
                    value={form.phone}
                    onChange={(e) =>
                      setForm({ ...form, phone: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={form.favorite}
                  onChange={(e) =>
                    setForm({ ...form, favorite: e.target.checked })
                  }
                />{" "}
                Favorite
              </label>
              <p className={s.fieldHint}>
                Save only business contacts you explicitly want to reuse. People
                at the same company remain separate records. Saving does not
                create an account, grant access or send a message.
              </p>
              <button className={s.button}>
                {busy
                  ? "Saving…"
                  : editing
                    ? "Save corrected directory contact"
                    : "Save new directory contact"}
              </button>
            </fieldset>
          </form>
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
          {editing && error && (
            <button
              className={s.buttonSmall}
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  open(
                    await api<BusinessContact>(
                      `/api/v1/contacts/${editing.id}`,
                    ),
                  );
                })
              }
            >
              Reload saved directory version (replace these entries)
            </button>
          )}
        </div>
      </section>
    </>
  );
}
