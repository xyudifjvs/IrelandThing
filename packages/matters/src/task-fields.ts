import { z } from "zod";
import type { Prisma } from "@weatherly/db";
export const taskVisibility = z.enum([
  "coordinator",
  "agent",
  "client",
  "client_only",
]);
export const taskNote = z.string().max(1000);
export const taskAppointment = z.iso.datetime({ offset: true }).nullable();
export const taskDetails = z
  .record(z.string(), z.json())
  .superRefine((details, context) => {
    for (const [key, schema] of [
      ["note", taskNote],
      ["appointmentAt", taskAppointment],
    ] as const) {
      if (
        Object.hasOwn(details, key) &&
        !schema.safeParse(details[key]).success
      )
        context.addIssue({
          code: "custom",
          path: [key],
          message:
            key === "note"
              ? "Use a short note of at most 1,000 characters."
              : "Use an ISO appointment time with a timezone, or null.",
        });
    }
  });
/** Only these optional task fields may be projected beside the safe shared record. */
export function sharedTaskFields(details: Prisma.JsonValue) {
  const value =
    details && typeof details === "object" && !Array.isArray(details)
      ? details
      : {};
  const note = taskNote.safeParse(value.note);
  const appointment = taskAppointment.safeParse(value.appointmentAt);
  return {
    ...(note.success ? { note: note.data } : {}),
    ...(appointment.success ? { appointmentAt: appointment.data } : {}),
  };
}
export function projectTaskFields<T extends { details: Prisma.JsonValue }>(
  task: T,
) {
  return { ...task, ...sharedTaskFields(task.details) };
}

/** Source-review/workflow internals are not an alternate route to hidden tasks. */
export function agentMatterDetails(value: Prisma.JsonValue): Prisma.JsonValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const {
    workflow: _workflow,
    sourceConflicts: _conflicts,
    confirmedFacts: _facts,
    fileReview,
    ...details
  } = value;
  const review =
    fileReview && typeof fileReview === "object" && !Array.isArray(fileReview)
      ? {
          status:
            typeof fileReview.status === "string"
              ? fileReview.status
              : "unknown",
        }
      : undefined;
  return { ...details, ...(review ? { fileReview: review } : {}) };
}
