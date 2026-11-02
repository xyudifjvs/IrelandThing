import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import * as uploadHelpers from "../apps/web/app/_lib/document-uploads";
import type {
  DocumentUploadEntry,
  DocumentUploadQueueState,
} from "../apps/web/app/_components/DocumentUploadQueue";

type Saved = { id: string };
type Options = {
  upload: (file: File, receipt: string) => Promise<Saved>;
  finalize?: (saved: Saved, file: File) => Promise<void>;
  onBatchComplete?: () => Promise<void>;
  maxFiles?: number;
  maxTotalBytes?: number;
};
let states: unknown[] = [];
let cursor = 0;
const adapter = {
  useState: (initial: unknown) => {
    const index = cursor++;
    states[index] = initial;
    return [
      initial,
      (next: unknown) => {
        states[index] =
          typeof next === "function"
            ? (next as (old: unknown) => unknown)(states[index])
            : next;
      },
    ];
  },
  useRef: <T>(initial: T) => ({ current: initial }),
  useEffect: () => undefined,
};
// Execute the actual controller, compiled without the unrelated JSX renderer.
// The browser check covers real React mounting and accessible DOM presentation.
const source = readFileSync(
  resolve("apps/web/app/_components/DocumentUploadQueue.tsx"),
  "utf8",
);
const hookSource = source.slice(
  0,
  source.indexOf("export function DocumentUploadQueue<T>"),
);
const compiled = ts.transpileModule(hookSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
});
const hookModule: {
  useDocumentUploadQueue?: (
    options: Options,
  ) => DocumentUploadQueueState<Saved>;
} = {};
new Function("require", "exports", compiled.outputText)((name: string) => {
  if (name === "react") return adapter;
  if (name === "../_lib/document-uploads") return uploadHelpers;
  throw new Error(`Unexpected controller dependency ${name}`);
}, hookModule);
const useQueue = hookModule.useDocumentUploadQueue!;
const entries = () => states[0] as DocumentUploadEntry<Saved>[];
const file = (name: string) =>
  new File(["PDF"], name, { type: "application/pdf", lastModified: 123 });

beforeEach(() => {
  states = [];
  cursor = 0;
});

describe("actual document queue controller", () => {
  it("keeps successful entries, skips invalid peers and retries only failed file requests using the original receipt", async () => {
    let fail = true;
    let active = 0;
    let peak = 0;
    const upload = vi.fn(async (selected: File, receipt: string) => {
      active++;
      peak = Math.max(peak, active);
      try {
        await new Promise((done) => setTimeout(done, 2));
        if (selected.name === "retry.pdf" && fail) {
          fail = false;
          throw new Error("Retry this file");
        }
        return { id: `document-${receipt}` };
      } finally {
        active--;
      }
    });
    const queue = useQueue({ upload });
    queue.addFiles([
      file("first.pdf"),
      file("retry.pdf"),
      file("invalid.exe"),
      file("last.pdf"),
    ]);
    const retryId = entries()[1].id;
    expect(await queue.start()).toEqual({ saved: 2, failed: 1, invalid: 0 });
    expect(entries().map((entry) => entry.status)).toEqual([
      "saved",
      "failed",
      "invalid",
      "saved",
    ]);
    expect(peak).toBe(2);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(
      entries()
        .filter((entry) => entry.status === "saved")
        .every((entry) => !entry.file),
    ).toBe(true);
    expect(await queue.retry(retryId)).toEqual({
      saved: 1,
      failed: 0,
      invalid: 0,
    });
    expect(upload).toHaveBeenCalledTimes(4);
    expect(
      upload.mock.calls
        .filter(([selected]) => selected.name === "retry.pdf")
        .map(([, receipt]) => receipt),
    ).toEqual([retryId, retryId]);
    expect(entries()[1]).toMatchObject({
      status: "saved",
      uploaded: true,
      result: { id: `document-${retryId}` },
    });
    expect(entries()[1].file).toBeUndefined();
    expect(entries()[2].error).toMatch(/convert/i);
  });

  it("retries a failed association using the saved document and refreshes without uploading completed bytes again", async () => {
    const upload = vi.fn(async () => ({ id: "already-durable-document" }));
    const finalize = vi
      .fn()
      .mockRejectedValueOnce(new Error("Draft save revision conflict"))
      .mockResolvedValue(undefined);
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("List read failed"))
      .mockResolvedValue(undefined);
    const queue = useQueue({ upload, finalize, onBatchComplete: refresh });
    queue.addFiles([file("contract.pdf")]);
    const id = entries()[0].id;
    expect(await queue.start()).toEqual({ saved: 0, failed: 1, invalid: 0 });
    expect(entries()[0]).toMatchObject({
      uploaded: true,
      result: { id: "already-durable-document" },
      status: "failed",
    });
    expect(entries()[0].error).toMatch(/without uploading the file again/i);
    expect(states[3]).toMatch(/saved uploads are retained/i);
    expect(await queue.retry(id)).toEqual({ saved: 1, failed: 0, invalid: 0 });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(states[3]).toBe("");
    await queue.refresh();
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("supports removal, reports duplicates and bounds retained files/bytes without reading their contents", async () => {
    const upload = vi.fn(async () => ({ id: "saved" }));
    const queue = useQueue({ upload, maxFiles: 2, maxTotalBytes: 4 });
    const first = file("first.pdf");
    const second = file("second.pdf");
    const contentRead = vi.spyOn(first, "arrayBuffer");
    queue.addFiles([first, first, second]);
    expect(entries()).toHaveLength(2);
    expect(entries().map((entry) => entry.status)).toEqual([
      "queued",
      "invalid",
    ]);
    expect(entries()[1].file).toBeUndefined();
    expect(states[2]).toMatch(/not added twice/i);
    expect(contentRead).not.toHaveBeenCalled();
    queue.remove(entries()[0].id);
    expect(entries()).toHaveLength(1);
    expect(await queue.start()).toEqual({ saved: 0, failed: 0, invalid: 1 });
    expect(upload).not.toHaveBeenCalled();
    queue.clear();
    let emitted = 0;
    queue.addFiles({
      *[Symbol.iterator]() {
        for (let i = 0; i < 10_000; i++) {
          emitted++;
          yield file(`${i}.pdf`);
        }
      },
    });
    expect(entries()).toHaveLength(2);
    expect(emitted).toBe(3);
    expect(states[2]).toMatch(/Additional files were not added/i);
  });

  it("guards same-tick double activation before React can disable the upload button", async () => {
    let finish!: (saved: Saved) => void;
    const upload = vi.fn(
      () =>
        new Promise<Saved>((done) => {
          finish = done;
        }),
    );
    const queue = useQueue({ upload });
    queue.addFiles([file("one.pdf")]);
    const first = queue.start();
    expect(await queue.start()).toBeNull();
    expect(upload).toHaveBeenCalledTimes(1);
    finish({ id: "one-durable-document" });
    expect(await first).toEqual({ saved: 1, failed: 0, invalid: 0 });
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
