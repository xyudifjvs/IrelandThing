/** Shared, browser-safe helpers. A missing format always means historical text. */
export type EmailBodyFormat = "plain" | "html";
export const MAX_EMAIL_HTML = 1000000;
export const MAX_SIGNATURE_IMAGE_BYTES = 200000;
export function escapeEmailText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
export function plainEmailHtml(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => `<p>${escapeEmailText(line) || "<br>"}</p>`)
    .join("");
}
export function editorEmailHtml(value: string, format?: string | null) {
  return format === "html" ? value : plainEmailHtml(value);
}
export function validSignatureImage(src: string) {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    src,
  );
  if (!match || match[2].length > Math.ceil(MAX_SIGNATURE_IMAGE_BYTES / 3) * 4)
    return false;
  return match[1] === "png"
    ? match[2].startsWith("iVBORw0KGgo")
    : match[2].startsWith("/9j/");
}
