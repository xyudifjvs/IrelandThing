"use client";

import { api } from "../../_components/data";
import {
  DocumentUploadQueue,
  useDocumentUploadQueue,
} from "../../../../_components/DocumentUploadQueue";

export function EmailAttachmentUpload({
  matterId,
  attach,
  refresh,
}: {
  matterId: string;
  attach: (id: string) => void;
  refresh: () => Promise<void>;
}) {
  const queue = useDocumentUploadQueue<{ id: string }>({
    guardNavigation: true,
    upload: (file, itemId) => {
      const body = new FormData();
      body.set("file", file, file.name);
      body.set("matterId", matterId);
      body.set("category", "email_attachment");
      body.set("uploadRequestId", itemId);
      return api("/api/v1/documents", { method: "POST", body });
    },
    finalize: async (result) => attach(result.id),
    onBatchComplete: refresh,
  });
  return (
    <DocumentUploadQueue
      queue={queue}
      label="Choose attachments"
      uploadLabel="Upload and attach"
      hint="New attachments are stored privately on this file."
    />
  );
}
