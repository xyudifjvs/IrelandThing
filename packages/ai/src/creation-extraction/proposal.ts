import { z } from "zod";
import {
  checklistDateRuleSchema,
  dateValueSchema,
  entityIdSchema,
} from "@weatherly/platform/handoff-contracts";
import type { CreationSources } from "./source-bundle";
import {
  normalizeEvidenceText,
  quoteSupportsCents,
  quoteSupportsCivilDate,
  quoteSupportsInstant,
} from "./evidence";

export const extractionDateKeySchema = z.enum([
  "preapproval_pof",
  "loan_application",
  "earnest_money_due",
  "attorney_review",
  "inspections",
  "remedies",
  "remedies_negotiated",
  "condo_hoa_docs_provided",
  "condo_hoa_doc_review",
  "appraisal",
  "loan_commitment",
  "title_commitment",
  "final_walkthrough",
  "closing",
  "possession",
]);

const evidenceSchema = z
  .object({
    versionId: entityIdSchema,
    page: z.number().int().positive(),
    quote: z.string().trim().min(1).max(1000),
  })
  .strict();

const supported = <T extends z.ZodType>(value: T) =>
  z
    .object({
      value,
      evidence: evidenceSchema,
    })
    .strict()
    .nullable();

const name = z.string().trim().min(1).max(200);
const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const [fixed, relative, earliest] = checklistDateRuleSchema.options;
const extractedRuleSchema = z.discriminatedUnion("kind", [
  fixed,
  relative.omit({ adjustments: true }),
  earliest.omit({ adjustments: true }),
]);

export const creationProposalSchema = z
  .object({
    propertyAddress: supported(z.string().trim().min(1).max(500)),
    purchasePriceCents: supported(cents),
    acceptance: supported(dateValueSchema),
    buyers: z.array(supported(name).unwrap()).max(20),
    sellers: z.array(supported(name).unwrap()).max(20),
    earnestMoneyCents: supported(cents),
    earnestMoneyHolder: supported(name),
    homeWarrantyCompany: supported(name),
    homeWarrantyCents: supported(cents),
    titleCompany: supported(name),
    dates: z
      .array(
        z
          .object({
            key: extractionDateKeySchema,
            date: dateValueSchema.nullable(),
            rule: extractedRuleSchema.nullable(),
            evidence: evidenceSchema,
          })
          .strict(),
      )
      .max(extractionDateKeySchema.options.length)
      .refine(
        (dates) => new Set(dates.map(({ key }) => key)).size === dates.length,
      ),
  })
  .strict();

export type CreationProposal = z.infer<typeof creationProposalSchema>;
type Cited = { evidence: z.infer<typeof evidenceSchema> };

export function normalizeCreationProposal(
  proposal: CreationProposal,
  sources: CreationSources,
): CreationProposal {
  const readEvidence = ({ evidence }: Cited) => {
    const document = sources.documents.find(
      ({ versionId }) => versionId === evidence.versionId,
    );
    const page = document?.pages.find(({ page }) => page === evidence.page);
    if (!page) return null;
    const pageText = normalizeEvidenceText(page.text);
    const quote = normalizeEvidenceText(evidence.quote);
    return pageText.includes(quote) ? { pageText, quote } : null;
  };
  const withEvidence = <T extends Cited>(value: T | null) =>
    value && readEvidence(value) ? value : null;
  const verifiedMoney = (value: CreationProposal["purchasePriceCents"]) => {
    const evidence = value && readEvidence(value);
    return value &&
      evidence &&
      quoteSupportsCents(evidence.pageText, evidence.quote, value.value)
      ? value
      : null;
  };
  const verifiedDate = (
    value: z.infer<typeof dateValueSchema> | null,
    citation: Cited,
  ) => {
    const evidence = value && readEvidence(citation);
    if (
      !value ||
      !evidence ||
      !quoteSupportsCivilDate(evidence.pageText, evidence.quote, value.date)
    )
      return null;
    return {
      ...value,
      instant:
        value.instant &&
        quoteSupportsInstant(evidence.pageText, evidence.quote, value)
          ? value.instant
          : null,
    };
  };
  const acceptance =
    proposal.acceptance &&
    verifiedDate(proposal.acceptance.value, proposal.acceptance);

  return {
    propertyAddress: withEvidence(proposal.propertyAddress),
    purchasePriceCents: verifiedMoney(proposal.purchasePriceCents),
    acceptance:
      acceptance && proposal.acceptance
        ? { ...proposal.acceptance, value: acceptance }
        : null,
    buyers: proposal.buyers.filter(readEvidence),
    sellers: proposal.sellers.filter(readEvidence),
    earnestMoneyCents: verifiedMoney(proposal.earnestMoneyCents),
    earnestMoneyHolder: withEvidence(proposal.earnestMoneyHolder),
    homeWarrantyCompany: withEvidence(proposal.homeWarrantyCompany),
    homeWarrantyCents: verifiedMoney(proposal.homeWarrantyCents),
    titleCompany: withEvidence(proposal.titleCompany),
    // The checklist calculates relative dates from authoritative anchors.
    dates: proposal.dates.flatMap<CreationProposal["dates"][number]>((item) => {
      const { rule } = item;
      if (rule && rule.kind !== "fixed") {
        return readEvidence(item) ? [{ ...item, date: null }] : [];
      }
      const date = verifiedDate(item.date, item);
      return date ? [{ ...item, date }] : [];
    }),
  };
}
