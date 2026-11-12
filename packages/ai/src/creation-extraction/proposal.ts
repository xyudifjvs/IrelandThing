import { z } from "zod";
import {
  checklistDateRuleSchema,
  dateValueSchema,
  entityIdSchema,
} from "@weatherly/platform/handoff-contracts";
import type { CreationSources } from "./source-bundle";
import { quoteSupportsCents, quoteSupportsCivilDate } from "./evidence";

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

export function normalizeCreationProposal(
  proposal: CreationProposal,
  sources: CreationSources,
): CreationProposal {
  const normalized = (text: string) => text.replace(/\s+/g, " ").trim();
  const hasEvidence = ({
    evidence,
  }: {
    evidence: z.infer<typeof evidenceSchema>;
  }) => {
    const document = sources.documents.find(
      ({ versionId }) => versionId === evidence.versionId,
    );
    const page = document?.pages.find(({ page }) => page === evidence.page);
    return !!page && normalized(page.text).includes(normalized(evidence.quote));
  };
  const withEvidence = <T extends { evidence: z.infer<typeof evidenceSchema> }>(
    value: T | null,
  ) => (value && hasEvidence(value) ? value : null);
  const verifiedMoney = (value: CreationProposal["purchasePriceCents"]) => {
    const item = withEvidence(value);
    return item && quoteSupportsCents(item.evidence.quote, item.value)
      ? item
      : null;
  };
  const acceptance = withEvidence(proposal.acceptance);

  return {
    propertyAddress: withEvidence(proposal.propertyAddress),
    purchasePriceCents: verifiedMoney(proposal.purchasePriceCents),
    acceptance:
      acceptance &&
      quoteSupportsCivilDate(acceptance.evidence.quote, acceptance.value.date)
        ? acceptance
        : null,
    buyers: proposal.buyers.filter(hasEvidence),
    sellers: proposal.sellers.filter(hasEvidence),
    earnestMoneyCents: verifiedMoney(proposal.earnestMoneyCents),
    earnestMoneyHolder: withEvidence(proposal.earnestMoneyHolder),
    homeWarrantyCompany: withEvidence(proposal.homeWarrantyCompany),
    homeWarrantyCents: verifiedMoney(proposal.homeWarrantyCents),
    titleCompany: withEvidence(proposal.titleCompany),
    // The checklist calculates relative dates from authoritative anchors.
    dates: proposal.dates
      .filter((item) => {
        if (!hasEvidence(item)) return false;
        if (item.rule && item.rule.kind !== "fixed") return true;
        return (
          !!item.date &&
          quoteSupportsCivilDate(item.evidence.quote, item.date.date)
        );
      })
      .map((item) => {
        const { rule } = item;
        if (rule?.kind === "relative") {
          return {
            ...item,
            date: null,
            rule: { kind: rule.kind, offset: rule.offset },
          };
        }
        if (rule?.kind === "earliest") {
          return {
            ...item,
            date: null,
            rule: { kind: rule.kind, offsets: rule.offsets },
          };
        }
        return item;
      }),
  };
}
