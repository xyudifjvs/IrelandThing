import sanitizeHtml from "sanitize-html";
import { parseDocument } from "htmlparser2";
import serialize from "dom-serializer";
import { isTag } from "domhandler";
import { getText, removeElement } from "domutils";
import {
  escapeEmailText,
  plainEmailHtml,
  validSignatureImage,
} from "./email-body";

/** One deliberately small HTML vocabulary for stored, previewed and sent emails. */
export function sanitizeEmailHtml(html: string, preview = false) {
  return sanitizeHtml(html, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "em",
      "u",
      "ul",
      "ol",
      "li",
      "a",
      "h2",
      "span",
      "img",
      ...(preview ? ["mark"] : []),
    ],
    allowedAttributes: {
      a: ["href"],
      span: ["style"],
      img: ["src", "alt", "width"],
    },
    allowedSchemes: ["https", "http", "mailto", "tel"],
    allowedSchemesByTag: { img: ["data"] },
    allowProtocolRelative: false,
    parseStyleAttributes: false,
    nestingLimit: 30,
    transformTags: {
      b: "strong",
      i: "em",
      div: "p",
      h1: "h2",
      h3: "h2",
      h4: "h2",
      h5: "h2",
      h6: "h2",
      span: (_tag, attrs) => ({
        tagName: "span",
        attribs: /^(?:\s*font-size\s*:\s*18px\s*;?\s*)$/.test(attrs.style || "")
          ? { style: "font-size:18px" }
          : ({} as Record<string, string>),
      }),
      img: (_tag, attrs) => ({
        tagName: "img",
        attribs: {
          src: validSignatureImage(attrs.src || "") ? attrs.src : "",
          alt: (attrs.alt || "Signature").slice(0, 160),
          width: String(
            Math.max(40, Math.min(600, Number.parseInt(attrs.width) || 240)),
          ),
        },
      }),
    },
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
  });
}

export function emailHtmlText(html: string) {
  const root = parseDocument(sanitizeEmailHtml(html));
  function text(node: (typeof root.children)[number]): string {
    if (!isTag(node))
      return "data" in node
        ? node.data
        : "children" in node
          ? node.children.map(text).join("")
          : "";
    if (node.name === "br") return "\n";
    if (node.name === "img") return `[${node.attribs.alt || "Signature"}]`;
    const content = node.children.map(text).join("");
    if (node.name === "a" && node.attribs.href && node.attribs.href !== content)
      return `${content} (${node.attribs.href})`;
    if (node.name === "li") {
      const parent = node.parent;
      const index =
        parent && "children" in parent
          ? parent.children
              .filter((n) => isTag(n) && n.name === "li")
              .indexOf(node) + 1
          : 1;
      return `${isTag(parent!) && parent!.name === "ol" ? `${index}.` : "•"} ${content.trim()}\n`;
    }
    return content + (["p", "h2", "ul", "ol"].includes(node.name) ? "\n" : "");
  }
  return root.children
    .map(text)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

/** Remove the smallest containing line or list item, never the whole document. */
export function omitHtmlFieldLines(
  html: string,
  skipped: Set<string>,
  canonical: (key: string) => string,
) {
  const root = parseDocument(sanitizeEmailHtml(html));
  const contains = (text: string) =>
    [...text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].some((m) =>
      skipped.has(canonical(m[1])),
    );
  function walk(node: (typeof root.children)[number]) {
    if (!isTag(node)) return;
    // A list item is a line even when the editor puts a paragraph inside it.
    if (node.name === "li" && contains(getText(node))) {
      removeElement(node);
      return;
    }
    if (["p", "h2"].includes(node.name)) {
      // Shift+Enter is a line break within a paragraph. Preserve neighboring lines.
      const lines: (typeof node.children)[] = [[]];
      for (const child of node.children) {
        if (isTag(child) && child.name === "br") lines.push([]);
        else lines[lines.length - 1].push(child);
      }
      const kept = lines.filter(
        (line) => !contains(line.map((n) => getText(n)).join("")),
      );
      if (!kept.length) {
        removeElement(node);
        return;
      }
      if (kept.length !== lines.length) {
        const fragment = parseDocument(
          kept.map((line) => serialize(line)).join("<br>"),
        );
        node.children = fragment.children;
        for (const child of node.children) child.parent = node;
      }
    }
    for (const child of [...node.children]) walk(child);
    if (
      ["ul", "ol"].includes(node.name) &&
      !node.children.some((n) => isTag(n) && n.name === "li")
    )
      removeElement(node);
  }
  for (const node of [...root.children]) walk(node);
  return serialize(root);
}

export function emailMimeContent(
  body: string,
  format?: unknown,
  subject = "Email from Weatherly",
) {
  const content =
    format === "html" ? sanitizeEmailHtml(body) : plainEmailHtml(body);
  return {
    text: format === "html" ? emailHtmlText(content) : body,
    html: `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><title>${escapeEmailText(subject)}</title></head><body><div lang="en" dir="ltr">${content}</div></body></html>`,
    attachDataUrls: true,
  };
}
export const escapedFieldHtml = (value: string) =>
  escapeEmailText(value).replace(/\r?\n/g, "<br>");

export function comparableEmailBody(body: string, format?: unknown) {
  return sanitizeEmailHtml(format === "html" ? body : plainEmailHtml(body))
    .replace(/<p>(?:<br\s*\/?>)?<\/p>/g, "<p></p>")
    .trim();
}
