import createDOMPurify from "dompurify";
import { validSignatureImage } from "../../../../../../../packages/communications/src/email-body";

/** Paste and preview cleanup; the API independently sanitizes before storage/send. */
export function cleanEditorHtml(source: string, paste = false) {
  if (typeof window === "undefined") return "";
  const purifier = createDOMPurify(window);
  purifier.addHook("uponSanitizeAttribute", (node, data) => {
    if (
      node.nodeName === "IMG" &&
      data.attrName === "src" &&
      !validSignatureImage(data.attrValue)
    )
      data.keepAttr = false;
  });
  const clean = purifier.sanitize(source, {
    ALLOWED_TAGS: [
      "p",
      "div",
      "br",
      "b",
      "i",
      "strong",
      "em",
      "u",
      "ul",
      "ol",
      "li",
      "a",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "span",
      "img",
      "mark",
    ],
    FORBID_TAGS: paste ? ["img", "mark"] : [],
    ALLOWED_ATTR: ["href", "style", "src", "alt", "width"],
    ALLOW_DATA_ATTR: false,
  });
  const root = document.createElement("div");
  root.innerHTML = clean;
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    if (element.tagName === "IMG") {
      const src = element.getAttribute("src") || "";
      if (paste || !validSignatureImage(src)) {
        element.remove();
        continue;
      }
      const alt = (element.getAttribute("alt") || "Signature").slice(0, 160);
      const width = String(
        Math.max(
          40,
          Math.min(
            600,
            Number.parseInt(element.getAttribute("width") || "") || 240,
          ),
        ),
      );
      for (const attr of Array.from(element.attributes))
        element.removeAttribute(attr.name);
      element.setAttribute("src", src);
      element.setAttribute("alt", alt);
      element.setAttribute("width", width);
      continue;
    }
    // Word/Google Docs commonly encode these three marks using spans/styles.
    const styles = element.style;
    const marks = [
      /bold|[6-9]00/.test(styles.fontWeight) ? "strong" : "",
      styles.fontStyle === "italic" ? "em" : "",
      /underline/.test(styles.textDecoration + styles.textDecorationLine)
        ? "u"
        : "",
    ].filter(Boolean);
    const large =
      !paste && styles.fontSize === "18px" && element.tagName === "SPAN";
    const href = element.tagName === "A" ? element.getAttribute("href") : null;
    for (const attr of Array.from(element.attributes))
      element.removeAttribute(attr.name);
    if (large) element.setAttribute("style", "font-size:18px");
    if (
      href &&
      /^(https?:\/\/|mailto:|tel:)/i.test(href) &&
      !/[{}\u0000-\u0020]/.test(href)
    )
      element.setAttribute("href", href);
    for (const tag of marks) {
      const mark = document.createElement(tag);
      while (element.firstChild) mark.append(element.firstChild);
      element.append(mark);
    }
    if (element.tagName === "DIV" || /^H[1-6]$/.test(element.tagName)) {
      const replacement = document.createElement(
        paste || element.tagName === "DIV" ? "p" : "h2",
      );
      while (element.firstChild) replacement.append(element.firstChild);
      element.replaceWith(replacement);
    }
  }
  // Mark complete codes as atomic editor nodes after sanitizing all attributes.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const node of texts) {
    const value = node.data,
      matches = [...value.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)];
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let start = 0;
    for (const match of matches) {
      fragment.append(value.slice(start, match.index));
      const token = document.createElement("span");
      token.setAttribute("data-merge-field", match[1]);
      token.textContent = match[0];
      fragment.append(token);
      start = match.index + match[0].length;
    }
    fragment.append(value.slice(start));
    node.replaceWith(fragment);
  }
  return root.innerHTML;
}
