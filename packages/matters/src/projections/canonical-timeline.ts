import type { Prisma } from "@weatherly/db";
import { audienceAllows } from "./deadline-fields";
import { sharedTaskFields } from "./task-fields";
import {
  selectClientTimeline,
  clientDateLabel,
} from "./client-timeline-layout";

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
  context: {
    timeZone?: string | null;
    side?: string;
    details?: Prisma.JsonValue;
  } = {},
) {
  const source =
    role === "client"
      ? selectClientTimeline(
          tasks.filter((task) => task.stepKey !== null),
          context.side,
        )
      : tasks;
  return source
    .filter(
      (task) =>
        task.stepKey != null &&
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
            stepKey === "final_walkthrough" ||
            stepKey === "inspections" ||
            (context.side === "seller" && stepKey === "appraisal_ordered"));
        const dateLabel = clientDateLabel({ dueDate, details });
        return {
          id,
          stepKey,
          title,
          status,
          dueDate,
          dueAt,
          position,
          ...(dateLabel ? { dateLabel } : {}),
          appointmentTimeZone: context.timeZone || "America/New_York",
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
