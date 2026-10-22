import { z } from "zod";
export const extractionSchema = z
  .object({
    summary: z.string(),
    deadlines: z.array(
      z.object({
        label: z.string(),
        date: z.string().nullable(),
        sourceQuote: z.string(),
        page: z.number().int().positive().nullable(),
        confidence: z.enum(["high", "medium", "low"]),
        uncertainty: z.string(),
      }),
    ),
    facts: z.array(
      z.object({
        field: z.enum([
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
        ]),
        value: z.string(),
        sourceQuote: z.string(),
        page: z.number().int().positive().nullable(),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    ),
    warnings: z.array(z.string()),
  })
  .strict();
