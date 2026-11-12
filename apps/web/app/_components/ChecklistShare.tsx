"use client";
import { useState } from "react";
import { api } from "@weatherly/ui";
import { useLiveData } from "./useLiveData";
import s from "./checklist.module.css";

type PreviewTask = { id: string; title: string; visibility?: string };
type ShareState = {
  active: boolean;
  canCopy?: boolean;
  expiresAt?: string;
  createdAt?: string;
  id?: string;
};
export default function ChecklistShare({
  matterId,
  tasks,
}: {
  matterId: string;
  tasks: PreviewTask[];
}) {
  const path = `/api/v1/matters/${matterId}/checklist-share`;
  const q = useLiveData<ShareState>(path);
  const [generated, setGenerated] = useState<{
    url: string;
    id?: string;
    createdAt?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const clientTasks = tasks.filter((task) =>
    ["client", "client_only"].includes(task.visibility || ""),
  );
  const currentLink =
    q.data?.active &&
    generated &&
    (!q.data.id || !generated.id || q.data.id === generated.id) &&
    (!q.data.createdAt ||
      !generated.createdAt ||
      q.data.createdAt === generated.createdAt)
      ? generated.url
      : "";
  async function change(method: "POST" | "DELETE") {
    setBusy(true);
    setError("");
    setNotice("");
    setGenerated(null);
    try {
      const result = await api<{
        url?: string;
        id?: string;
        createdAt?: string;
      }>(path, {
        method,
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (method === "POST" && result.url) {
        setGenerated({
          url: result.url,
          id: result.id,
          createdAt: result.createdAt,
        });
        setNotice("Client link ready to copy.");
      } else
        setNotice(
          "Client link revoked. Anyone with the previous link will lose access.",
        );
      await q.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not change sharing. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={s.share} aria-label="Client checklist sharing">
      <p className={s.eyebrow}>Client checklist link</p>
      <h2>Share the live checklist</h2>
      <p>
        Anyone with this read-only link can see the client timeline, shared
        documents, and shared contacts.
      </p>
      <details className={s.preview}>
        <summary>
          Preview {clientTasks.length} client-visible{" "}
          {clientTasks.length === 1 ? "step" : "steps"}
        </summary>
        {clientTasks.length ? (
          <ul>
            {clientTasks.map((task) => (
              <li key={task.id}>{task.title}</li>
            ))}
          </ul>
        ) : (
          <p>
            No steps are client-visible yet. Ireland can change a step’s
            visibility in the checklist.
          </p>
        )}
        <p>
          The client timeline includes appointments for Closing and Final
          Walkthrough when they are scheduled.
        </p>
      </details>
      {q.data?.active && (
        <p>
          Sharing is active
          {q.data.expiresAt
            ? ` until ${new Date(q.data.expiresAt).toLocaleDateString()}`
            : ""}
          .
        </p>
      )}
      {!q.data?.active && q.data && <p>No active client checklist link.</p>}
      {q.error && (
        <p role="alert">
          Unable to check sharing.{" "}
          <button onClick={() => void q.refresh()}>Try again</button>
        </p>
      )}
      {q.data?.active && !q.data.canCopy && !currentLink && (
        <p className={s.hint}>
          Replace this older link to make it copyable. The previous link will
          stop working.
        </p>
      )}
      <div className={s.actions}>
        <button
          className={s.primary}
          disabled={busy || !q.data}
          onClick={() => void change("POST")}
        >
          {busy
            ? "Updating…"
            : q.data?.active
              ? "Replace link"
              : "Generate client link"}
        </button>
        {q.data?.active && (
          <button
            className={s.secondary}
            disabled={busy}
            onClick={() => void change("DELETE")}
          >
            Revoke link
          </button>
        )}
      </div>
      {q.data?.active && q.data.canCopy && !currentLink && (
        <CopyClientLink matterId={matterId} />
      )}
      {currentLink && (
        <div className={s.linkField}>
          <label htmlFor={`checklist-link-${matterId}`}>
            Client checklist link
          </label>
          <input
            id={`checklist-link-${matterId}`}
            aria-label="Client checklist link"
            value={currentLink}
            readOnly
            autoComplete="off"
            spellCheck={false}
            onFocus={(e) => e.target.select()}
          />
          <button
            className={s.secondary}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(currentLink);
                setNotice("Client checklist link copied.");
              } catch {
                setNotice("Select the link field and copy it manually.");
                document.getElementById(`checklist-link-${matterId}`)?.focus();
              }
            }}
          >
            Copy link
          </button>
        </div>
      )}
      {notice && (!generated || currentLink) && (
        <p role="status" className={s.hint}>
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
    </section>
  );
}

export function CopyClientLink({ matterId }: { matterId: string }) {
  const [manualUrl, setManualUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function copy() {
    setPending(true);
    setManualUrl("");
    setNotice("");
    setError("");
    try {
      const link = await api<{ url: string }>(
        `/api/v1/matters/${matterId}/checklist-share/copy`,
        {
          method: "POST",
          cache: "no-store",
        },
      );
      try {
        await navigator.clipboard.writeText(link.url);
        setNotice("Client link copied.");
      } catch {
        setManualUrl(link.url);
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not copy the client link.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={s.linkField}>
      <button
        className={s.secondary}
        type="button"
        disabled={pending}
        onClick={() => void copy()}
      >
        {pending ? "Copying…" : "Copy client link"}
      </button>
      {manualUrl && (
        <input
          aria-label="Client link to copy"
          readOnly
          value={manualUrl}
          onFocus={(event) => event.target.select()}
        />
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
