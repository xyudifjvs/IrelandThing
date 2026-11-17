import { z } from "zod";
import { transactionBusinessSchema, transactionSideSchema } from "./business";
import {
  checklistDateInputSchema,
  dateValueSchema,
  entityIdSchema,
  revisionSchema,
} from "./checklist";

export const sourceVersionSchema = z
  .object({
    documentId: entityIdSchema,
    versionId: entityIdSchema,
  })
  .strict();
export type SourceVersion = z.infer<typeof sourceVersionSchema>;

export const extractionStatusSchema = z.enum([
  "idle",
  "queued",
  "running",
  "proposed",
  "unavailable",
  "skipped",
]);
export type ExtractionStatus = z.infer<typeof extractionStatusSchema>;

export const creationPersonSchema = z
  .object({
    role: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(200),
    email: z.union([z.literal(""), z.email().max(254)]),
    phone: z.string().trim().max(60),
    company: z.string().trim().max(200).optional(),
  })
  .strict();
export type CreationPerson = z.infer<typeof creationPersonSchema>;

export const transactionFactsSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    propertyAddress: z.string().trim().min(1).max(500),
    side: transactionSideSchema,
    agentId: entityIdSchema.nullable(),
    agentRosterId: entityIdSchema.nullable(),
    purchaseType: z.enum(["cash", "financed"]).nullable(),
    purchasePriceCents: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    acceptance: dateValueSchema.nullable(),
    earnestMoneyCents: z
      .number()
      .int()
      .nonnegative()
      .max(10000000000)
      .nullable()
      .optional(),
    earnestMoneyHolder: z.string().trim().max(300).optional(),
    homeWarrantyCents: z
      .number()
      .int()
      .nonnegative()
      .max(10000000000)
      .nullable()
      .optional(),
    homeWarrantyCompany: z.string().trim().max(300).optional(),
    deadlineTimeZone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((timeZone) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone });
          return true;
        } catch {
          return false;
        }
      }, "Use an IANA timezone.")
      .nullable()
      .optional(),
  })
  .strict();

export const creationConfirmSchema = z
  .object({
    expectedRevision: revisionSchema,
    requestId: z.uuid(),
    business: transactionBusinessSchema,
    facts: transactionFactsSchema,
    people: z.array(creationPersonSchema).max(100),
    dates: z
      .array(checklistDateInputSchema)
      .max(150)
      .refine(
        (dates) => new Set(dates.map(({ key }) => key)).size === dates.length,
        "Checklist keys must be distinct.",
      ),
  })
  .strict();
export type CreationConfirm = z.infer<typeof creationConfirmSchema>;
