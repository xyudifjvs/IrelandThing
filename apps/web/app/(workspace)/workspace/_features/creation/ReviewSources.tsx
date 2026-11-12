"use client";

import { useRef } from "react";
import { validateDocumentFile } from "../../../../_lib/document-uploads";
import { api } from "../../_components/data";
import { isExtracting, type Review } from "./review-model";
import type { SourceVersion } from "@weatherly/platform/handoff-contracts";
import s from "./creation.module.css";

export function ReviewSources({
  review,
  busy,
  onPin,
  onUpload,
  onExtraction,
}: {
  review: Review;
  busy: boolean;
  onPin: (sources: SourceVersion[]) => void;
  onUpload: (upload: () => Promise<SourceVersion>) => void;
  onExtraction: (action: "start" | "skip") => void;
}) {
  const requestIds = useRef(new Map<string, string>());
  const running = isExtracting(review);
  const status = review.extraction.status;

  function upload(file: File) {
    onUpload(async () => {
      const error = validateDocumentFile(file);
      if (error) throw Error(error);
      const fileKey = JSON.stringify([file.name, file.size, file.lastModified]);
      const id = requestIds.current.get(fileKey) ?? crypto.randomUUID();
      requestIds.current.set(fileKey, id);
      const body = new FormData();
      body.set("file", file);
      body.set("category", "contract");
      body.set("creationReviewId", review.id);
      body.set("uploadRequestId", id);
      const result = await api<{ id: string; versions: { id: string }[] }>(
        "/api/v1/documents",
        { method: "POST", body },
      );
      if (!result.versions[0])
        throw Error("The upload did not return a saved version.");
      return { documentId: result.id, versionId: result.versions[0].id };
    });
  }

  return (
    <section className={s.section} aria-labelledby="creation-sources">
      <h2 id="creation-sources">Contract documents</h2>
      {review.documents.length > 0 && (
        <ul className={s.documents}>
          {review.documents.map((doc) => {
            const selected = review.sources.find(
              ({ documentId }) => documentId === doc.id,
            );
            const viewVersion = selected?.versionId ?? doc.latestVersion?.id;
            const latest = doc.latestVersion;
            const others = review.sources.filter(
              ({ documentId }) => documentId !== doc.id,
            );
            return (
              <li key={doc.id}>
                <span>{doc.name}</span>
                {viewVersion && (
                  <a
                    href={`/api/v1/documents/${encodeURIComponent(doc.id)}/view?versionId=${encodeURIComponent(viewVersion)}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`View ${doc.name}`}
                  >
                    View
                  </a>
                )}
                {latest && (
                  <label>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={!!selected}
                      onChange={(event) =>
                        onPin(
                          event.target.checked
                            ? [
                                ...others,
                                { documentId: doc.id, versionId: latest.id },
                              ]
                            : others,
                        )
                      }
                    />
                    Use for extraction
                  </label>
                )}
                {selected && latest && selected.versionId !== latest.id && (
                  <button
                    className={s.secondary}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      onPin([
                        ...others,
                        { documentId: doc.id, versionId: latest.id },
                      ])
                    }
                  >
                    Use latest version
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <label className={s.upload}>
        {review.sources.length
          ? "Upload a replacement contract"
          : "Upload contract"}
        <input
          type="file"
          accept=".pdf,.docx"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) upload(file);
          }}
        />
      </label>
      <div className={s.actions}>
        <span role="status">
          {running
            ? "Reading contract dates…"
            : status === "unavailable"
              ? "Extraction is unavailable. You can enter the dates."
              : status === "skipped"
                ? "Extraction skipped."
                : status === "proposed"
                  ? "Suggested dates are ready to review."
                  : ""}
        </span>
        {review.sources.length > 0 && (
          <button
            type="button"
            className={s.secondary}
            disabled={busy}
            onClick={() => onPin([])}
          >
            Clear selected sources
          </button>
        )}
        {running ? (
          <button
            type="button"
            className={s.secondary}
            disabled={busy}
            onClick={() => onExtraction("skip")}
          >
            Skip extraction
          </button>
        ) : (
          review.sources.length > 0 &&
          status !== "proposed" && (
            <button
              type="button"
              className={s.secondary}
              disabled={busy}
              onClick={() => onExtraction("start")}
            >
              {status === "idle" ? "Extract dates" : "Retry extraction"}
            </button>
          )
        )}
      </div>
    </section>
  );
}
