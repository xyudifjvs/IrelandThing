"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FileSummary } from "../../(portal)/portal/_views/portal-model";

const POLL_MS = 3_000;
const SCAN_TIMEOUT_MS = 10_000;
const empty = {
  data: [] as FileSummary[],
  error: false,
  loading: false,
  historyKey: undefined as string | undefined,
};

/** Publish a complete authorized scan, including pages without a payable fee. */
export async function readFeeObligations(signal: AbortSignal) {
  const files = new Map<string, FileSummary>();
  const cursors = new Set<string>();
  const params = new URLSearchParams({ limit: "100" });
  while (true) {
    const response = await fetch(
      `/api/v1/billing/account/obligations?${params}`,
      { cache: "no-store", credentials: "include", signal },
    );
    if (!response.ok) throw new Error("Could not open payment obligations.");
    const { items, nextCursor } = (await response.json()) as {
      items: FileSummary[];
      nextCursor: string | null;
    };
    signal.throwIfAborted();
    for (const file of items)
      if (file.service || file.gift) files.set(file.matterId, file);
    if (!nextCursor) return [...files.values()];
    if (cursors.has(nextCursor))
      throw new Error("Could not complete payment obligations.");
    cursors.add(nextCursor);
    params.set("cursor", nextCursor);
  }
}

export function useFeeObligations(enabled: boolean) {
  const [state, setState] = useState({ ...empty, loading: enabled });
  const revalidate = useRef<() => void>(() => {});
  const retry = useCallback(() => revalidate.current(), []);

  useEffect(() => {
    if (!enabled) {
      setState(empty);
      return;
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: { controller: AbortController; suspended: boolean } | null =
      null;
    const available = () => navigator.onLine && !document.hidden;

    async function read() {
      if (disposed || pending || !available()) return;
      clearTimeout(timer);
      const request = { controller: new AbortController(), suspended: false };
      pending = request;
      const deadline = setTimeout(
        () => request.controller.abort(),
        SCAN_TIMEOUT_MS,
      );
      try {
        const data = await readFeeObligations(request.controller.signal);
        if (!disposed && available() && !request.suspended) {
          setState({
            data,
            error: false,
            loading: false,
            historyKey: JSON.stringify(
              data.map(({ matterId, service, gift }) => [
                matterId,
                !!service,
                !!gift,
              ]),
            ),
          });
        }
      } catch {
        if (!disposed && available() && !request.suspended)
          setState((old) => ({
            ...old,
            data: [],
            error: true,
            loading: false,
          }));
      } finally {
        clearTimeout(deadline);
        pending = null;
        if (!disposed && available())
          timer = setTimeout(
            () => void read(),
            request.suspended ? 0 : POLL_MS,
          );
      }
    }

    function suspend() {
      clearTimeout(timer);
      if (pending) {
        pending.suspended = true;
        pending.controller.abort();
      }
      setState((old) => ({
        ...old,
        data: [],
        error: !navigator.onLine,
        loading: navigator.onLine,
      }));
    }

    function reconnect() {
      if (available()) void read();
      else suspend();
    }

    setState({ ...empty, loading: true });
    revalidate.current = reconnect;
    window.addEventListener("focus", reconnect);
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", reconnect);
    window.addEventListener("pageshow", reconnect);
    window.addEventListener("pagehide", suspend);
    document.addEventListener("visibilitychange", reconnect);
    reconnect();

    return () => {
      disposed = true;
      clearTimeout(timer);
      pending?.controller.abort();
      revalidate.current = () => {};
      window.removeEventListener("focus", reconnect);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", reconnect);
      window.removeEventListener("pageshow", reconnect);
      window.removeEventListener("pagehide", suspend);
      document.removeEventListener("visibilitychange", reconnect);
    };
  }, [enabled]);

  return { ...(enabled ? state : empty), retry };
}
