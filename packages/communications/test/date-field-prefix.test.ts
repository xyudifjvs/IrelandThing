import { expect, it } from "vitest";
import { replaceFieldText, renderBodyFields } from "../src/field-renderer";
import type { MergeField } from "../src/merge-fields";

const field = (
  key: string,
  value: string | null,
  extra: Partial<MergeField> = {},
): MergeField => ({
  key,
  value,
  label: key,
  status: value ? "confirmed" : "unknown",
  sourceIds: [],
  ...extra,
});
const fields = [
  field("loan_app_deadline", "8/25/26"),
  field("attorney_review_deadline", "N/A", { checklistNotNeeded: true }),
  field("hoa_review_deadline", "Received", { dateDisplayText: true }),
  field("hoa_provision_deadline", "Provided to the buyers 11/25", {
    dateDisplayText: true,
  }),
  field("closing_date", "8/30/26", { dateDisplayText: true }),
  field("lender_name", "N/A"),
  field("appraisal_ordered_deadline", null, { optionalBlank: true }),
];

it.each(["By", "by"])(
  "keeps %s for regular dates and removes it for skipped dates or exact saved wording",
  (by) => {
    const result = replaceFieldText(
      `${by} {{loan_app_deadline}} | Attorney: ${by} {{attorney_review_deadline}} | HOA: ${by} {{hoa_review_deadline}} | Provided: ${by} {{hoa_provision_deadline}} | Typed date: ${by} {{closing_date}}`,
      fields,
      true,
    );
    expect(result.output).toBe(
      `${by} 8/25/26 | Attorney: N/A | HOA: Received | Provided: Provided to the buyers 11/25 | Typed date: 8/30/26`,
    );
    expect(result.missing).toEqual([]);
  },
);

it("does not remove words from unrelated fields, longer words, other capitalization, blanks or across a line break", () => {
  const source =
    "Lender: By {{lender_name}} | nearby {{hoa_review_deadline}} | BY {{hoa_review_deadline}} | By\n{{hoa_review_deadline}} | By {{appraisal_ordered_deadline}}";
  expect(replaceFieldText(source, fields, true).output).toBe(
    "Lender: By N/A | nearby Received | BY Received | By\nReceived | By ",
  );
  expect(
    replaceFieldText(
      "By {{hoa_review_deadline}}",
      [
        field("hoa_review_deadline", "Received", {
          dateDisplayText: true,
          status: "ambiguous",
        }),
      ],
      true,
    ).output,
  ).toBe("By ");
});

it("recognizes legacy aliases and never removes By from the filled value itself", () => {
  expect(
    replaceFieldText("By {{deadline_attorney_review}}", fields, true).output,
  ).toBe("N/A");
  expect(
    replaceFieldText(
      "By {{hoa_review_deadline}}",
      [
        field("hoa_review_deadline", "By arrangement", {
          dateDisplayText: true,
        }),
      ],
      true,
    ).output,
  ).toBe("By arrangement");
});

it("handles inline marks, atomic field spans and HTML spaces while preserving date formatting", () => {
  const html =
    "<p>Loan: By <strong>{{loan_app_deadline}}</strong></p><p>Attorney: <strong>by </strong><span>{{attorney_review_deadline}}</span></p><p>HOA: <em>B</em>y&nbsp;<strong><span>{{hoa_review_deadline}}</span></strong></p><p>Provided: By <u>{{hoa_provision_deadline}}</u></p>";
  const result = renderBodyFields(html, fields, false, "html");
  expect(result.output).toContain("Loan: By <strong>8/25/26</strong>");
  expect(result.output).toContain("<span>N/A</span>");
  expect(result.output).toContain("<strong><span>Received</span></strong>");
  expect(result.output).toContain("<u>Provided to the buyers 11/25</u>");
  expect(result.output.match(/(?:By|by) /g)).toEqual(["By "]);
  expect(result.editorOutput).toBe(result.output);
  expect(result.previewOutput).toBe(result.output);
});

it("does not join paragraphs, list items or soft-break lines, and retains the skipped-line policy", () => {
  const html =
    "<p>By </p><p>{{hoa_review_deadline}}</p><p>By <br>{{hoa_review_deadline}}</p><ul><li>by </li><li>{{hoa_review_deadline}}</li></ul><p>Attorney: By {{attorney_review_deadline}}</p>";
  const result = renderBodyFields(html, fields, true, "html");
  expect(result.output).toContain("<p>By </p><p>Received</p>");
  expect(result.output).toContain("<p>By <br />Received</p>");
  expect(result.output).toContain("<li>by </li><li>Received</li>");
  expect(result.output).not.toContain("Attorney");
});
