'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@weatherly/ui';
export { api };
export type Task = { id: string; title: string; status: string; dueAt?: string | null; dueDate?: string | null; matterId?: string; private?: boolean; description?: string; revision?: number; visibility?: string; };
export type Person = { id: string; name: string; email?: string; role?: string };
export type Document = { id: string; name?: string; filename?: string; status?: string; createdAt?: string; };
export type Matter = { id: string; title?: string; name?: string; address?: string; propertyAddress?: string; status?: string; stage?: string; side?: string; serviceLevel?: string; packageCode?: string; revision?: number; details?: Record<string, unknown>; closingDate?: string | null; closeAt?: string | null; purchasePrice?: number; cash?: boolean; tasks?: Task[]; participants?: Person[]; documents?: Document[]; notes?: { id: string; content?: string; text?: string; body?: string; createdAt: string }[]; createdAt?: string; clientContactAllowed?: boolean; deadlines?: {id: string; label: string; date: string; status: string; revision?: number; sourceDocumentId?: string}[]; };
export type Session = { user?: { id: string; name: string; email: string; role?: string }; id?: string; name?: string; email?: string; role?: string };
export function rows<T>(value: T[] | { items?: T[]; matters?: T[]; tasks?: T[]; documents?: T[] } | null | undefined): T[] { if (Array.isArray(value)) return value; if (!value) return []; return value.items || value.matters || value.tasks || value.documents || []; }
export function useData<T>(path: string | null) { const [data, setData] = useState<T | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const refresh = useCallback(async () => { if (!path) { setLoading(false); return; } setLoading(true); setError(''); try { setData(await api<T>(path)); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load. Please try again.'); } finally { setLoading(false); } }, [path]); useEffect(() => { void refresh(); }, [refresh]); return { data, loading, error, refresh }; }
export function address(m: Matter) { return m.propertyAddress || m.address || m.title || m.name || 'Untitled transaction'; }
export function date(value?: string | null) { if (!value) return 'Not scheduled'; const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
export function label(value?: string) { return (value || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }
export function progress(m: Matter) { const tasks = m.tasks || []; return tasks.length ? Math.round(tasks.filter(t => ['DONE', 'COMPLETED', 'complete', 'done', 'completed'].includes(t.status)).length / tasks.length * 100) : 0; }
export async function mutate<T>(path: string, body: unknown, method = 'POST') { return api<T>(path, { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }); }
