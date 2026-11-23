import { canonicalFieldKey } from "./field-catalog";
import type { MergeField } from "./merge-fields";

export function clientTemplateDefault(template: {
  recipientRoles?: unknown;
  recipientGroup?: string | null;
}) {
  const roles = Array.isArray(template.recipientRoles)
    ? template.recipientRoles
    : [];
  if (roles.length)
    return roles.some(
      (role) =>
        typeof role === "string" &&
        ["client", "buyer", "seller"].includes(role.trim().toLowerCase()),
    );
  const group = (template.recipientGroup?.toLowerCase() ?? "").replace(
    /\b(buyer|seller|client)(?:['’]s|s')?\s+agents?\b/g,
    "",
  );
  return /\b(buyer|seller|client)s?\b/.test(group);
}

export function hideNotNeededLines(template: {
  hideNotNeededLines?: boolean | null;
  recipientRoles?: unknown;
  recipientGroup?: string | null;
}) {
  return template.hideNotNeededLines ?? clientTemplateDefault(template);
}

/** Only template source lines referencing a skipped checklist date are omitted. */
export function omitNotNeededLines(
  source: string,
  fields: readonly MergeField[],
  hide: boolean,
) {
  if (!hide) return source;
  const skipped = new Set(
    fields
      .filter((field) => field.checklistNotNeeded && field.status === "confirmed")
      .map((field) => canonicalFieldKey(field.key)),
  );
  return source
    .split(/\r?\n/)
    .filter(
      (line) =>
        ![...line.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].some((match) =>
          skipped.has(canonicalFieldKey(match[1])),
        ),
    )
    .join("\n");
}
