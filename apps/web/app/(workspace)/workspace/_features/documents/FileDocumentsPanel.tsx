"use client";

import { useEffect, useState } from "react";
import { DocumentUploadQueue } from "../../../../_components/DocumentUploadQueue";
import type { TransactionDocumentUploads } from "../../../../_components/useTransactionDocumentUploads";
import { mutate } from "../../_components/data";
import s from "../../_components/workspace.module.css";

export type FileDocument = {
  id: string;
  name: string;
  revision?: number;
  visibility?: string;
  shareWithAgent?: boolean | null;
  shareWithClient?: boolean | null;
};

export function FileDocumentsPanel({
  matterId,
  documents,
  role,
  stage,
  uploads,
  refresh,
}: {
  matterId: string;
  documents: readonly FileDocument[];
  role: "coordinator" | "agent" | "client";
  stage: string;
  uploads?: TransactionDocumentUploads;
  refresh: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const registerRefresh = uploads?.registerRefresh;
  useEffect(() => registerRefresh?.(refresh), [refresh, registerRefresh]);
  const active = ["under_contract", "closing", "listing"].includes(stage);
  const showSwitches = role === "coordinator" && active;

  async function share(
    document: FileDocument,
    key: "shareWithAgent" | "shareWithClient",
    value: boolean,
  ) {
    setPending(true);
    setError("");
    try {
      await mutate(
        `/api/v1/documents/${document.id}`,
        {
          expectedRevision: document.revision,
          [key]: value,
        },
        "PATCH",
      );
      await refresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not update document sharing.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={s.section} aria-label="Documents">
      <div className={s.sectionHead}>
        <h2>{role === "client" ? "Your documents" : "Documents"}</h2>
        {stage === "closed" && documents.length > 0 && role !== "client" && (
          <a
            className={s.buttonSmall}
            href={`/api/v1/documents/archive/${matterId}`}
          >
            Download all as ZIP
          </a>
        )}
      </div>
      <div className={s.sectionBody}>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {documents.length === 0 && <p className={s.muted}>No documents yet.</p>}
        {documents.map((document) => (
          <div className={s.attention} key={document.id}>
            <div>
              <strong>{document.name}</strong>
              <div className={s.actions}>
                <a
                  href={`/api/v1/documents/${document.id}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View
                </a>
                <a href={`/api/v1/documents/${document.id}/download`}>
                  Download
                </a>
              </div>
            </div>
            {showSwitches && document.revision !== undefined && (
              <div>
                <label>
                  <input
                    type="checkbox"
                    disabled={pending}
                    checked={
                      document.shareWithAgent ??
                      ["agent", "client"].includes(document.visibility || "")
                    }
                    onChange={(event) =>
                      void share(
                        document,
                        "shareWithAgent",
                        event.target.checked,
                      )
                    }
                  />
                  Show on agent portal
                </label>
                <label>
                  <input
                    type="checkbox"
                    disabled={pending}
                    checked={
                      document.shareWithClient ??
                      document.visibility === "client"
                    }
                    onChange={(event) =>
                      void share(
                        document,
                        "shareWithClient",
                        event.target.checked,
                      )
                    }
                  />
                  Show on client portal
                </label>
              </div>
            )}
          </div>
        ))}
        {uploads && active && role !== "client" && (
          <DocumentUploadQueue
            queue={uploads.queue}
            disabled={!uploads.enabled}
            label="Add documents"
          />
        )}
      </div>
    </section>
  );
}
