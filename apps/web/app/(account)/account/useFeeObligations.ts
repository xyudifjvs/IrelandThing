"use client";

import { useEffect, useState } from "react";
import type { FileSummary } from "../../(portal)/portal/_views/portal-model";

export function useFeeObligations(enabled: boolean) {
  const [state, setState] = useState<{
    data: FileSummary[];
    error: boolean;
    loading: boolean;
  }>({ data: [], error: false, loading: enabled });
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const request = new AbortController();
    async function load() {
      const files = new Map<string, FileSummary>();
      const cursors = new Set<string>();
      const params = new URLSearchParams({ limit: "100" });
      try {
        while (true) {
          const response = await fetch(
            `/api/v1/billing/account/obligations?${params}`,
            {
              cache: "no-store",
              credentials: "include",
              signal: request.signal,
            },
          );
          if (!response.ok)
            throw new Error("Could not open payment obligations.");
          const { items, nextCursor } = (await response.json()) as {
            items: FileSummary[];
            nextCursor: string | null;
          };
          for (const file of items)
            if (file.service || file.gift) files.set(file.matterId, file);
          if (!nextCursor) break;
          if (cursors.has(nextCursor))
            throw new Error("Could not complete payment obligations.");
          cursors.add(nextCursor);
          params.set("cursor", nextCursor);
        }
        if (!request.signal.aborted)
          setState({ data: [...files.values()], error: false, loading: false });
      } catch {
        if (!request.signal.aborted)
          setState({ data: [], error: true, loading: false });
      }
    }
    setState({ data: [], error: false, loading: true });
    void load();
    return () => request.abort();
  }, [enabled, generation]);
  return {
    ...(enabled ? state : { data: [], error: false, loading: false }),
    retry: () => setGeneration((current) => current + 1),
  };
}
