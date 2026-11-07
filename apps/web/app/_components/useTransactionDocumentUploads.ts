"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@weatherly/ui";
import {
  useDocumentUploadQueue,
  type DocumentUploadQueueState,
} from "./DocumentUploadQueue";

type SavedUpload = { id: string };
type UploadContext = {
  matterId: string;
  coordinator?: boolean;
  actorId?: string;
  /** The current authorized matter response and uploading role are available. */
  authorized: boolean;
};

export type TransactionDocumentUploads = {
  queue: DocumentUploadQueueState<SavedUpload>;
  visibility: string;
  setVisibility: (visibility: string) => void;
  enabled: boolean;
  registerRefresh: (refresh: () => Promise<void>) => () => void;
};

/** Retain local upload receipts above transient matter loading/error views. */
export function useTransactionDocumentUploads(
  context: UploadContext,
): TransactionDocumentUploads {
  const key = `${context.matterId}:${context.actorId || ""}:${!!context.coordinator}`;
  const active = useRef({ ...context, key });
  active.current = { ...context, key };
  const [boundKey, setBoundKey] = useState(key);
  const [visibility, setVisibility] = useState("agent");
  const refreshRef = useRef(new Set<() => Promise<void>>());
  const registerRefresh = useCallback((refresh: () => Promise<void>) => {
    refreshRef.current.add(refresh);
    return () => {
      refreshRef.current.delete(refresh);
    };
  }, []);

  const queue = useDocumentUploadQueue<SavedUpload>({
    guardNavigation: true,
    upload: async (file, itemId) => {
      // A batch captures its original context. Check again before every worker
      // request, including queued work after an account/access change.
      if (active.current.key !== key || boundKey !== key)
        throw new Error(
          "Your account or transaction changed. Reopen the intended transaction before selecting this file again.",
        );
      if (!active.current.authorized || !active.current.actorId)
        throw new Error(
          "Transaction access is not currently confirmed. Reload this transaction, then retry the file.",
        );
      const body = new FormData();
      body.set("file", file, file.name);
      body.set("matterId", context.matterId);
      body.set("category", "other");
      body.set("visibility", context.coordinator ? visibility : "agent");
      body.set("uploadRequestId", itemId);
      const saved = await api<SavedUpload>("/api/v1/documents", {
        method: "POST",
        body,
      });
      // Keep only this upload receipt. Never retain an authorized server list
      // above the matter's loading/error boundary.
      return { id: saved.id };
    },
    onBatchComplete: async () => {
      await Promise.all([...refreshRef.current].map(refresh => refresh()));
    },
  });
  const matchesContext = boundKey === key;
  const enabled = matchesContext && context.authorized && !!context.actorId;
  useEffect(() => {
    if (matchesContext || queue.running) return;
    queue.clear();
    setVisibility("agent");
    setBoundKey(key);
  }, [matchesContext, queue.running, key]);

  return {
    queue: {
      ...queue,
      // Hide old-account metadata immediately, before the cleanup effect runs.
      entries: matchesContext ? queue.entries : [],
      hasPending: matchesContext && queue.hasPending,
      selectionError: matchesContext ? queue.selectionError : "",
      completionError: matchesContext ? queue.completionError : "",
      addFiles: (files) => {
        if (enabled) queue.addFiles(files);
      },
      start: (ids) => (enabled ? queue.start(ids) : Promise.resolve(null)),
      retry: (id) => (enabled ? queue.retry(id) : Promise.resolve(null)),
    },
    visibility,
    setVisibility: (value) => {
      if (enabled && !queue.running && !queue.hasPending) setVisibility(value);
    },
    enabled,
    registerRefresh,
  };
}
