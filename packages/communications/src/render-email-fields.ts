import { createHash } from "node:crypto";
import type { Principal } from "@weatherly/platform";
import { assertCoordinator, HttpError } from "@weatherly/platform";
import { mergeFields } from "./merge-fields";
import { listCustomMergeFields } from "./custom-merge-fields";
import { canonicalFieldKey } from "./field-catalog";
import { renderBodyFields, replaceFieldText } from "./field-renderer";
import { asRecord } from "./policy";
import { prisma } from "@weatherly/db";
import type { FieldDb } from "./field-sources";
import { hideNotNeededLines } from "./template-line-policy";

export async function renderEmailFields(
  actor: Principal,
  matterId: string,
  subject: string,
  body: string,
  db: FieldDb = prisma,
  values: Record<string, string> = {},
  templateId?: string,
  bodyFormat: string = "plain",
) {
  assertCoordinator(actor);
  const [builtins, custom] = await Promise.all([
    mergeFields(actor, matterId, db),
    listCustomMergeFields(actor, db),
  ]);
  const customKeys = new Set(
    custom.map((field) => canonicalFieldKey(field.key)),
  );
  const fields: import("./merge-fields").MergeField[] = [
    ...builtins.filter((field) => !customKeys.has(field.key)),
    ...custom.map((field) => {
      const key = canonicalFieldKey(field.key),
        value = Object.hasOwn(values, key) ? values[key] : field.defaultValue;
      return {
        key,
        label: field.label,
        value,
        status: value.trim() ? ("confirmed" as const) : ("unknown" as const),
        sourceIds: [field.key, String(field.revision)],
      };
    }),
  ];
  const template = templateId
    ? await db.communicationTemplate.findUnique({ where: { id: templateId } })
    : null;
  if (templateId && !template?.active)
    throw new HttpError(
      409,
      "TEMPLATE_CHANGED",
      "Choose a current template and refresh the preview.",
    );
  const hide = template ? hideNotNeededLines(template) : false;
  const renderedSubject = replaceFieldText(subject, fields, true),
    renderedBody = renderBodyFields(body, fields, hide, bodyFormat);
  if (/[\r\n]/.test(renderedSubject.output))
    throw new HttpError(
      422,
      "MULTILINE_SUBJECT_FIELD",
      "This field has multiple lines. Use it in the body, or choose a single-line subject value.",
    );
  if (
    renderedSubject.output.length > 998 ||
    renderedBody.output.length > 1000000
  )
    throw new HttpError(
      422,
      "MERGED_EMAIL_TOO_LONG",
      "The filled email exceeds the subject or message length limit.",
    );
  const missingFields = [
    ...new Set([...renderedSubject.missing, ...renderedBody.missing]),
  ];
  const unknownFields = [
    ...new Set([...renderedSubject.unknown, ...renderedBody.unknown]),
  ];
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        subject: renderedSubject.output,
        body: renderedBody.output,
        hideNotNeededLines: hide,
        ...(bodyFormat === "html" ? { bodyFormat } : {}),
        fields: fields
          .filter((field) =>
            [renderedSubject.normalized, renderedBody.normalized].some(
              (source) => source.includes(`{{${field.key}}}`),
            ),
          )
          .map((field) => [
            field.key,
            field.value,
            ...(field.htmlValue ? [field.htmlValue] : []),
            field.status,
            field.sourceIds,
          ]),
      }),
    )
    .digest("hex");
  return {
    subject: renderedSubject.output,
    body: renderedBody.output,
    previewBody: renderedBody.previewOutput,
    missingFields,
    unknownFields,
    fingerprint,
  };
}

export async function validateAuthoredMergeFields(
  actor: Principal,
  draft: {
    matterId: string;
    subject: string;
    body: string;
    bodyFormat?: string;
    details: unknown;
  },
  db: FieldDb = prisma,
) {
  const source = asRecord(asRecord(draft.details).authoredMerge);
  if (
    typeof source.subjectSource !== "string" ||
    typeof source.bodySource !== "string"
  )
    return;
  const values = Object.fromEntries(
    Object.entries(asRecord(source.values)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const current = await renderEmailFields(
    actor,
    draft.matterId,
    source.subjectSource,
    source.bodySource,
    db,
    values,
    typeof asRecord(draft.details).templateId === "string"
      ? String(asRecord(draft.details).templateId)
      : undefined,
    draft.bodyFormat,
  );
  if (current.missingFields.length)
    throw new HttpError(
      422,
      "MISSING_MERGE_FIELD",
      `Fill or remove these fields before sending: ${current.missingFields.map((key) => `{{${key}}}`).join(", ")}`,
    );
  if (
    current.subject !== draft.subject ||
    current.body !== draft.body ||
    current.fingerprint !== source.fingerprint
  )
    throw new HttpError(
      409,
      "SOURCE_PREVIEW_CHANGED",
      "A field changed after this email was saved. Refresh the filled preview and review it before sending.",
    );
}
