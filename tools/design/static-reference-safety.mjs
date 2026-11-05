import { parseDocument } from "htmlparser2";
const tags = new Set([
  "div",
  "header",
  "nav",
  "a",
  "main",
  "section",
  "footer",
  "p",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "img",
  "figure",
  "figcaption",
  "blockquote",
  "details",
  "summary",
  "ul",
  "ol",
  "li",
  "strong",
  "small",
  "br",
  "form",
  "label",
  "input",
  "textarea",
  "button",
]);
export function assertLocalCss(css, resources) {
  if (/@import|expression\s*\(|behavior\s*:|-moz-binding|\\/i.test(css))
    throw Error("Unsafe reference CSS.");
  for (const match of css.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/gi))
    if (!resources.has(match[1]))
      throw Error("Nonlocal reference CSS resource: " + match[1]);
}
export function assertSafeStaticMarkup(
  html,
  resources,
  { allowedLinks = new Set() } = {},
) {
  const tree = parseDocument(html, { decodeEntities: true });
  let elements = 0;
  const inspect = (node) => {
    if (node.type === "script" || node.type === "style")
      throw Error("Executable reference node rejected.");
    if (node.name) {
      elements++;
      if (!tags.has(node.name))
        throw Error("Unsupported reference element: " + node.name);
      for (const [name, value] of Object.entries(node.attribs || {})) {
        if (
          /^on/i.test(name) ||
          ["srcdoc", "action", "formaction"].includes(name)
        )
          throw Error("Executable reference attribute: " + name);
        if (name === "src" && !resources.has(value))
          throw Error("Nonlocal reference resource: " + value);
        if (name === "srcset")
          for (const candidate of value.split(",")) {
            const [url, descriptor, ...extra] = candidate.trim().split(/\s+/);
            if (
              !resources.has(url) ||
              extra.length ||
              (descriptor && !/^\d+(?:\.\d+)?[wx]$/.test(descriptor))
            )
              throw Error("Unsafe reference srcset.");
          }
        if (name === "href") {
          if (value.includes("\\"))
            throw Error("Unsafe reference link separator.");
          const clean = value.replace(/[\u0000-\u0020\u007f]/g, "");
          if (
            !/^(?:\/(?!\/)|#|mailto:|tel:)/i.test(clean) &&
            !allowedLinks.has(clean)
          )
            throw Error("Unsafe reference link: " + value);
        }
        if (name === "style") assertLocalCss(value, resources);
      }
    }
    for (const child of node.children || []) inspect(child);
  };
  inspect(tree);
  return { elements };
}
