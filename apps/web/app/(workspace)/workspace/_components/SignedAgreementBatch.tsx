"use client";
import { useRef, useState } from "react";
import { api, mutate } from "./data";
import {
  DocumentUploadQueue,
  useDocumentUploadQueue,
} from "../../../_components/DocumentUploadQueue";
import s from "./workspace.module.css";

type SavedDocument = { id: string; name: string };

export default function SignedAgreementBatch({
  onSaved,
}: {
  onSaved: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [version, setVersion] = useState("");
  const [primaryId, setPrimaryId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const recordRequest = useRef({ payload: "", id: "" });
  const queue = useDocumentUploadQueue<SavedDocument>({
    guardNavigation: true,
    retainSavedUntilClear: true,
    upload: async (file, itemId) => {
      const body = new FormData();
      body.set("file", file);
      body.set("visibility", "coordinator");
      body.set("category", "service_agreement");
      body.set("uploadRequestId", itemId);
      return api<SavedDocument>("/api/v1/documents", { method: "POST", body });
    },
  });
  const saved = queue.entries.filter(
    (item) => item.status === "saved" && item.result,
  );
  return (
    <form
      style={{ display: "grid", gap: 13, marginTop: 20 }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (saving || queue.running || queue.hasPending) return;
        if (
          saved.length &&
          !saved.some((item) => item.result!.id === primaryId)
        ) {
          setError("Choose the primary signed agreement from the saved files.");
          return;
        }
        setSaving(true);
        setError("");
        setMessage("");
        try {
          const payload = {
            userId: email,
            version,
            status: saved.length ? "approved" : "draft",
            ...(saved.length
              ? {
                  documentId: primaryId,
                  supportingDocumentIds: saved
                    .map((item) => item.result!.id)
                    .filter((id) => id !== primaryId),
                }
              : {}),
          };
          const serialized = JSON.stringify(payload);
          if (recordRequest.current.payload !== serialized) {
            recordRequest.current = {
              payload: serialized,
              id: crypto.randomUUID(),
            };
          }
          await mutate("/api/v1/onboarding/agreements", {
            ...payload,
            agreementRequestId: recordRequest.current.id,
          });
          recordRequest.current = { payload: "", id: "" };
          queue.clear();
          setPrimaryId("");
          setEmail("");
          setVersion("");
          setMessage(
            saved.length
              ? "Signed agreement recorded and approved with all supporting files."
              : "Agreement draft recorded. Signed evidence is needed before approval.",
          );
          // A refresh failure must not offer to create the same agreement again.
          try {
            await onSaved();
          } catch {
            setError(
              "The agreement was saved. Refresh the agreement list to see it.",
            );
          }
        } catch (cause) {
          setError(
            (cause as Error).message +
              " Saved files remain available below; retry recording without uploading them again.",
          );
        } finally {
          setSaving(false);
        }
      }}
    >
      <label className={s.field}>
        Agent email
        <input
          className={s.input}
          name="userId"
          type="email"
          required
          value={email}
          disabled={saving || queue.running}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label className={s.field}>
        Agreement version
        <input
          className={s.input}
          name="version"
          required
          value={version}
          placeholder="e.g. 2026-01"
          disabled={saving || queue.running}
          onChange={(event) => setVersion(event.target.value)}
        />
      </label>
      <DocumentUploadQueue
        queue={queue}
        label="Signed agreement and supporting evidence"
        disabled={saving}
        hideClearCompleted
      />
      <p className={s.fieldHint}>
        All selected files belong to this agent and agreement version and stay
        private to Ireland. Upload the files, then choose one primary signed
        agreement. Other files are supporting evidence; selecting several files
        does not approve separate agreements. Save each agent’s agreement
        separately.
      </p>
      {saved.length > 0 && (
        <fieldset
          disabled={saving || queue.running}
          style={{ border: "1px solid #d4c9b7", padding: 14, minWidth: 0 }}
        >
          <legend>Primary signed agreement</legend>
          {saved.map((item) => (
            <label
              key={item.id}
              className={s.todo}
              style={{ overflowWrap: "anywhere" }}
            >
              <input
                type="radio"
                name="primaryAgreement"
                value={item.result!.id}
                checked={primaryId === item.result!.id}
                onChange={() => setPrimaryId(item.result!.id)}
              />
              {item.name}
            </label>
          ))}
        </fieldset>
      )}
      {queue.hasPending && (
        <p className={s.fieldHint}>
          Upload or remove every pending file before recording this agreement.
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
      <button
        className={s.button}
        disabled={
          saving ||
          queue.running ||
          queue.hasPending ||
          (saved.length > 0 && !primaryId)
        }
      >
        {saving
          ? "Recording agreement…"
          : saved.length
            ? "Record agreement evidence"
            : "Record agreement draft"}
      </button>
    </form>
  );
}
