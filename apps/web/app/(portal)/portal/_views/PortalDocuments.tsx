"use client";

import { useEffect, useRef, useState } from "react";
import { type PortalDocument, shortDate } from "./portal-model";
import s from "../_components/portal.module.css";

function DocumentActions({
  document,
  bearer,
}: {
  document: PortalDocument;
  bearer?: string;
}) {
  const name = document.name || document.filename || "Document";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
    },
    [bearer],
  );

  async function read(action: "view" | "download") {
    if (!bearer || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/public/checklist/documents/${encodeURIComponent(document.id)}/${action}`,
        {
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          headers: { Authorization: `Bearer ${bearer}` },
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error("This document is unavailable.");
      const contents = await response.blob();
      if (controller.signal.aborted) return;
      const blobUrl = URL.createObjectURL(contents);
      if (action === "view" && contents.type === "application/pdf") {
        const newTab = window.open(blobUrl, "_blank");
        if (newTab) newTab.opener = null;
        else window.location.assign(blobUrl);
      } else {
        const link = window.document.createElement("a");
        link.href = blobUrl;
        link.download = name;
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch {
      if (!controller.signal.aborted) setError("This document is unavailable.");
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  const path = `/api/v1/documents/${encodeURIComponent(document.id)}`;
  return (
    <div className={s.documentActions}>
      {bearer ? (
        <>
          <button
            className={s.secondary}
            type="button"
            disabled={busy}
            onClick={() => void read("view")}
            aria-label={`View ${name}`}
          >
            View
          </button>
          <button
            className={s.secondary}
            type="button"
            disabled={busy}
            onClick={() => void read("download")}
            aria-label={`Download ${name}`}
          >
            Download
          </button>
        </>
      ) : (
        <>
          <a
            className={s.secondary}
            href={`${path}/view`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${name}`}
          >
            View
          </a>
          <a
            className={s.secondary}
            href={`${path}/download`}
            aria-label={`Download ${name}`}
          >
            Download
          </a>
        </>
      )}
      {error && (
        <span className={s.errorText} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function PortalDocuments({
  documents,
  client = false,
  bearer,
  archiveHref,
}: {
  documents: readonly PortalDocument[];
  client?: boolean;
  bearer?: string;
  archiveHref?: string;
}) {
  if (client && !documents.length) return null;
  const list = documents.length ? (
    <ul className={s.list}>
      {documents.map((document) => (
        <li className={s.listRow} key={document.id}>
          <div>
            <strong>{document.name || document.filename || "Document"}</strong>
            {document.createdAt && <p>Added {shortDate(document.createdAt)}</p>}
          </div>
          <DocumentActions document={document} bearer={bearer} />
        </li>
      ))}
    </ul>
  ) : (
    <p className={s.muted}>No documents have been shared.</p>
  );
  if (!client)
    return (
      <>
        {archiveHref && documents.length > 0 && (
          <a className={s.secondary} href={archiveHref}>
            Download all as ZIP
          </a>
        )}
        {list}
      </>
    );
  return (
    <section className={s.panel} aria-label="Your documents">
      <h2>Your documents</h2>
      {list}
    </section>
  );
}
