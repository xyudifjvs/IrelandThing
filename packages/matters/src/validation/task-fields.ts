import { z } from "zod";
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
