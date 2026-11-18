import type { Prisma } from "@weatherly/db";
import { audienceAllows } from "./deadline-fields";
import { sharedTaskFields } from "./task-fields";
import { checklistDateLabel } from "../checklist/display";

type PortalTask = Pick<
  Prisma.TaskGetPayload<object>,
  | "id"
  | "stepKey"
  | "title"
  | "status"
  | "visibility"
  | "dueDate"
  | "dueAt"
  | "details"
  | "dateRule"
>;

export function canonicalPortalTimeline(
  tasks: readonly PortalTask[],
  role: "agent" | "client",
  context: { timeZone?: string | null } = {},
) {
  return tasks
    .filter(
      (task) =>
        task.stepKey !== null &&
        audienceAllows(task.visibility, role) &&
        (role !== "client" || task.status !== "not_applicable"),
    )
    .map(
      (
        { id, stepKey, title, status, dueDate, dueAt, details, dateRule },
        position,
      ) => {
        const data =
          details && typeof details === "object" && !Array.isArray(details)
            ? details
            : {};
        const { note, appointmentAt } = sharedTaskFields(data);
        const showSchedule =
          data.scheduled === true &&
          (role === "agent" ||
            stepKey === "closing" ||
            stepKey === "final_walkthrough");
        const dateLabel = checklistDateLabel(
          { dueDate, dueAt, details, dateRule },
          stepKey!,
          context.timeZone || "America/New_York",
        );
        return {
          id,
          stepKey,
          title,
          status,
          dueDate,
          dueAt,
          position,
          ...(dateLabel ? { dateLabel } : {}),
          ...(showSchedule
            ? {
                scheduled: true,
                appointmentAt,
                ...(typeof data.appointmentPlace === "string"
                  ? { appointmentPlace: data.appointmentPlace }
                  : {}),
              }
            : {}),
          ...(role === "agent" && data.showNoteToAgent === true && note
            ? { note }
            : {}),
        };
      },
    );
}
