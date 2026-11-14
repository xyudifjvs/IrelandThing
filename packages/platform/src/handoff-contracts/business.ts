import { z } from "zod";

export const businessSchema = z.enum(["hto", "weatherly"]);
export type Business = z.infer<typeof businessSchema>;

export const transactionSideSchema = z.enum(["buyer", "seller"]);
export type TransactionSide = z.infer<typeof transactionSideSchema>;

export const weatherlyServiceSchema = z.enum(["essentials", "complete"]);
export const htoServiceCode = "hto_included";

export const transactionBusinessSchema = z.discriminatedUnion("business", [
  z
    .object({
      business: z.literal("hto"),
      packageCode: z.literal(htoServiceCode),
    })
    .strict(),
  z
    .object({
      business: z.literal("weatherly"),
      packageCode: weatherlyServiceSchema,
    })
    .strict(),
]);
export type TransactionBusiness = z.infer<typeof transactionBusinessSchema>;

export function serviceFeeApplies(file: { business: Business | null }) {
  // Unclassified legacy files retain their existing service eligibility rules.
  return file.business !== "hto";
}
