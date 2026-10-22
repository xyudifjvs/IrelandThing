"use client";
import { useId, useState } from "react";
import { api, mutate, useData, date, label } from "./data";
import s from "./workspace.module.css";
type Version = {
  id: string;
  version: number;
  createdAt: string;
  size?: number;
  checksum?: string;
};
type FileRecord = {
  id: string;
  name: string;
  revision: number;
  visibility: string;
  category: string;
  mimeType?: string;
  createdById?: string;
  status?: string;
  versions?: Version[];
};
const scopes = [
  ["coordinator", "Ireland only (no portal access)"],
  ["agent", "Ireland and agents on this file"],
  ["client", "Ireland, agents and clients on this file"],
];
function validateFile(file: File) {
  if (!file.size || file.size > 20 * 1024 * 1024)
    throw new Error("Choose a file between 1 byte and 20 MB.");
  if (!/\.(pdf|docx)$/i.test(file.name))
    throw new Error(
      "Choose a PDF or DOCX file. Convert other formats before uploading.",
    );
}
export default function DocumentFiles({
  matterId,
  coordinator = false,
  actorId,
  canUpload = true,
}: {
  matterId: string;
  coordinator?: boolean;
  actorId?: string;
  canUpload?: boolean;
}) {
  const [cursor, setCursor] = useState("");
  const [earlier, setEarlier] = useState<FileRecord[]>([]);
  const query = useData<FileRecord[]>(
    `/api/v1/documents?matterId=${encodeURIComponent(matterId)}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  const files = [...earlier, ...(query.data || [])].filter(
    (f, i, all) => all.findIndex((x) => x.id === f.id) === i,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function reload() {
    setEarlier([]);
    if (cursor) setCursor("");
    else await query.refresh();
  }
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2>Transaction documents</h2>
          <p>
            {coordinator
              ? "Choose who can access each file and upload revised versions."
              : "Download shared files and review their versions."}
          </p>
        </div>
        <button
          className={s.buttonSmall}
          disabled={query.loading || busy}
          onClick={() => void reload()}
        >
          Refresh documents
        </button>
      </div>
      <div className={s.sectionBody}>
        {query.error && (
          <p className={s.error} role="alert">
            Documents could not be loaded: {query.error}{" "}
            <button
              className={s.buttonSmall}
              onClick={() => void query.refresh()}
            >
              Try again
            </button>
          </p>
        )}
        {query.loading && <p role="status">Loading documents…</p>}
        {!query.loading && !query.error && !files.length && (
          <p className={s.empty}>
            No documents have been shared on this file yet.
          </p>
        )}
        {files.map((f) => (
          <DocumentRow
            key={f.id}
            file={f}
            coordinator={coordinator}
            actorId={actorId}
            refresh={reload}
          />
        ))}
        {query.data?.length === 50 && (
          <button
            className={s.buttonSecondary}
            disabled={query.loading}
            onClick={() => {
              const last = files.at(-1);
              if (last) {
                setEarlier(files);
                setCursor(last.id);
              }
            }}
          >
            Load older documents
          </button>
        )}
        {canUpload && (
          <form
            style={{ marginTop: 22 }}
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              setBusy(true);
              setError("");
              setMessage("");
              try {
                const body = new FormData(form);
                const file = body.get("file");
                if (!(file instanceof File)) throw new Error("Choose a file.");
                validateFile(file);
                body.set("matterId", matterId);
                body.set("category", "other");
                if (!coordinator) body.set("visibility", "agent");
                await api("/api/v1/documents", { method: "POST", body });
                form.reset();
                setMessage("Document uploaded.");
                await reload();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className={s.field}>
              Upload a new document
              <input
                className={s.input}
                type="file"
                name="file"
                required
                accept=".pdf,.docx"
                disabled={busy}
              />
            </label>
            <p className={s.fieldHint}>
              PDF or DOCX, up to 20 MB. To revise an existing file, open its
              versions below.
            </p>
            {coordinator && (
              <label className={s.field}>
                Who can access this file?
                <select
                  className={s.select}
                  name="visibility"
                  defaultValue="agent"
                  disabled={busy}
                >
                  {scopes.map(([v, n]) => (
                    <option value={v} key={v}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {coordinator && (
              <p className={s.fieldHint}>
                Sharing applies to this document and all versions. Only people
                already granted access to the transaction can see it.
              </p>
            )}
            {error && (
              <p role="alert" className={s.error}>
                {error}
              </p>
            )}
            {message && (
              <p role="status" className={s.notice}>
                {message}
              </p>
            )}
            <button className={s.buttonSecondary} disabled={busy}>
              {busy ? "Uploading…" : "Upload document"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
function DocumentRow({
  file,
  coordinator,
  actorId,
  refresh,
}: {
  file: FileRecord;
  coordinator: boolean;
  actorId?: string;
  refresh: () => Promise<void>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const q = useData<FileRecord>(
    open ? `/api/v1/documents/${encodeURIComponent(file.id)}` : null,
  );
  const doc = q.data || file;
  const [scope, setScope] = useState<string | null>(null),
    [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const canVersion =
    coordinator ||
    (!!actorId && doc.createdById === actorId && doc.visibility === "agent");
  async function changeScope(value: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await mutate(
        `/api/v1/documents/${doc.id}`,
        { expectedRevision: doc.revision, visibility: value },
        "PATCH",
      );
      setScope(null);
      setApproved(false);
      await q.refresh();
      await refresh();
      setMessage(
        value === "coordinator"
          ? "Agent and client access removed for this document and every version."
          : "Sharing saved for this document and every version.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={s.documentCard}>
      <div className={s.documentActions}>
        <strong style={{ flex: 1, overflowWrap: "anywhere" }}>
          {file.name}
        </strong>
        <a
          className={s.buttonSmall}
          target="_blank"
          rel="noreferrer"
          href={`/api/v1/documents/${file.id}/download`}
          aria-label={`Download latest ${file.name}`}
        >
          Download latest
        </a>
      </div>
      {coordinator && (
        <p className={s.fieldHint}>
          Access:{" "}
          {scopes.find(([v]) => v === doc.visibility)?.[1] ||
            label(doc.visibility)}
        </p>
      )}
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary style={{ cursor: "pointer", padding: "12px 0", fontSize: 12 }}>
          Versions{coordinator ? " and sharing" : ""} for {file.name}
        </summary>
        {q.loading && <p role="status">Loading file details…</p>}
        {q.error && (
          <p className={s.error} role="alert">
            {q.error}{" "}
            <button className={s.buttonSmall} onClick={() => void q.refresh()}>
              Reload file
            </button>
          </p>
        )}
        {q.data && (
          <>
            {coordinator && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void changeScope(scope || doc.visibility);
                }}
              >
                <label className={s.field}>
                  Who can access this document?
                  <select
                    className={s.select}
                    disabled={busy}
                    value={scope ?? doc.visibility}
                    onChange={(e) => {
                      setScope(e.target.value);
                      setApproved(false);
                    }}
                  >
                    {scopes.map(([v, n]) => (
                      <option key={v} value={v}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <p className={s.fieldHint}>
                  This changes access to every version, including previous
                  versions. Sharing a file does not invite anyone to the
                  transaction.
                </p>
                <label className={s.todo}>
                  <input
                    type="checkbox"
                    checked={approved}
                    disabled={busy}
                    onChange={(e) => setApproved(e.target.checked)}
                  />
                  I reviewed access to this document and all of its versions.
                </label>
                <div className={s.documentActions}>
                  <button
                    className={s.buttonSmall}
                    disabled={
                      busy || !approved || !scope || scope === doc.visibility
                    }
                  >
                    Save sharing
                  </button>
                  {doc.visibility !== "coordinator" && (
                    <button
                      type="button"
                      className={s.buttonSmall}
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove agent and client access to ${file.name} and all its versions?`,
                          )
                        )
                          void changeScope("coordinator");
                      }}
                    >
                      Remove all portal access
                    </button>
                  )}
                </div>
              </form>
            )}
            <h3 id={id} style={{ fontSize: 14, marginTop: 20 }}>
              Version history
            </h3>
            <ul aria-labelledby={id} style={{ paddingLeft: 20 }}>
              {doc.versions?.map((v) => (
                <li key={v.id} style={{ padding: "10px 0" }}>
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href={`/api/v1/documents/${doc.id}/download?versionId=${encodeURIComponent(v.id)}`}
                  >
                    Download version {v.version} of {file.name}
                  </a>
                  <span className={s.fieldHint}>
                    {" "}
                    · {date(v.createdAt)}
                    {v.size ? ` · ${Math.ceil(v.size / 1024)} KB` : ""}
                  </span>
                </li>
              ))}
            </ul>
            {!coordinator &&
              actorId === doc.createdById &&
              doc.visibility !== "agent" && (
                <p className={s.fieldHint}>
                  Ireland manages revised versions while this document is shared
                  with clients.
                </p>
              )}
            {canVersion && (
              <form
                style={{ marginTop: 18 }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  setBusy(true);
                  setError("");
                  setMessage("");
                  try {
                    const body = new FormData(form);
                    const upload = body.get("file");
                    if (!(upload instanceof File))
                      throw new Error("Choose a revised file.");
                    validateFile(upload);
                    body.set("visibility", doc.visibility);
                    body.set("category", doc.category);
                    await api(`/api/v1/documents/${doc.id}/versions`, {
                      method: "POST",
                      body,
                    });
                    form.reset();
                    await q.refresh();
                    await refresh();
                    setMessage(
                      "New version uploaded. Previous versions are still in the history.",
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label className={s.field}>
                  Upload a new version
                  <input
                    className={s.input}
                    type="file"
                    name="file"
                    required
                    accept={
                      doc.mimeType === "application/pdf" ? ".pdf" : ".docx"
                    }
                    disabled={busy}
                  />
                </label>
                <p className={s.fieldHint}>
                  Use the same file format. Existing sharing stays in place and
                  includes the new version. Older versions remain available to
                  everyone who can access this document.
                </p>
                <button className={s.buttonSecondary} disabled={busy}>
                  {busy ? "Uploading…" : "Upload new version"}
                </button>
              </form>
            )}
          </>
        )}
      </details>
      {error && (
        <p className={s.error} role="alert">
          {error}{" "}
          <button
            className={s.buttonSmall}
            disabled={busy}
            onClick={() => void q.refresh()}
          >
            Reload file details
          </button>
        </p>
      )}
      {message && (
        <p className={s.notice} role="status">
          {message}
        </p>
      )}
    </article>
  );
}
