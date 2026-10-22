"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const POLL_MS = 3000;
const TIMEOUT_MS = 4000;

/** Bounded, single-flight reads. Never retain withdrawn data across a failed read. */
export function useLiveData<T>(path: string | null, bearer?: string) {
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    loading: boolean;
    error: string;
    updatedAt: number | null;
  }>({ key: "", data: null, loading: true, error: "", updatedAt: null });
  const key = `${path || ""}:${bearer || ""}`;
  const run = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => run.current(), []);

  useEffect(() => {
    let active = true;
    let generation = 0;
    let controller: AbortController | null = null;
    let next: ReturnType<typeof setTimeout> | undefined;
    let pending: Promise<void> | null = null;
    const clear = (error: string) => {
      generation++;
      controller?.abort();
      controller = null;
      pending = null;
      clearTimeout(next);
      if (active)
        setState((old) => ({ ...old, key, data: null, loading: false, error }));
    };
    const available = () =>
      navigator.onLine && document.visibilityState !== "hidden";
    const read = (): Promise<void> => {
      if (pending) return pending;
      clearTimeout(next);
      if (!active || !path) return Promise.resolve();
      if (!available()) {
        clear(
          navigator.onLine
            ? "Updates paused while this tab is hidden."
            : "You’re offline. Checklist hidden until we reconnect.",
        );
        return Promise.resolve();
      }
      const version = ++generation;
      const abort = new AbortController();
      controller = abort;
      const timeout = setTimeout(() => abort.abort(), TIMEOUT_MS);
      setState((old) => ({
        ...old,
        key,
        loading: old.key !== key || !old.data,
      }));
      pending = (async () => {
        try {
          const response = await fetch(path, {
            cache: "no-store",
            credentials: bearer ? "omit" : "include",
            referrerPolicy: "no-referrer",
            signal: abort.signal,
            headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
          });
          if (!response.ok)
            throw new Error(
              response.status === 401 ||
                response.status === 403 ||
                response.status === 404 ||
                response.status === 410
                ? "This checklist is unavailable. Access may have changed or the link may have expired."
                : "We couldn’t confirm the latest checklist. Reconnecting…",
            );
          const data = (await response.json()) as T;
          if (active && version === generation)
            setState({
              key,
              data,
              loading: false,
              error: "",
              updatedAt: Date.now(),
            });
        } catch (error) {
          if (active && version === generation)
            setState((old) => ({
              ...old,
              key,
              data: null,
              loading: false,
              error: abort.signal.aborted
                ? "The connection timed out. Checklist hidden while we reconnect."
                : error instanceof Error &&
                    error.message.startsWith("This checklist")
                  ? error.message
                  : "The connection was interrupted. Checklist hidden while we reconnect…",
            }));
        } finally {
          clearTimeout(timeout);
          if (active && version === generation) {
            controller = null;
            pending = null;
            next = setTimeout(() => void read(), POLL_MS);
          }
        }
      })();
      return pending;
    };
    const reconnect = () => {
      if (available()) void read();
      else
        clear(
          navigator.onLine
            ? "Updates paused while this tab is hidden."
            : "You’re offline. Checklist hidden until we reconnect.",
        );
    };
    const pagehide = () => clear("Reconnecting to the latest checklist…");
    setState({ key, data: null, loading: !!path, error: "", updatedAt: null });
    run.current = read;
    void read();
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", reconnect);
    window.addEventListener("focus", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", reconnect);
    return () => {
      active = false;
      generation++;
      clearTimeout(next);
      controller?.abort();
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", reconnect);
      window.removeEventListener("focus", reconnect);
      document.removeEventListener("visibilitychange", reconnect);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", reconnect);
    };
  }, [path, bearer, key]);
  return {
    data: state.key === key ? state.data : null,
    loading: !!path && (state.key !== key || state.loading),
    error: state.key === key ? state.error : "",
    updatedAt: state.key === key ? state.updatedAt : null,
    refresh,
  };
}

export function LiveStatus({
  query,
}: {
  query: {
    error: string;
    loading: boolean;
    updatedAt: number | null;
    refresh: () => Promise<void>;
  };
}) {
  return (
    <div
      role="status"
      style={{
        fontSize: 12,
        margin: "14px 0",
        color: query.error ? "var(--danger)" : "var(--muted)",
      }}
    >
      {query.error ||
        (query.updatedAt
          ? `Live updates · checked ${new Date(query.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`
          : "Connecting to live updates…")}
      {query.error && (
        <button
          type="button"
          onClick={() => void query.refresh()}
          style={{ marginLeft: 12 }}
        >
          Try again
        </button>
      )}
    </div>
  );
}
