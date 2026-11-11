import { z } from "zod";

export const civilDateSchema = z.iso.date();
export const revisionSchema = z.number().int().positive();
export const entityIdSchema = z.string().trim().min(1).max(200);
export const stepKeySchema = z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/);

export const dateValueSchema = z
  .object({
    date: civilDateSchema,
    instant: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
export type DateValue = z.infer<typeof dateValueSchema>;

export const dateAnchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("acceptance") }).strict(),
  z.object({ kind: z.literal("step"), key: stepKeySchema }).strict(),
  z.object({ kind: z.literal("actual"), key: stepKeySchema }).strict(),
]);

const calendarSchema = z
  .object({
    workingWeekdays: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .refine(
        (days) => new Set(days).size === days.length,
        "Working days must be distinct.",
      ),
    excludedDates: z.array(civilDateSchema).max(366),
  })
  .strict();

const offsetSchema = z
  .object({
    anchor: dateAnchorSchema,
    amount: z.number().int().min(-87600).max(87600),
    unit: z.enum(["days", "hours"]),
    counting: z.enum(["calendar", "business", "unspecified"]),
    rollover: z.enum([
      "none",
      "next_workday",
      "previous_workday",
      "unspecified",
    ]),
    calendar: calendarSchema.nullable(),
  })
  .strict()
  .superRefine((offset, ctx) => {
    if (offset.unit === "days" && Math.abs(offset.amount) > 3650) {
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: "The day offset is too large.",
      });
    }
    if (
      (offset.counting === "business" ||
        offset.rollover === "next_workday" ||
        offset.rollover === "previous_workday") &&
      !offset.calendar
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["calendar"],
        message: "A working calendar is required.",
      });
    }
  });

export const checklistDateRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed") }).strict(),
  z.object({ kind: z.literal("relative"), offset: offsetSchema }).strict(),
  z
    .object({
      kind: z.literal("earliest"),
      offsets: z.tuple([offsetSchema, offsetSchema]),
    })
    .strict(),
]);
export type ChecklistDateRule = z.infer<typeof checklistDateRuleSchema>;

export const checklistDateInputSchema = z
  .object({
    key: stepKeySchema,
    value: dateValueSchema.nullable(),
    rule: checklistDateRuleSchema.nullable(),
    notNeeded: z.boolean().optional(),
  })
  .strict();
export type ChecklistDateInput = z.infer<typeof checklistDateInputSchema>;

export const checklistDateEditSchema = z
  .object({
    expectedRevision: revisionSchema,
    change: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("set"),
          target: dateAnchorSchema,
          value: dateValueSchema.nullable(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("extend"),
          key: stepKeySchema,
          amount: z.number().int().positive().max(3650),
          unit: z.enum(["days", "hours"]),
        })
        .strict(),
    ]),
  })
  .strict();
export type ChecklistDateEdit = z.infer<typeof checklistDateEditSchema>;

export const checklistDateApplySchema = checklistDateEditSchema.extend({
  mode: z.enum(["update_all", "only_this_date"]),
  previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ChecklistDateApply = z.infer<typeof checklistDateApplySchema>;
