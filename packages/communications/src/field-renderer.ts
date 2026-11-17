import { canonicalFieldKey, normalizeFieldCodes } from "./field-catalog";
import type { MergeField } from "./merge-fields";

export function replaceFieldText(
  source: string,
  fields: readonly MergeField[],
  blankMissing = false,
) {
  const known = new Map(
    fields.map((field) => [canonicalFieldKey(field.key), field]),
  );
  const missing = new Set<string>(),
    unknown = new Set<string>();
  const normalized = normalizeFieldCodes(source);
  const output = normalized.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, key: string) => {
      const field = known.get(key);
      if (!field) {
        unknown.add(key);
        missing.add(key);
        return `{{${key}}}`;
      }
      if (field.status !== "confirmed" || !field.value?.trim()) {
        missing.add(key);
        return blankMissing ? "" : `{{${key}}}`;
      }
      // Do not trim values: signatures and fixed text preserve their line breaks.
      return field.value;
    },
  );
  return { output, missing: [...missing], unknown: [...unknown], normalized };
}
