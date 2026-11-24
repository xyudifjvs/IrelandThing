import { expect, it } from "vitest";
import {
  comparableEmailBody,
  emailHtmlText,
  emailMimeContent,
  sanitizeEmailHtml,
} from "../src/email-html";
import { renderBodyFields } from "../src/field-renderer";
import type { MergeField } from "../src/merge-fields";

const fields: MergeField[] = [
  {
    key: "property_address",
    label: "Address",
    value: "<img src=x onerror=alert(1)> & 123 Lane",
    status: "confirmed",
    sourceIds: [],
  },
  {
    key: "attorney_review_deadline",
    label: "Attorney",
    value: "N/A",
    checklistNotNeeded: true,
    optionalBlank: true,
    status: "confirmed",
    sourceIds: [],
  },
  {
    key: "appraisal_ordered_deadline",
    label: "Appraisal",
    value: null,
    optionalBlank: true,
    status: "unknown",
    sourceIds: [],
  },
  {
    key: "lender_name",
    label: "Lender",
    value: null,
    status: "unknown",
    sourceIds: [],
  },
];

it("allows only the requested formatting, safe links and small embedded signature images", () => {
  const html = sanitizeEmailHtml(
    '<script>alert(1)</script><p onclick="bad()" style="background:red;color:red"><b>Bold</b> <i>Italic</i> <u>Underline</u><span style="font-size:18px">Large</span><span style="color:red;font-family:Comic">Plain</span><a href="javascript:alert(1)">Bad</a><a href="https://example.test">Good</a><img src="https://tracker.example.test/pixel"><img src="data:image/svg+xml;base64,PHN2Zz4=" /></p>',
  );
  expect(html).toContain("<strong>Bold</strong>");
  expect(html).toContain("<em>Italic</em>");
  expect(html).toContain('<span style="font-size:18px">Large</span>');
  for (const bad of [
    "script",
    "onclick",
    "color:",
    "background",
    "font-family",
    "javascript",
    "<img",
  ])
    expect(html).not.toContain(bad);
  expect(html).toContain('<a href="https://example.test">Good</a>');
  expect(sanitizeEmailHtml(html)).toBe(html);
});

it("fills bold tokens with escaped data while preserving the formatting", () => {
  const result = renderBodyFields(
    "<p>Address: <strong>{{property_address}}</strong></p>",
    fields,
    false,
    "html",
  );
  expect(result.output).toContain(
    "<strong>&lt;img src=x onerror=alert(1)&gt; &amp; 123 Lane</strong>",
  );
  expect(result.output).not.toContain("<img");
  expect(result.output).not.toContain("{{");
});

it("hides the paragraph/list item/soft-break line for skipped dates and keeps needed blank dates", () => {
  const result = renderBodyFields(
    "<p>Keep</p><ul><li><p>Attorney: <strong>{{attorney_review_deadline}}</strong></p></li><li>Appraisal: {{appraisal_ordered_deadline}}</li></ul><p>First<br>Attorney: {{attorney_review_deadline}}<br>Last</p>",
    fields,
    true,
    "html",
  );
  expect(result.output).not.toContain("Attorney");
  expect(result.output).toContain("<li>Appraisal: </li>");
  expect(result.output).toContain("First<br />Last");
  expect(result.missing).toEqual([]);
});

it("uses N/A with hiding off and preview-only highlights for required fields only", () => {
  const result = renderBodyFields(
    "<p>Attorney: {{attorney_review_deadline}}</p><p>Appraisal: {{appraisal_ordered_deadline}}</p><p>Lender: {{lender_name}}</p>",
    fields,
    false,
    "html",
  );
  expect(result.output).toContain("Attorney: N/A");
  expect(result.output).toContain("Appraisal: </p>");
  expect(result.previewOutput).toContain("<mark>Missing lender name</mark>");
  expect(result.previewOutput).not.toContain("Missing appraisal");
  expect(result.previewOutput).not.toContain("{{");
  expect(result.editorOutput).toContain("{{lender_name}}");
  expect(result.output).not.toContain("<mark>");
  expect(result.missing).toEqual(["lender_name"]);
});

it("includes readable text lists and links and treats old literal HTML as plain text", () => {
  expect(
    emailHtmlText(
      '<h2>Title</h2><ul><li>One</li><li>Two</li></ul><ol><li>A</li><li>B</li></ol><p><a href="https://example.test">Website</a></p>',
    ),
  ).toContain("• One\n• Two\n");
  expect(emailHtmlText("<ol><li>A</li><li>B</li></ol>")).toBe("1. A\n2. B");
  expect(emailHtmlText('<a href="https://example.test">Website</a>')).toBe(
    "Website (https://example.test)",
  );
  expect(
    emailMimeContent("Keep <strong>literal</strong>\nNext").html,
  ).toContain("&lt;strong&gt;literal&lt;/strong&gt;");
  expect(emailMimeContent("Keep <strong>literal</strong>").text).toBe(
    "Keep <strong>literal</strong>",
  );
  expect(comparableEmailBody("Hello\n\nNext")).toBe(
    comparableEmailBody("<p>Hello</p><p></p><p>Next</p>", "html"),
  );
});

it("keeps a signature block outside a paragraph even when the editor wraps its code in an atomic span", () => {
  const signature: MergeField = {
    key: "tc_signature",
    label: "Signature",
    value: "Coordinator",
    status: "confirmed",
    sourceIds: [],
    htmlValue: "<p><strong>Coordinator</strong></p><p>Office</p>",
  };
  const result = renderBodyFields(
    "<p><span>{{tc_signature}}</span></p>",
    [signature],
    false,
    "html",
  );
  expect(result.output).toBe(signature.htmlValue);
});

it("blanks malformed HTML-split codes and reports them instead of exposing a raw code in the preview", () => {
  const result = renderBodyFields(
    "<p>Address: {{property_<strong>address</strong>}}</p>",
    fields,
    false,
    "html",
  );
  expect(result.output).not.toContain("{{");
  expect(result.previewOutput).not.toContain("{{");
  expect(result.missing).toContain("invalid_field");
});
