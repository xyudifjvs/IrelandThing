"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@weatherly/ui";
export { api };
export type Task = {
  id: string;
  title: string;
  status: string;
  dueAt?: string | null;
  dueDate?: string | null;
  matterId?: string;
  private?: boolean;
  description?: string;
  revision?: number;
  visibility?: string;
  kind?: string;
};
export type Person = {
  id: string;
  name?: string;
  userId?: string;
  email?: string;
  role?: string;
};
export type Document = {
  id: string;
  name?: string;
  filename?: string;
  status?: string;
  createdAt?: string;
};
export type Matter = {
  id: string;
  title?: string;
  name?: string;
  address?: string;
  propertyAddress?: string;
  status?: string;
  stage?: string;
  side?: string;
  serviceLevel?: string;
  packageCode?: string;
  agentId?: string | null;
  revision?: number;
  details?: Record<string, unknown>;
  closingDate?: string | null;
  closeAt?: string | null;
  purchasePrice?: number;
  cash?: boolean;
  tasks?: Task[];
  participants?: Person[];
  documents?: Document[];
  notes?: {
    id: string;
    content?: string;
    text?: string;
    body?: string;
    createdAt: string;
  }[];
  createdAt?: string;
  clientContactAllowed?: boolean;
  deadlines?: {
    id: string;
    label: string;
    date: string | null;
    status: string;
    revision?: number;
    sourceDocumentId?: string;
  }[];
};
export type Session = {
  user?: { id: string; name: string; email: string; role?: string };
  id?: string;
  name?: string;
  email?: string;
  role?: string;
};
export function rows<T>(
  value:
    | T[]
    | { items?: T[]; matters?: T[]; tasks?: T[]; documents?: T[] }
    | null
    | undefined,
): T[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return value.items || value.matters || value.tasks || value.documents || [];
}
export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [resolvedPath, setResolvedPath] = useState<string | null>(null);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const token = ++request.current;
    if (!path) {
      setData(null);
      setResolvedPath(null);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const next = await api<T>(path);
      if (token === request.current) {
        setData(next);
        setResolvedPath(path);
      }
    } catch (e) {
      if (token === request.current) {
        setData(null);
        setError(
          e instanceof Error ? e.message : "Unable to load. Please try again.",
        );
        setResolvedPath(path);
      }
    } finally {
      if (token === request.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void refresh();
    return () => {
      request.current++;
    };
  }, [refresh]);
  return {
    data: resolvedPath === path ? data : null,
    loading: !!path && (loading || resolvedPath !== path),
    error: resolvedPath === path ? error : "",
    refresh,
  };
}
export function address(m: Matter) {
  return (
    m.propertyAddress ||
    m.address ||
    m.title ||
    m.name ||
    "Untitled transaction"
  );
}
export function parseDate(value: string) {
  return new Date(value.length === 10 ? value + "T12:00:00" : value);
}
export function date(value?: string | null) {
  if (!value) return "Not scheduled";
  const d = parseDate(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
export function label(value?: string) {
  return (value || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
export function progress(m: Matter) {
  const tasks = m.tasks || [];
  return tasks.length
    ? Math.round(
        (tasks.filter((t) =>
          ["completed", "signed", "not_applicable"].includes(t.status),
        ).length /
          tasks.length) *
          100,
      )
    : 0;
}
export async function mutate<T>(path: string, body: unknown, method = "POST") {
  return api<T>(path, {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
