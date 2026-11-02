"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  DOCUMENT_QUEUE_MAX_BYTES,
  DOCUMENT_QUEUE_MAX_FILES,
  runUploadWorkers,
  uploadErrorMessage,
  validateDocumentFile,
} from "../_lib/document-uploads";
import s from "./DocumentUploadQueue.module.css";

export type DocumentUploadStatus =
  "queued" | "uploading" | "linking" | "saved" | "failed" | "invalid";

export type DocumentUploadEntry<T> = {
  /** Also used as the uploadRequestId, making a response-loss retry safe. */
  id: string;
  name: string;
  size: number;
  lastModified: number;
  type: string;
  file?: File;
  status: DocumentUploadStatus;
  error?: string;
  result?: T;
  uploaded: boolean;
};

export type UploadBatchSummary = {
  saved: number;
  failed: number;
  invalid: number;
};

type QueueOptions<T> = {
  upload: (file: File, itemId: string) => Promise<T>;
  /** If linking fails, retry this step using the existing uploaded result. */
  finalize?: (result: T, file: File) => Promise<void>;
  onBatchComplete?: (summary: UploadBatchSummary) => Promise<void> | void;
  validate?: (file: File) => string | null;
  maxFiles?: number;
  maxTotalBytes?: number;
  /** Opt in for views whose parent navigation would unmount the queue. */
  guardNavigation?: boolean;
  /** Signed evidence is private but still needs its explicit agreement record. */
  retainSavedUntilClear?: boolean;
};

export type DocumentUploadQueueState<T> = {
  entries: DocumentUploadEntry<T>[];
  running: boolean;
  hasPending: boolean;
  selectionError: string;
  completionError: string;
  maxFiles: number;
  maxTotalBytes: number;
  addFiles: (files: Iterable<File> | ArrayLike<File>) => void;
  remove: (id: string) => void;
  clearSaved: () => void;
  clear: () => void;
  start: (ids?: string[]) => Promise<UploadBatchSummary | null>;
  retry: (id: string) => Promise<UploadBatchSummary | null>;
  refresh: () => Promise<void>;
};

export function useDocumentUploadQueue<T>(
  options: QueueOptions<T>,
): DocumentUploadQueueState<T> {
  const [entries, setEntries] = useState<DocumentUploadEntry<T>[]>([]);
  const entriesRef = useRef(entries);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [selectionError, setSelectionError] = useState("");
  const [completionError, setCompletionError] = useState("");
  const navigationApproved = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const maxFiles = options.maxFiles ?? DOCUMENT_QUEUE_MAX_FILES;
  const maxTotalBytes = options.maxTotalBytes ?? DOCUMENT_QUEUE_MAX_BYTES;

  function replace(next: DocumentUploadEntry<T>[]) {
    entriesRef.current = next;
    setEntries(next);
  }
  function change(id: string, patch: Partial<DocumentUploadEntry<T>>) {
    replace(
      entriesRef.current.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry,
      ),
    );
  }
  const hasPending = entries.some((entry) => entry.status !== "saved");
  const hasUnrecordedSaved =
    !!options.retainSavedUntilClear &&
    entries.some((entry) => entry.status === "saved");
  useEffect(() => {
    if (!hasPending && !running && !hasUnrecordedSaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (navigationApproved.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    function guard(event: MouseEvent | KeyboardEvent) {
      if (
        !options.guardNavigation ||
        event.defaultPrevented ||
        !(event.target instanceof Element)
      )
        return;
      const tab = event.target.closest('[role="tab"]');
      if (event instanceof KeyboardEvent) {
        if (
          !tab ||
          ![
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Home",
            "End",
          ].includes(event.key)
        )
          return;
      } else {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
        if (anchor) {
          if (
            anchor.hasAttribute("download") ||
            (anchor.target && anchor.target !== "_self")
          )
            return;
          const target = new URL(anchor.href, window.location.href);
          if (!["http:", "https:"].includes(target.protocol)) return;
          if (
            target.pathname === window.location.pathname &&
            target.search === window.location.search &&
            target.origin === window.location.origin
          )
            return;
        } else if (!tab || tab.getAttribute("aria-selected") === "true") return;
      }
      if (runningRef.current) {
        event.preventDefault();
        event.stopPropagation();
        setSelectionError(
          "Wait for uploads to finish before leaving this view.",
        );
        return;
      }
      const message = hasUnrecordedSaved
        ? "Leave this view? Uploaded private documents remain saved, but the service agreement has not been recorded. Selected files and agreement choices will be cleared."
        : "Leave this view and clear selected or unfinished files? Completed uploads remain saved.";
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      navigationApproved.current = true;
      replace([]);
      setSelectionError("");
    }
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guard, true);
    document.addEventListener("keydown", guard, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guard, true);
      document.removeEventListener("keydown", guard, true);
    };
  }, [hasPending, running, hasUnrecordedSaved, options.guardNavigation]);

  function addFiles(files: Iterable<File> | ArrayLike<File>) {
    if (runningRef.current) return;
    navigationApproved.current = false;
    const next = [...entriesRef.current];
    let totalBytes = next.reduce(
      (sum, entry) => sum + (entry.file?.size ?? 0),
      0,
    );
    let duplicates = 0;
    let omitted = 0;
    const iterable =
      Symbol.iterator in Object(files)
        ? (files as Iterable<File>)
        : {
            *[Symbol.iterator]() {
              const list = files as ArrayLike<File>;
              for (let i = 0; i < list.length; i++) yield list[i];
            },
          };
    // Never read content or retain more File objects than the queue limit.
    for (const file of iterable) {
      if (next.length >= maxFiles) {
        omitted++;
        break;
      }
      if (
        next.some(
          (entry) =>
            entry.name === file.name &&
            entry.size === file.size &&
            entry.lastModified === file.lastModified &&
            entry.type === file.type,
        )
      ) {
        duplicates++;
        continue;
      }
      const error =
        (optionsRef.current.validate ?? validateDocumentFile)(file) ||
        (totalBytes + file.size > maxTotalBytes
          ? `This selection exceeds ${Math.floor(maxTotalBytes / 1024 / 1024)} MB in total. Remove files or upload a smaller batch.`
          : null);
      next.push({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        type: file.type,
        ...(error ? {} : { file }),
        status: error ? "invalid" : "queued",
        error: error ?? undefined,
        uploaded: false,
      });
      if (!error) totalBytes += file.size;
    }
    replace(next);
    setSelectionError(
      [
        omitted
          ? `Additional files were not added. The queue holds ${maxFiles} files; clear completed or remove selected files, then add the rest.`
          : "",
        duplicates
          ? `${duplicates} file(s) are already in this queue and were not added twice.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  function summarize(ids?: string[]): UploadBatchSummary {
    const batch = entriesRef.current.filter(
      (entry) => !ids || ids.includes(entry.id),
    );
    return {
      saved: batch.filter((entry) => entry.status === "saved").length,
      failed: batch.filter((entry) => entry.status === "failed").length,
      invalid: batch.filter((entry) => entry.status === "invalid").length,
    };
  }

  async function refresh() {
    setCompletionError("");
    try {
      await optionsRef.current.onBatchComplete?.(summarize());
    } catch (error) {
      setCompletionError(
        `Your saved uploads are retained. The list could not refresh: ${uploadErrorMessage(error)}`,
      );
    }
  }

  async function start(ids?: string[]) {
    // Ref guards same-tick double clicks before React has rendered disabled UI.
    if (runningRef.current) return null;
    const batch = entriesRef.current.filter(
      (entry) =>
        (entry.status === "queued" || entry.status === "failed") &&
        (!ids || ids.includes(entry.id)),
    );
    if (!batch.length) return summarize(ids);
    runningRef.current = true;
    setRunning(true);
    setSelectionError("");
    setCompletionError("");
    const callbacks = optionsRef.current;
    try {
      await runUploadWorkers(batch, async (item) => {
        const file = item.file;
        if (!file) return;
        let result = item.result;
        let uploaded = item.uploaded;
        change(item.id, {
          status: uploaded ? "linking" : "uploading",
          error: undefined,
        });
        try {
          if (!uploaded) {
            result = await callbacks.upload(file, item.id);
            uploaded = true;
            change(item.id, {
              result,
              uploaded: true,
              status: callbacks.finalize ? "linking" : "uploading",
            });
          }
          await callbacks.finalize?.(result as T, file);
          // Retain metadata and result; release the File after durable success.
          change(item.id, {
            status: "saved",
            file: undefined,
            error: undefined,
          });
        } catch (error) {
          change(item.id, {
            status: "failed",
            result,
            uploaded,
            error: `${uploaded ? "File uploaded; finishing its association failed. Retry finishes saving without uploading the file again. " : ""}${uploadErrorMessage(error)}`,
          });
        }
      });
      const summary = summarize(batch.map((entry) => entry.id));
      try {
        await callbacks.onBatchComplete?.(summary);
      } catch (error) {
        setCompletionError(
          `Your saved uploads are retained. The list could not refresh: ${uploadErrorMessage(error)}`,
        );
      }
      return summary;
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  return {
    entries,
    running,
    hasPending,
    selectionError,
    completionError,
    maxFiles,
    maxTotalBytes,
    addFiles,
    remove: (id) => {
      if (runningRef.current) return;
      replace(entriesRef.current.filter((entry) => entry.id !== id));
      setSelectionError("");
    },
    clearSaved: () => {
      if (runningRef.current) return;
      replace(entriesRef.current.filter((entry) => entry.status !== "saved"));
      setSelectionError("");
    },
    clear: () => {
      if (runningRef.current) return;
      replace([]);
      setSelectionError("");
      setCompletionError("");
    },
    start,
    retry: (id) => start([id]),
    refresh,
  };
}

export function DocumentUploadQueue<T>({
  queue,
  label = "Choose documents",
  disabled = false,
  hideUploadButton = false,
  uploadLabel = "Upload selected documents",
  hint,
  hideClearCompleted = false,
}: {
  queue: DocumentUploadQueueState<T>;
  label?: string;
  disabled?: boolean;
  hideUploadButton?: boolean;
  hideClearCompleted?: boolean;
  uploadLabel?: string;
  hint?: string;
}) {
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const locked = disabled || queue.running;
  const ready = queue.entries.filter(
    (entry) => entry.status === "queued" || entry.status === "failed",
  ).length;
  const saved = queue.entries.filter(
    (entry) => entry.status === "saved",
  ).length;
  const statusText: Record<DocumentUploadStatus, string> = {
    queued: "Ready to upload",
    uploading: "Uploading…",
    linking: "Finishing save…",
    saved: "Saved",
    failed: "Needs attention",
    invalid: "Cannot upload",
  };
  return (
    <div className={s.queue} aria-busy={queue.running}>
      <div
        className={`${s.dropzone}${dragging ? ` ${s.dragging}` : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!locked) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node))
            setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!locked) queue.addFiles(event.dataTransfer.files);
        }}
      >
        <label className={s.label} htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          type="file"
          accept=".pdf,.docx"
          multiple
          disabled={locked}
          aria-describedby={`${id}-hint`}
          className={s.input}
          onChange={(event) => {
            if (event.currentTarget.files)
              queue.addFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
        <p id={`${id}-hint`} className={s.hint}>
          {hint ||
            `Choose or drop PDF or DOCX files. Up to 20 MB each; ${queue.maxFiles} files and ${Math.floor(queue.maxTotalBytes / 1024 / 1024)} MB per batch. Two files upload at a time.`}
        </p>
      </div>
      {queue.selectionError && (
        <p className={s.error} role="alert">
          {queue.selectionError}
        </p>
      )}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={s.summary}
      >
        {queue.entries.length > 0 &&
          `${saved} of ${queue.entries.length} saved${queue.running ? "; uploads in progress. Keep this page open." : "."}`}
      </div>
      {queue.entries.length > 0 && (
        <ul className={s.list} aria-label="Selected document uploads">
          {queue.entries.map((entry) => (
            <li className={s.item} key={entry.id}>
              <div className={s.details}>
                <strong className={s.name}>{entry.name}</strong>
                <span className={s.meta}>
                  {Math.max(1, Math.ceil(entry.size / 1024))} KB ·{" "}
                  <span
                    role="status"
                    aria-live="polite"
                    className={entry.status === "saved" ? s.saved : undefined}
                  >
                    <span className={s.srOnly}>{entry.name}: </span>
                    {statusText[entry.status]}
                  </span>
                </span>
                {entry.error && (
                  <p className={s.error} role="alert">
                    <span className={s.srOnly}>{entry.name}: </span>
                    {entry.error}
                  </p>
                )}
              </div>
              <div className={s.actions}>
                {entry.status === "failed" && (
                  <button
                    type="button"
                    className={s.button}
                    disabled={locked}
                    onClick={() => void queue.retry(entry.id)}
                    aria-label={`Retry ${entry.name}`}
                  >
                    Retry
                  </button>
                )}
                {entry.status !== "saved" && (
                  <button
                    type="button"
                    className={s.button}
                    disabled={locked}
                    onClick={() => queue.remove(entry.id)}
                    aria-label={`Remove ${entry.name} from upload queue`}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {queue.completionError && (
        <p className={s.error} role="alert">
          {queue.completionError}{" "}
          <button
            type="button"
            className={s.button}
            disabled={locked}
            onClick={() => void queue.refresh()}
          >
            Refresh list
          </button>
        </p>
      )}
      <div className={s.actions}>
        {!hideUploadButton && (
          <button
            type="button"
            className={s.primary}
            disabled={locked || !ready}
            onClick={() => void queue.start()}
          >
            {queue.running ? "Uploading documents…" : uploadLabel}
          </button>
        )}
        {saved > 0 && !hideClearCompleted && (
          <button
            type="button"
            className={s.button}
            disabled={locked}
            onClick={queue.clearSaved}
          >
            Clear completed from queue
          </button>
        )}
      </div>
    </div>
  );
}
