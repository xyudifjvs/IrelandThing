import { z } from "zod";
import { validDate } from "@weatherly/platform";
import { offsetDate } from "@weatherly/matters";
export const factField = z.enum([
  "buyer_name",
  "seller_name",
  "property_address",
  "purchase_price",
  "earnest_money",
  "effective_date",
  "closing_date",
  "financing",
  "inspection_period",
  "other",
]);
const confidence = z.enum(["high", "medium", "low"]);
const page = z.number().int().positive().nullable();
export const timingRule = z.object({
  label: z.string().min(1).max(200),
  anchorLabel: z.string().min(1).max(200),
  offsetDays: z.number().int().min(-3650).max(3650),
  dayType: z.enum(["calendar", "business", "unclear"]),
  sourceQuote: z.string().min(1).max(5000),
  page,
  anchorDate: z.string().nullable(),
  anchorSourceQuote: z.string().max(5000),
  anchorPage: page,
  // A business-day calculation requires a quoted definition; no jurisdictional holiday defaults.
  businessCalendarQuote: z.string().max(5000).default(""),
  excludedDates: z
    .array(
      z.object({ date: z.string(), sourceQuote: z.string().min(1).max(1000) }),
    )
    .max(100)
    .default([]),
  confidence,
  uncertainty: z.string(),
});
export const extractedConflict = z
  .object({
    kind: z.enum(["fact", "deadline"]),
    field: z.string().min(1).max(200),
    reason: z.string().min(1).max(2000),
    candidates: z
      .array(
        z.object({
          value: z.string().max(5000),
          sourceQuote: z.string().min(1).max(5000),
          page,
        }),
      )
      .min(2)
      .max(20),
  })
  .superRefine((conflict, context) => {
    if (
      conflict.kind === "fact" &&
      !factField.safeParse(conflict.field).success
    )
      context.addIssue({
        code: "custom",
        path: ["field"],
        message: "Use a recognized transaction fact field.",
      });
  });
export type EvidenceCandidate = {
  value: string;
  sourceType: "document" | "intake" | "confirmed";
  sourceQuote: string;
  sourceDocumentId?: string;
  sourceVersionId?: string;
  page?: number | null;
};
export type SourceConflict = {
  key: string;
  kind: "fact" | "deadline";
  field: string;
  label: string;
  reason: string;
  candidates: EvidenceCandidate[];
};
export const normalizeSource = (s: string) => s.replace(/\s+/g, " ").trim();
export const deadlineKey = (label: string) =>
  "deadline:" + normalizeSource(label).toLowerCase();
const comparable = (s: string) => normalizeSource(s).toLowerCase();
export function timingFindings(
  rules: z.infer<typeof timingRule>[],
  text: string,
  documentId: string,
  versionId: string,
) {
  const supported = (quote: string) =>
    !!quote.trim() && normalizeSource(text).includes(normalizeSource(quote));
  const numberWords = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
  ];
  const dateStated = (date: string, quote: string) => {
    if (quote.includes(date)) return true;
    const [year, month, day] = date.split("-").map(Number);
    const months = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];
    const lower = quote.toLowerCase();
    return (
      new RegExp(
        "\\b" +
          month +
          "[/-]" +
          day +
          "[/-](?:" +
          year +
          "|" +
          String(year).slice(2) +
          ")\\b",
      ).test(lower) ||
      new RegExp(
        "\\b(?:" +
          months[month - 1] +
          "|" +
          months[month - 1]?.slice(0, 3) +
          ")\\.?\\s+" +
          day +
          "(?:st|nd|rd|th)?[,]?\\s+" +
          year +
          "\\b",
      ).test(lower)
    );
  };
  return rules
    .filter((rule) => supported(rule.sourceQuote))
    .map((rule) => {
      const anchorSupported =
        !!rule.anchorDate &&
        validDate(rule.anchorDate) &&
        supported(rule.anchorSourceQuote) &&
        dateStated(rule.anchorDate, rule.anchorSourceQuote);
      const count = Math.abs(rule.offsetDays),
        word = numberWords[count];
      const countStated = new RegExp(
        "\\b(?:" +
          count +
          (word ? "|" + word : "") +
          ")[)\\]]?\\s+(?:(?:calendar|business|working)\\s+)?days?\\b",
        "i",
      ).test(rule.sourceQuote);
      const directionStated =
        rule.offsetDays < 0
          ? /before|prior|preceding/i.test(rule.sourceQuote)
          : /after|following|from|\bof\b/i.test(rule.sourceQuote);
      const explicitCalendar =
        rule.dayType === "calendar" &&
        /calendar\s+days?/i.test(rule.sourceQuote);
      // The calculator excludes exactly Saturday and Sunday. Accept only
      // explicit definitions matching that calendar; unfamiliar or qualified
      // wording remains an unresolved rule for Ireland to review.
      const calendarDefinition = normalizeSource(rule.businessCalendarQuote)
        .toLowerCase()
        .replace(/[.!]$/, "");
      const weekendExclusionDefined =
        /^(?:business|working) days? (?:exclude|excludes|shall exclude|do not include) saturdays? (?:and|or) sundays?$/.test(
          calendarDefinition,
        ) ||
        /^(?:business|working) days? (?:are|mean|means|shall mean) (?:all )?days? (?:other than|except|excluding) saturdays? (?:and|or) sundays?$/.test(
          calendarDefinition,
        ) ||
        /^(?:business|working) days? (?:are|mean|means|shall mean) mondays? (?:through|to) fridays?(?: only)?$/.test(
          calendarDefinition,
        );
      const weekdaysDefined =
        rule.dayType === "business" &&
        supported(rule.businessCalendarQuote) &&
        weekendExclusionDefined;
      const exclusionsSupported = rule.excludedDates.every(
        (item) => validDate(item.date) && supported(item.sourceQuote),
      );
      const calculable =
        countStated &&
        directionStated &&
        anchorSupported &&
        (explicitCalendar || weekdaysDefined) &&
        exclusionsSupported;
      let proposedDate: string | null = null;
      if (calculable)
        try {
          proposedDate = offsetDate(
            rule.anchorDate!,
            rule.offsetDays,
            weekdaysDefined,
            rule.excludedDates.map((item) => item.date),
          );
        } catch {
          /* Keep the quoted rule for Ireland rather than guessing. */
        }
      return {
        ...rule,
        proposedDate,
        sourceDocumentId: documentId,
        sourceVersionId: versionId,
        requiresApproval: true,
        calculationNote: proposedDate
          ? "Calculated from the quoted contract rule and quoted anchor; requires Ireland’s approval."
          : "Confirm the anchor and contract day-count definition before choosing a date. No standard or jurisdictional offset was substituted.",
      };
    });
}
export function findSourceConflicts(input: {
  facts: {
    field: string;
    value: string;
    sourceQuote: string;
    page?: number | null;
  }[];
  deadlines: {
    label: string;
    date: string | null;
    sourceQuote: string;
    page?: number | null;
  }[];
  reported: z.infer<typeof extractedConflict>[];
  matter: {
    propertyAddress: string;
    side: string;
    details: unknown;
    deadlines: {
      label: string;
      date: string | null;
      status: string;
      sourceDocumentId?: string | null;
      details: unknown;
    }[];
  };
  text: string;
  documentId: string;
  versionId: string;
}): SourceConflict[] {
  const conflicts = new Map<string, SourceConflict>();
  const groups = new Map<
    string,
    {
      kind: "fact" | "deadline";
      field: string;
      candidates: EvidenceCandidate[];
      reason?: string;
    }
  >();
  const add = (
    kind: "fact" | "deadline",
    field: string,
    candidate: EvidenceCandidate,
    reason?: string,
  ) => {
    const key = kind === "fact" ? "fact:" + field : deadlineKey(field);
    const group = groups.get(key) || { kind, field, candidates: [] };
    group.candidates.push(candidate);
    if (reason) group.reason = reason;
    groups.set(key, group);
  };
  const doc = (
    value: string,
    sourceQuote: string,
    page?: number | null,
  ): EvidenceCandidate => ({
    value,
    sourceType: "document",
    sourceQuote,
    sourceDocumentId: input.documentId,
    sourceVersionId: input.versionId,
    page: page ?? null,
  });
  for (const f of input.facts)
    add("fact", f.field, doc(f.value, f.sourceQuote, f.page));
  for (const d of input.deadlines)
    if (d.date) add("deadline", d.label, doc(d.date, d.sourceQuote, d.page));
  for (const reported of input.reported) {
    for (const candidate of reported.candidates)
      if (
        normalizeSource(input.text).includes(
          normalizeSource(candidate.sourceQuote),
        )
      )
        add(
          reported.kind,
          reported.field,
          doc(candidate.value, candidate.sourceQuote, candidate.page),
          reported.reason,
        );
  }
  const details = (input.matter.details || {}) as Record<string, unknown>,
    confirmed = (details.confirmedFacts || {}) as Record<string, unknown>;
  const clients = Array.isArray(details.clients)
    ? (details.clients as { name?: string }[])
    : [];
  const values: Record<string, unknown> = {
    property_address: input.matter.propertyAddress,
    purchase_price: details.purchasePrice,
    earnest_money: details.earnestMoney,
    financing: details.purchaseType,
    [input.matter.side === "seller" ? "seller_name" : "buyer_name"]: clients
      .map((c) => c.name)
      .filter(Boolean)
      .join("; "),
  };
  for (const [field, value] of Object.entries(confirmed)) {
    const actual =
      typeof value === "object" && value !== null && "value" in value
        ? (value as { value: unknown }).value
        : value;
    if (typeof actual === "string" || typeof actual === "number")
      values[field] = String(actual);
  }
  for (const group of groups.values()) {
    if (group.kind === "fact") {
      const previous = values[group.field];
      if (
        (typeof previous === "string" || typeof previous === "number") &&
        String(previous).trim()
      )
        group.candidates.push({
          value: String(previous),
          sourceType: Object.hasOwn(confirmed, group.field)
            ? "confirmed"
            : "intake",
          sourceQuote: Object.hasOwn(confirmed, group.field)
            ? "Previously approved saved fact"
            : "Saved transaction intake",
        });
    } else
      for (const prior of input.matter.deadlines.filter(
        (d) =>
          comparable(d.label) === comparable(group.field) &&
          d.status === "confirmed" &&
          d.date,
      )) {
        const evidence = (prior.details || {}) as {
          sourceQuote?: string;
          sourceVersionId?: string;
        };
        group.candidates.push({
          value: prior.date!,
          sourceType: "confirmed",
          sourceQuote: evidence.sourceQuote || "Previously approved deadline",
          ...(prior.sourceDocumentId
            ? { sourceDocumentId: prior.sourceDocumentId }
            : {}),
          ...(evidence.sourceVersionId
            ? { sourceVersionId: evidence.sourceVersionId }
            : {}),
        });
      }
    const distinct = new Set(
      group.candidates.map((c) => {
        if (
          group.kind === "fact" &&
          ["purchase_price", "earnest_money"].includes(group.field)
        ) {
          const amount = c.value.replace(/[$,\s]/g, "").replace(/USD$/i, "");
          if (/^\d+(?:\.\d{1,2})?$/.test(amount)) return String(Number(amount));
        }
        return comparable(c.value);
      }),
    );
    if (distinct.size > 1) {
      const key =
        group.kind === "fact"
          ? "fact:" + group.field
          : deadlineKey(group.field);
      conflicts.set(key, {
        key,
        kind: group.kind,
        field: group.field,
        label: group.field,
        reason:
          group.reason ||
          "Source values disagree. Ireland must choose or correct the value before it becomes authoritative.",
        candidates: group.candidates,
      });
    }
  }
  return [...conflicts.values()];
}
