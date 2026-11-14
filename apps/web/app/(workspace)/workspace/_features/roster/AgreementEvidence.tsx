"use client";

import { useEffect, useState } from "react";
import { api } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import styles from "./roster.module.css";

function Preview({ documentId }: { documentId: string }) {
  const [content, setContent] = useState<
    { pdf: string } | { text: string } | null
  >(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const path = `/api/v1/documents/${encodeURIComponent(documentId)}`;
    async function load() {
      try {
        const file = await api<{
          mimeType: string;
          versions: { extractedText?: string }[];
        }>(path, { signal: controller.signal });
        if (file.mimeType === "application/pdf") {
          const response = await fetch(path + "/download", {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("Could not load the agreement.");
          const bytes = await response.blob();
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(bytes);
          setContent({ pdf: objectUrl });
        } else if (!controller.signal.aborted) {
          setContent({ text: file.versions[0]?.extractedText || "" });
        }
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not load the agreement.",
          );
      }
    }
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId]);
  if (error)
    return (
      <p role="alert" className={s.error}>
        {error}
      </p>
    );
  if (!content) return <p role="status">Loading agreement…</p>;
  if ("pdf" in content)
    return (
      <iframe
        className={styles.pdf}
        src={content.pdf}
        title="Signed agreement PDF"
      />
    );
  return content.text ? (
    <pre className={styles.extracted}>{content.text}</pre>
  ) : (
    <p>Download the original to view this agreement.</p>
  );
}

export function AgreementEvidence({ documentId }: { documentId: string }) {
  const [view, setView] = useState(false);
  return (
    <>
      <div className={styles.actions}>
        <button
          type="button"
          className={s.buttonSmall}
          aria-expanded={view}
          onClick={() => setView(!view)}
        >
          {view ? "Close preview" : "View"}
        </button>
        <a
          className={s.buttonSmall}
          href={`/api/v1/documents/${encodeURIComponent(documentId)}/download`}
        >
          Download
        </a>
      </div>
      {view && <Preview documentId={documentId} />}
    </>
  );
}
