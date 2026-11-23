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
  let output = normalized.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, key: string) => {
      const field = known.get(key);
      if (!field) {
        unknown.add(key);
        missing.add(key);
        return `{{${key}}}`;
      }
      if (field.status !== "confirmed" || !field.value?.trim()) {
        if (field.optionalBlank && field.status !== "ambiguous") return "";
        missing.add(key);
        return blankMissing ? "" : `{{${key}}}`;
      }
      // Do not trim values: signatures and fixed text preserve their line breaks.
      return field.value;
    },
  );
  if (blankMissing) {
    output = output.replace(/\{\{[\s\S]*?\}\}/g, (code) => {
      const key =
        /^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/.exec(code)?.[1] ?? "invalid_field";
      missing.add(key);
      unknown.add(key);
      return "";
    });
    if (/\{\{|\}\}/.test(output)) {
      missing.add("invalid_field");
      unknown.add("invalid_field");
      output = output.replace(/\{\{|\}\}/g, "");
    }
  }
  return { output, missing: [...missing], unknown: [...unknown], normalized };
}
