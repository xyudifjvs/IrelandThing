import { z } from "zod";
import { factField, timingRule, extractedConflict } from "./findings";
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
        field: factField,
        value: z.string(),
        sourceQuote: z.string(),
        page: z.number().int().positive().nullable(),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    ),
    timingRules: z.array(timingRule).max(80).default([]),
    conflicts: z.array(extractedConflict).max(80).default([]),
    warnings: z.array(z.string()),
  })
  .strict();
