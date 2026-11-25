import {
  escapedFieldHtml,
  sanitizeEmailHtml,
  omitHtmlFieldLines,
} from "./email-html";
import { omitNotNeededLines } from "./template-line-policy";
import { canonicalFieldKey, normalizeFieldCodes } from "./field-catalog";
import type { MergeField } from "./merge-fields";
import { removeDateByPrefix } from "./date-field-prefix";

export function replaceFieldText(
  source: string,
  fields: readonly MergeField[],
  blankMissing = false,
  html = false,
  highlightMissing = false,
) {
  const known = new Map(
    fields.map((field) => [canonicalFieldKey(field.key), field]),
  );
  const missing = new Set<string>(),
    unknown = new Set<string>();
  const normalized = normalizeFieldCodes(source);
  let output = removeDateByPrefix(normalized, fields, html).replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, key: string) => {
      const field = known.get(key);
      if (!field) {
        unknown.add(key);
        missing.add(key);
        return html && highlightMissing
          ? `<mark>Missing ${key.replace(/_/g, " ")}</mark>`
          : blankMissing
            ? ""
            : `{{${key}}}`;
      }
      if (field.status !== "confirmed" || !field.value?.trim()) {
        if (field.optionalBlank && field.status !== "ambiguous") return "";
        missing.add(key);
        return html && highlightMissing
          ? `<mark>Missing ${key.replace(/_/g, " ")}</mark>`
          : blankMissing
            ? ""
            : `{{${key}}}`;
      }
      // Do not trim values: signatures and fixed text preserve their line breaks.
      return html
        ? field.htmlValue
          ? sanitizeEmailHtml(field.htmlValue)
          : escapedFieldHtml(field.value)
        : field.value;
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

export function renderBodyFields(
  source: string,
  fields: readonly MergeField[],
  hide: boolean,
  format?: string,
) {
  if (format !== "html") {
    const clean = omitNotNeededLines(source, fields, hide),
      result = replaceFieldText(clean, fields, true);
    return {
      ...result,
      editorOutput: replaceFieldText(clean, fields).output,
      previewOutput: undefined as string | undefined,
    };
  }
  let clean = sanitizeEmailHtml(source);
  if (hide)
    clean = omitHtmlFieldLines(
      clean,
      new Set(
        fields
          .filter((f) => f.checklistNotNeeded && f.status === "confirmed")
          .map((f) => canonicalFieldKey(f.key)),
      ),
      canonicalFieldKey,
    );
  // A signature occupying a paragraph is itself a block of paragraphs/lists.
  clean = clean.replace(
    /<p>(?:<(?:strong|em|u|span)(?: style="font-size:18px")?>)*\s*(\{\{\s*[a-zA-Z0-9_]+\s*\}\})\s*(?:<\/(?:strong|em|u|span)>)*<\/p>/g,
    (paragraph, code: string) => {
      const key = canonicalFieldKey(code.replace(/[{}\s]/g, ""));
      return fields.find((f) => canonicalFieldKey(f.key) === key)?.htmlValue
        ? code
        : paragraph;
    },
  );
  const result = replaceFieldText(clean, fields, true, true);
  return {
    ...result,
    output: sanitizeEmailHtml(result.output),
    editorOutput: sanitizeEmailHtml(
      replaceFieldText(clean, fields, false, true).output,
    ),
    previewOutput: sanitizeEmailHtml(
      replaceFieldText(clean, fields, true, true, true).output,
      true,
    ),
  };
}
