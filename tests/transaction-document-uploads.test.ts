import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

type Context = {
  matterId: string;
  actorId?: string;
  coordinator?: boolean;
  authorized: boolean;
};
type QueueOptions = {
  upload: (file: File, receipt: string) => Promise<{ id: string }>;
  onBatchComplete: () => Promise<void>;
};
type Controller = {
  queue: typeof queue;
  enabled: boolean;
  visibility: string;
  setVisibility: (value: string) => void;
  registerRefresh: (fn: () => Promise<void>) => () => void;
};
let values: unknown[] = [];
let index = 0;
let effects: (() => void)[] = [];
let options: QueueOptions;
const api = vi.fn();
const queue = {
  entries: [] as {
    id: string;
    status: string;
    file?: File;
    result?: { id: string };
  }[],
  running: false,
  hasPending: false,
  selectionError: "",
  completionError: "",
  addFiles: vi.fn(),
  start: vi.fn(async (_ids?: string[]) => ({
    saved: 1,
    failed: 0,
    invalid: 0,
  })),
  retry: vi.fn(async (_id: string) => ({ saved: 1, failed: 0, invalid: 0 })),
  clear: vi.fn(() => {
    queue.entries = [];
    queue.hasPending = false;
  }),
};
const hooks = {
  useState: (initial: unknown) => {
    const slot = index++;
    if (!(slot in values)) values[slot] = initial;
    return [
      values[slot],
      (value: unknown) => {
        values[slot] = value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const slot = index++;
    if (!(slot in values)) values[slot] = { current: initial };
    return values[slot];
  },
  useCallback: (fn: unknown) => fn,
  useEffect: (effect: () => void) => {
    effects.push(effect);
  },
};
const source = readFileSync(
  resolve("apps/web/app/_components/useTransactionDocumentUploads.ts"),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
});
const moduleExports: {
  useTransactionDocumentUploads?: (context: Context) => Controller;
} = {};
new Function("require", "exports", compiled.outputText)((name: string) => {
  if (name === "react") return hooks;
  if (name === "@weatherly/ui") return { api };
  if (name === "./DocumentUploadQueue")
    return {
      useDocumentUploadQueue: (next: QueueOptions) => {
        options = next;
        return queue;
      },
    };
  throw new Error(`Unexpected transaction upload dependency ${name}`);
}, moduleExports);
const useController = moduleExports.useTransactionDocumentUploads!;
const context: Context = {
  matterId: "synthetic-matter",
  actorId: "synthetic-agent",
  coordinator: false,
  authorized: true,
};
function render(next = context) {
  index = 0;
  effects = [];
  return useController(next);
}
function flushEffects() {
  for (const effect of effects) effect();
}
const selected = () =>
  new File(["PDF"], "Synthetic contract.pdf", { type: "application/pdf" });

beforeEach(() => {
  values = [];
  index = 0;
  effects = [];
  queue.entries = [];
  queue.running = false;
  queue.hasPending = false;
  queue.selectionError = "";
  queue.completionError = "";
  vi.clearAllMocks();
  api.mockResolvedValue({
    id: "durable-upload",
    versions: [{ objectKey: "never-retain-this-server-field" }],
    unrelatedServerData: "private",
  });
});

describe("hoisted authenticated transaction upload controller", () => {
  it("retains local receipts while a transient matter read hides the child and resumes with the same queue", async () => {
    const saved = {
      id: "saved-receipt",
      status: "saved",
      result: { id: "already-durable" },
    };
    const pending = { id: "retry-receipt", status: "failed", file: selected() };
    queue.entries = [saved, pending];
    queue.hasPending = true;
    render();
    const originalWorker = options.upload;
    const paused = render({ ...context, authorized: false });
    flushEffects();
    expect(paused.enabled).toBe(false);
    expect(paused.queue.entries).toEqual([saved, pending]);
    expect(queue.clear).not.toHaveBeenCalled();
    expect(await paused.queue.retry("retry-receipt")).toBeNull();
    await expect(originalWorker(selected(), "retry-receipt")).rejects.toThrow(
      /access is not currently confirmed/i,
    );
    expect(api).not.toHaveBeenCalled();
    const resumed = render();
    flushEffects();
    expect(resumed.enabled).toBe(true);
    expect(resumed.queue.entries).toEqual([saved, pending]);
    await resumed.queue.retry("retry-receipt");
    expect(queue.retry).toHaveBeenCalledExactlyOnceWith("retry-receipt");
    expect(queue.start).not.toHaveBeenCalled();
  });

  it("masks old actor data immediately, stops old queued workers and clears before accepting a new actor", async () => {
    queue.entries = [{ id: "old-file", status: "queued", file: selected() }];
    queue.hasPending = true;
    queue.running = true;
    render();
    const originalWorker = options.upload;
    const changed = render({ ...context, actorId: "other-agent" });
    expect(changed.enabled).toBe(false);
    expect(changed.queue.entries).toEqual([]);
    expect(changed.queue.hasPending).toBe(false);
    flushEffects();
    expect(queue.clear).not.toHaveBeenCalled();
    await expect(originalWorker(selected(), "old-file")).rejects.toThrow(
      /account or transaction changed/i,
    );
    expect(api).not.toHaveBeenCalled();
    queue.running = false;
    render({ ...context, actorId: "other-agent" });
    flushEffects();
    expect(queue.clear).toHaveBeenCalledTimes(1);
    const ready = render({ ...context, actorId: "other-agent" });
    expect(ready.enabled).toBe(true);
    expect(ready.queue.entries).toEqual([]);
  });

  it("sends exact matter/scope/file/receipt context and retains only the upload id", async () => {
    let current = render({ ...context, coordinator: true });
    current.setVisibility("coordinator");
    current = render({ ...context, coordinator: true });
    expect(current.visibility).toBe("coordinator");
    const result = await options.upload(selected(), "stable-receipt");
    expect(result).toEqual({ id: "durable-upload" });
    const body = api.mock.calls[0][1].body as FormData;
    expect(body.get("matterId")).toBe(context.matterId);
    expect(body.get("visibility")).toBe("coordinator");
    expect(body.get("uploadRequestId")).toBe("stable-receipt");
    expect((body.get("file") as File).name).toBe("Synthetic contract.pdf");
    queue.hasPending = true;
    current = render({ ...context, coordinator: true });
    current.setVisibility("client");
    current = render({ ...context, coordinator: true });
    expect(current.visibility).toBe("coordinator");
  });

  it("uses only the mounted current list refresher and drops obsolete child callbacks", async () => {
    const current = render();
    const oldRefresh = vi.fn(async () => undefined);
    const newRefresh = vi.fn(async () => undefined);
    const oldUnmount = current.registerRefresh(oldRefresh);
    const newUnmount = current.registerRefresh(newRefresh);
    oldUnmount();
    await options.onBatchComplete();
    expect(oldRefresh).not.toHaveBeenCalled();
    expect(newRefresh).toHaveBeenCalledTimes(1);
    newUnmount();
    await options.onBatchComplete();
    expect(newRefresh).toHaveBeenCalledTimes(1);
  });
});
