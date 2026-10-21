import type { Principal } from "@weatherly/platform";
import { listMatters, getMatter, requireMatter } from "@weatherly/matters";
import { listDocuments, getDocument } from "@weatherly/documents";
import { queryStoredRecords } from "./records";

export type Source = {
  id: string;
  title: string;
  url: string;
  content: string;
  kind: "record" | "document";
  page?: number | null;
};
export type Coverage = {
  scope: string;
  asOf: string;
  mattersScanned: number;
  documentsScanned: number;
  unreadableDocuments: number;
  charactersScanned: number;
  recordsScanned: number;
  candidates: number;
  sourcesIncluded: number;
  contextCharacters: number;
  incomplete: boolean;
  omissions: string[];
  historyMessagesIncluded?: number;
  historyTruncated?: boolean;
};
export const retrievalLimits = {
  matters: 5000,
  documents: 1000,
  recordsPerKind: 1000,
  characters: 8_000_000,
  context: 90000,
  sources: 70,
} as const;
type Row = { id: string; [key: string]: unknown };
export type RetrievalReaders = {
  matters: (
    actor: Principal,
    options: { cursor?: string; limit: number },
  ) => Promise<Row[]>;
  matter: (actor: Principal, id: string) => Promise<Row>;
  documents: (
    actor: Principal,
    matterId: string | undefined,
    options: { cursor?: string; limit: number },
  ) => Promise<{ id: string; name: string; matterId: string | null }[]>;
  document: (
    actor: Principal,
    id: string,
  ) => Promise<{
    versions: { id: string; extractedText: string | null; pages: unknown }[];
  }>;
  records: (
    actor: Principal,
    input: {
      kind: "payments" | "gifts" | "messages";
      matterId?: string;
      cursor?: string;
      limit: number;
    },
  ) => Promise<{
    items: unknown[];
    nextCursor?: string | null;
    hasMore: boolean;
  }>;
};
const readers: RetrievalReaders = {
  matters: listMatters,
  matter: getMatter,
  documents: listDocuments,
  document: getDocument,
  records: queryStoredRecords,
};
const stop = new Set(
  "a an the is are was were be been to of for in on at and or what which who when where how my this that it its about does do did can needs need please tell me your you i we our still from with by has have had all any".split(
    " ",
  ),
);
/** Token matching with explicit domain expansions; never an instruction-producing model call. */
export function queryTerms(question: string) {
  const words = question.toLowerCase().match(/[a-z0-9]+/g) || [];
  const terms = new Set(words.filter((w) => w.length > 1 && !stop.has(w)));
  const groups = [
    ["closing", "settlement", "close"],
    ["deadline", "deadlines", "date", "dates", "due"],
    ["payment", "payments", "paid", "refund", "invoice", "billing"],
    ["email", "message", "messages", "sent", "reply"],
    ["amendment", "amended", "extension", "extended", "addendum"],
    ["attention", "task", "tasks", "pending", "overdue", "unconfirmed"],
    ["missing", "document", "documents", "required", "incomplete"],
  ];
  for (const group of groups)
    if (group.some((w) => terms.has(w))) group.forEach((w) => terms.add(w));
  return [...terms].slice(0, 80);
}
export function relevance(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  return terms.reduce(
    (score, term) => score + (lower.includes(term) ? 1 : 0),
    0,
  );
}
/** Scan every character within the disclosed scan budget, including late pages and amendments. */
export function evidenceChunks(text: string, question: string) {
  const terms = queryTerms(question);
  const chunks: { text: string; offset: number; score: number }[] = [];
  for (let offset = 0; offset < text.length; offset += 1400) {
    const content = text.slice(offset, offset + 1800);
    const score = relevance(content, terms);
    if (score) chunks.push({ text: content, offset, score });
  }
  return chunks.sort((a, b) => b.score - a.score || a.offset - b.offset);
}
async function collect<T extends { id: string }>(
  fetchPage: (cursor?: string) => Promise<T[]>,
  cap: number,
) {
  const items: T[] = [];
  let cursor: string | undefined;
  while (items.length < cap) {
    const page = await fetchPage(cursor);
    items.push(...page.slice(0, cap - items.length));
    if (page.length < 100) return { items, truncated: false };
    const next = page.at(-1)!.id;
    if (cursor === next) return { items, truncated: true };
    cursor = next;
  }
  // A full cap is conservatively incomplete; no claim that records beyond it do not exist.
  return { items, truncated: true };
}
export async function retrieveSources(
  actor: Principal,
  input: { question: string; matterId?: string },
  deps: RetrievalReaders = readers,
) {
  if (input.matterId && deps === readers)
    await requireMatter(actor, input.matterId);
  const coverage: Coverage = {
    asOf: new Date().toISOString(),
    scope: input.matterId
      ? `Transaction ${input.matterId}`
      : "Authorized transactions",
    mattersScanned: 0,
    documentsScanned: 0,
    unreadableDocuments: 0,
    charactersScanned: 0,
    recordsScanned: 0,
    candidates: 0,
    sourcesIncluded: 0,
    contextCharacters: 0,
    incomplete: false,
    omissions: [],
  };
  const omit = (message: string) => {
    if (!coverage.omissions.includes(message)) coverage.omissions.push(message);
    coverage.incomplete = true;
  };
  const terms = queryTerms(input.question);
  const candidates: (Source & { score: number })[] = [];
  const addRecord = (row: Row, kind: string, title: string, url: string) => {
    coverage.recordsScanned++;
    const content = JSON.stringify(row);
    // A single giant note must not consume the entire context and hide late fields.
    const chunks = evidenceChunks(content, input.question);
    const selected =
      content.length <= 4000
        ? [{ text: content, offset: 0, score: relevance(content, terms) }]
        : chunks.slice(0, 3);
    if (content.length > 4000)
      omit(
        "Large records are represented by ranked excerpts; complete records remain available through query_records.",
      );
    selected.forEach((chunk) =>
      candidates.push({
        id: `${kind}:${row.id}:${chunk.offset}`,
        title,
        url,
        content: chunk.text,
        kind: "record",
        score: chunk.score * 3 + 0.25 + relevance(title, terms),
      }),
    );
  };
  const matters = input.matterId
    ? { items: [await deps.matter(actor, input.matterId)], truncated: false }
    : await collect(
        (cursor) => deps.matters(actor, { cursor, limit: 100 }),
        retrievalLimits.matters,
      );
  coverage.mattersScanned = matters.items.length;
  if (matters.truncated)
    omit(
      `Transaction scan stopped at ${retrievalLimits.matters}; narrow the question to a transaction.`,
    );
  for (const matter of matters.items) {
    const { tasks, deadlines, notes, documents: _documents, ...base } = matter;
    const title = String(matter.propertyAddress || matter.title || matter.id);
    const url = `/workspace/transactions/${matter.id}`;
    addRecord(base as Row, "matter", title, url);
    for (const [kind, values] of Object.entries({
      task: tasks,
      deadline: deadlines,
      note: notes,
    }))
      if (Array.isArray(values))
        for (const value of values)
          addRecord(value as Row, kind, `${title} — ${kind}`, url);
  }
  // Domain record services preserve visibility and omit credentials. The same services back API/MCP.
  if (
    input.matterId ||
    terms.some((term) =>
      [
        "payment",
        "refund",
        "billing",
        "gift",
        "email",
        "message",
        "sent",
      ].includes(term),
    )
  ) {
    const kinds: ("payments" | "gifts" | "messages")[] = input.matterId
      ? ["payments", "gifts", "messages"]
      : terms.some((term) => ["email", "message", "sent"].includes(term))
        ? ["messages"]
        : ["payments", "gifts"];
    for (const kind of kinds) {
      let cursor: string | undefined;
      let count = 0;
      while (count < retrievalLimits.recordsPerKind) {
        const page = await deps.records(actor, {
          kind,
          matterId: input.matterId,
          cursor,
          limit: 100,
        });
        for (const row of page.items) {
          addRecord(
            row as Row,
            kind,
            `Saved ${kind} record`,
            `/workspace/transactions/${(row as { matterId?: string }).matterId || input.matterId || ""}`,
          );
          count++;
        }
        if (!page.hasMore) break;
        if (!page.nextCursor || page.nextCursor === cursor) {
          omit(`${kind} pagination could not continue.`);
          break;
        }
        cursor = page.nextCursor;
        if (count >= retrievalLimits.recordsPerKind)
          omit(`${kind} scan stopped at ${retrievalLimits.recordsPerKind}.`);
      }
    }
  }
  const docs = await collect(
    (cursor) => deps.documents(actor, input.matterId, { cursor, limit: 100 }),
    retrievalLimits.documents,
  );
  if (docs.truncated)
    omit(
      `Document scan stopped at ${retrievalLimits.documents}; use paginated search_evidence or narrow the transaction.`,
    );
  for (const doc of docs.items) {
    if (coverage.charactersScanned >= retrievalLimits.characters) {
      omit(
        `Document text scan stopped at ${retrievalLimits.characters} characters.`,
      );
      break;
    }
    const document = await deps.document(actor, doc.id);
    coverage.documentsScanned++;
    const version = document.versions[0];
    if (!version?.extractedText?.trim()) {
      coverage.unreadableDocuments++;
      continue;
    }
    const available = retrievalLimits.characters - coverage.charactersScanned;
    const text = version.extractedText.slice(0, available);
    coverage.charactersScanned += text.length;
    if (text.length < version.extractedText.length)
      omit(`Document ${doc.id} exceeded the remaining text scan budget.`);
    const chunks = evidenceChunks(text, input.question).slice(0, 4);
    for (const chunk of chunks) {
      candidates.push({
        id: `document:${doc.id}:${version.id}:${chunk.offset}`,
        title: doc.name,
        url: `/api/v1/documents/${doc.id}/download?versionId=${version.id}`,
        content: chunk.text,
        kind: "document",
        score: chunk.score * 3,
      });
    }
  }
  if (coverage.unreadableDocuments)
    omit(
      `${coverage.unreadableDocuments} document(s) have no readable text; scanned files require approved transcription.`,
    );
  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  coverage.candidates = candidates.length;
  const sources: Source[] = [];
  // Reserve context for current records and document evidence, so a stack of historical
  // receipts cannot crowd out current payment/deadline status (or vice versa).
  const records = candidates.filter((source) => source.kind === "record");
  const documents = candidates.filter((source) => source.kind === "document");
  const reserved = [...records.slice(0, 35), ...documents.slice(0, 35)];
  const reservedIds = new Set(reserved.map((source) => source.id));
  const ordered = [
    ...reserved,
    ...candidates.filter((source) => !reservedIds.has(source.id)),
  ];
  const kindCharacters = { record: 0, document: 0 };
  const kindBudget =
    records.length && documents.length
      ? retrievalLimits.context / 2
      : retrievalLimits.context;
  for (const { score: _, ...candidate } of ordered) {
    if (
      kindCharacters[candidate.kind] + candidate.content.length > kindBudget ||
      sources.length >= retrievalLimits.sources ||
      coverage.contextCharacters + candidate.content.length >
        retrievalLimits.context
    ) {
      omit(
        "Only ranked source excerpts fit the answer context; omitted records are not evidence of absence.",
      );
      continue;
    }
    sources.push(candidate);
    coverage.contextCharacters += candidate.content.length;
    kindCharacters[candidate.kind] += candidate.content.length;
  }
  coverage.sourcesIncluded = sources.length;
  // Ranking is relevance sampling even when every document was scanned.
  if (coverage.documentsScanned)
    omit(
      "Document answers use ranked excerpts from current versions; full-text scan is lexical, not a guarantee of semantic recall.",
    );
  return { sources, coverage };
}
