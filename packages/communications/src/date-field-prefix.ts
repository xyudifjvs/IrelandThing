import { parseDocument } from "htmlparser2";
import serialize from "dom-serializer";
import { isTag, isText, type ChildNode, type Text } from "domhandler";
import { canonicalFieldKey } from "./field-catalog";
import type { MergeField } from "./merge-fields";

/** Remove only a template-authored By/by immediately before a resolved date code. */
export function removeDateByPrefix(
  source: string,
  fields: readonly MergeField[],
  html: boolean,
) {
  const keys = new Set(
    fields
      .filter(
        (field) =>
          field.status === "confirmed" &&
          field.value?.trim() &&
          (field.checklistNotNeeded || field.dateDisplayText),
      )
      .map((field) => canonicalFieldKey(field.key)),
  );
  if (!keys.size) return source;
  const pattern =
    /(^|[^\p{L}\p{N}_])(?:By|by)[ \u00a0](\{\{\s*([a-zA-Z0-9_]+)\s*\}\})/gu;
  if (!html)
    return source.replace(
      pattern,
      (match, before: string, code: string, key: string) =>
        keys.has(canonicalFieldKey(key)) ? before + code : match,
    );

  // Inline formatting can put By, its space and the token in different nodes.
  // Work on visible text within each line, leaving attributes and marks intact.
  const root = parseDocument(source);
  let run: Text[] = [],
    changed = false;
  function flush() {
    const value = run.map((node) => node.data).join("");
    const removed = [...value.matchAll(pattern)]
      .filter((match) => keys.has(canonicalFieldKey(match[3])))
      .map((match) => ({
        start: match.index + match[1].length,
        end: match.index + match[1].length + 3,
      }));
    if (removed.length) {
      changed = true;
      let offset = 0;
      for (const node of run) {
        const original = node.data;
        let data = "",
          start = 0;
        for (const range of removed) {
          const from = Math.max(0, range.start - offset),
            to = Math.min(original.length, range.end - offset);
          if (from >= to) continue;
          data += original.slice(start, from);
          start = to;
        }
        node.data = data + original.slice(start);
        offset += original.length;
      }
    }
    run = [];
  }
  function walk(node: ChildNode) {
    if (isText(node)) {
      run.push(node);
      return;
    }
    if (!isTag(node)) return;
    const boundary = ["p", "h2", "li", "ul", "ol", "br", "img"].includes(
      node.name,
    );
    if (boundary) flush();
    for (const child of node.children) walk(child);
    if (boundary) flush();
  }
  for (const node of root.children) walk(node);
  flush();
  return changed ? serialize(root) : source;
}
