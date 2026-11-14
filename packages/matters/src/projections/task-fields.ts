import type { Prisma } from "@weatherly/db";
import { taskAppointment, taskNote } from "../validation/task-fields";

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
export function agentMatterDetails(
  value: Prisma.JsonValue,
  ownPendingIntake?: Prisma.JsonValue,
): Prisma.JsonValue {
  const fileReview =
    value && typeof value === "object" && !Array.isArray(value)
      ? value.fileReview
      : null;
  const review =
    fileReview && typeof fileReview === "object" && !Array.isArray(fileReview)
      ? {
          status:
            typeof fileReview.status === "string"
              ? fileReview.status
              : "unknown",
        }
      : undefined;
  return {
    ...(ownPendingIntake ? { referenceIntake: ownPendingIntake } : {}),
    ...(review ? { fileReview: review } : {}),
  };
}
