import { describe, expect, it } from "vitest";
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_UPLOAD_CONCURRENCY,
  runUploadWorkers,
  validateDocumentFile,
  uploadErrorMessage,
} from "../apps/web/app/_lib/document-uploads";

describe("document queue resource and validation checks", () => {
  it("keeps only two uploads active while every file completes despite an individual failure", async () => {
    let active = 0;
    let peak = 0;
    const outcomes = new Map<number, string>();
    await runUploadWorkers([0, 1, 2, 3, 4, 5], async (id) => {
      active++;
      peak = Math.max(peak, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 4));
        if (id === 1) throw new Error("Synthetic transient failure");
        outcomes.set(id, "saved");
      } catch {
        // The queue records individual errors so one failure cannot stop peers.
        outcomes.set(id, "failed");
      } finally {
        active--;
      }
    });
    expect(peak).toBe(DOCUMENT_UPLOAD_CONCURRENCY);
    expect(active).toBe(0);
    expect([...outcomes].sort()).toEqual([
      [0, "saved"],
      [1, "failed"],
      [2, "saved"],
      [3, "saved"],
      [4, "saved"],
      [5, "saved"],
    ]);
    const retry: number[] = [];
    await runUploadWorkers(
      [...outcomes]
        .filter(([, status]) => status === "failed")
        .map(([id]) => id),
      async (id) => {
        retry.push(id);
        outcomes.set(id, "saved");
      },
    );
    expect(retry).toEqual([1]);
    expect([...outcomes.values()].every((status) => status === "saved")).toBe(
      true,
    );
  });

  it("accepts exact size boundaries and uppercase formats while rejecting each bad file independently", () => {
    expect(validateDocumentFile({ name: "valid.PDF", size: 1 })).toBeNull();
    expect(
      validateDocumentFile({ name: "valid.DOCX", size: DOCUMENT_MAX_BYTES }),
    ).toBeNull();
    expect(validateDocumentFile({ name: "empty.pdf", size: 0 })).toMatch(
      /nonempty/i,
    );
    expect(
      validateDocumentFile({ name: "large.pdf", size: DOCUMENT_MAX_BYTES + 1 }),
    ).toMatch(/20 MB/);
    expect(validateDocumentFile({ name: "legacy.doc", size: 100 })).toMatch(
      /convert/i,
    );
    expect(
      validateDocumentFile({ name: "word.docx", size: 100 }, "pdf"),
    ).toMatch(/same format/i);
  });

  it("starts no worker for an empty selection", async () => {
    let calls = 0;
    await runUploadWorkers([], async () => {
      calls++;
    });
    expect(calls).toBe(0);
  });

  it("explains interrupted connections and preserves specific server errors", () => {
    expect(uploadErrorMessage(new TypeError("Failed to fetch"))).toMatch(
      /connection.*retry/i,
    );
    expect(uploadErrorMessage(new Error("Choose a smaller PDF"))).toBe(
      "Choose a smaller PDF",
    );
  });
});
