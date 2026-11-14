import { z } from "zod";
import {
  creationConfirmSchema,
  creationPersonSchema,
  entityIdSchema,
  revisionSchema,
  sourceVersionSchema,
  transactionBusinessSchema,
  transactionFactsSchema,
} from "@weatherly/platform/handoff-contracts";

export const startReviewSchema = z
  .object({ intakeId: entityIdSchema.optional(), requestId: z.uuid() })
  .strict();

export const sourcesSchema = z
  .array(sourceVersionSchema)
  .max(120)
  .refine(
    (refs) => new Set(refs.map((ref) => ref.documentId)).size === refs.length,
    "Pin at most one version of each document.",
  );

export const draftPersonSchema = creationPersonSchema.extend({
  name: z.string().trim().max(200),
  email: z.string().trim().max(254),
});

export const reviewPayloadSchema = z
  .object({
    business: transactionBusinessSchema.optional(),
    facts: transactionFactsSchema.partial().extend({
      title: z.string().trim().max(200).optional(),
      propertyAddress: z.string().trim().max(500).optional(),
    }),
    people: z.array(draftPersonSchema).max(100),
    peopleEdited: z.boolean().optional(),
    dates: creationConfirmSchema.shape.dates,
  })
  .strict();

export const saveReviewSchema = reviewPayloadSchema
  .omit({ peopleEdited: true })
  .partial()
  .extend({
    expectedRevision: revisionSchema,
    sources: sourcesSchema.optional(),
  })
  .refine(
    ({ business, facts, people, dates, sources }) =>
      [business, facts, people, dates, sources].some(
        (edit) => edit !== undefined,
      ),
    "Provide at least one review edit.",
  );

export const extractionActionSchema = z
  .object({
    expectedRevision: revisionSchema,
    action: z.enum(["start", "skip"]),
  })
  .strict();

export type ReviewPayload = z.infer<typeof reviewPayloadSchema>;
