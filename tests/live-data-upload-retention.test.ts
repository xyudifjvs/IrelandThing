import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

type Snapshot = {
  key: string;
  data: { id: string } | null;
  loading: boolean;
  error: string;
  updatedAt: number | null;
};

// Run the actual effect/read/event logic with observable state updates. A real
// browser separately verifies that retaining this data keeps the picker mounted.
const lifecycle = {
  state: null as Snapshot | null,
  effect: null as (() => void | (() => void)) | null,
};
const hookAdapter = {
  useState: (initial: Snapshot) => {
    lifecycle.state = initial;
    return [
      initial,
      (value: Snapshot | ((old: Snapshot) => Snapshot)) => {
        lifecycle.state =
          typeof value === "function" ? value(lifecycle.state!) : value;
      },
    ];
  },
  useRef: <T>(value: T) => ({ current: value }),
  useCallback: <T>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => {
    lifecycle.effect = effect;
  },
};
// The Next app's nearest tsconfig preserves JSX, so Vite cannot import this TSX
// module directly in the root Node test runner. Compile the actual hook source
// (excluding the unrelated JSX status component) without altering product code.
const source = readFileSync(
  resolve("apps/web/app/_components/useLiveData.tsx"),
  "utf8",
);
const hookSource = source.slice(
  0,
  source.indexOf("export function LiveStatus"),
);
const compiled = ts.transpileModule(hookSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
});
const hookModule: {
  useLiveData?: (path: string, bearer?: string, retain?: boolean) => unknown;
} = {};
new Function("require", "exports", compiled.outputText)((name: string) => {
  if (name !== "react") throw new Error(`Unexpected hook dependency ${name}`);
  return hookAdapter;
}, hookModule);
const useLiveData = hookModule.useLiveData!;

let documentSurface: EventTarget & { visibilityState: string };
let windowSurface: EventTarget;
let connection: { onLine: boolean };
let fetcher: ReturnType<typeof vi.fn>;
let cleanup: (() => void) | undefined;

const json = (id = "authorized-matter", status = 200) =>
  new Response(JSON.stringify({ id }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function mount(retain = true, bearer?: string) {
  useLiveData("/api/v1/matters/synthetic-picker", bearer, retain);
  cleanup = lifecycle.effect!() || undefined;
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  documentSurface = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  windowSurface = new EventTarget();
  connection = { onLine: true };
  fetcher = vi.fn().mockImplementation(async () => json());
  vi.stubGlobal("document", documentSurface);
  vi.stubGlobal("window", windowSurface);
  vi.stubGlobal("navigator", connection);
  vi.stubGlobal("fetch", fetcher);
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  lifecycle.effect = null;
  lifecycle.state = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("authenticated upload detail background retention", () => {
  it("keeps authenticated detail data mounted while a picker hides the tab and pauses polling", async () => {
    await mount();
    expect(lifecycle.state?.data).toEqual({ id: "authorized-matter" });
    documentSurface.visibilityState = "hidden";
    documentSurface.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(12_000);
    expect(lifecycle.state?.data).toEqual({ id: "authorized-matter" });
    expect(lifecycle.state?.loading).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    documentSurface.visibilityState = "visible";
    documentSurface.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(lifecycle.state?.data).toEqual({ id: "authorized-matter" });
  });

  it.each([401, 403, 404, 410, 500])(
    "clears retained data when the resumed authenticated read returns HTTP %s",
    async (status) => {
      await mount();
      documentSurface.visibilityState = "hidden";
      documentSurface.dispatchEvent(new Event("visibilitychange"));
      fetcher.mockResolvedValueOnce(json("withdrawn", status));
      documentSurface.visibilityState = "visible";
      documentSurface.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(lifecycle.state?.data).toBeNull();
      expect(lifecycle.state?.error).toMatch(/unavailable|interrupted/i);
    },
  );

  it("clears offline data immediately, including when the detail was already hidden", async () => {
    await mount();
    documentSurface.visibilityState = "hidden";
    documentSurface.dispatchEvent(new Event("visibilitychange"));
    connection.onLine = false;
    windowSurface.dispatchEvent(new Event("offline"));
    expect(lifecycle.state?.data).toBeNull();
    expect(lifecycle.state?.error).toMatch(/offline/i);
    connection.onLine = true;
    documentSurface.visibilityState = "visible";
    windowSurface.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(lifecycle.state?.data).toEqual({ id: "authorized-matter" });
  });

  it("keeps immediate background concealment as the default", async () => {
    await mount(false);
    documentSurface.visibilityState = "hidden";
    documentSurface.dispatchEvent(new Event("visibilitychange"));
    expect(lifecycle.state?.data).toBeNull();
    expect(lifecycle.state?.error).toMatch(/hidden/i);
  });

  it("always conceals bearer data on background and ignores a late response even if retention was requested", async () => {
    await mount(true, "synthetic-public-bearer");
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: "omit",
      headers: { Authorization: "Bearer synthetic-public-bearer" },
    });
    let finish!: (value: Response) => void;
    fetcher.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    windowSurface.dispatchEvent(new Event("focus"));
    documentSurface.visibilityState = "hidden";
    documentSurface.dispatchEvent(new Event("visibilitychange"));
    expect(lifecycle.state?.data).toBeNull();
    finish(json("late-stale-data"));
    await vi.advanceTimersByTimeAsync(0);
    expect(lifecycle.state?.data).toBeNull();
  });

  it("pauses opted-in online authenticated details on native picker pagehide without unmounting their form", async () => {
    await mount();
    windowSurface.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(12_000);
    expect(lifecycle.state?.data).toEqual({ id: "authorized-matter" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    windowSurface.dispatchEvent(new Event("pageshow"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, "synthetic-bearer"])(
    "preserves immediate pagehide clearing for non-opted or bearer views (%s)",
    async (bearer) => {
      await mount(!!bearer, bearer);
      windowSurface.dispatchEvent(new Event("pagehide"));
      expect(lifecycle.state?.data).toBeNull();
      expect(lifecycle.state?.error).toMatch(/reconnecting/i);
    },
  );
});
