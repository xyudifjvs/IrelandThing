import type { Prisma } from "@weatherly/db";
import { audienceAllows } from "./deadline-fields";
import { sharedTaskFields } from "./task-fields";
import {
  clientChecklistTemplate,
  checklistTemplate,
} from "../checklist/templates";
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
  context: {
    timeZone?: string | null;
    side?: string;
    details?: Prisma.JsonValue;
  } = {},
) {
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  let source = [...tasks];
  if (role === "client" && context.side === "seller") {
    const saved = record(context.details);
    const clientSteps = clientChecklistTemplate("seller", null);
    const titles = new Map(clientSteps.map((step) => [step.key, step.title]));
    const masterTitles = new Map(
      checklistTemplate("seller", null).map((step) => [step.key, step.title]),
    );
    source = source.filter(
      (task) =>
        (task.stepKey && titles.has(task.stepKey)) ||
        task.stepKey?.startsWith("custom_"),
    );
    source = source.map((task) => ({
      ...task,
      title:
        task.stepKey && task.title === masterTitles.get(task.stepKey)
          ? titles.get(task.stepKey) || task.title
          : task.title,
    }));
    const anchor = (
      Array.isArray(saved.checklistDateAnchors)
        ? saved.checklistDateAnchors
        : []
    )
      .map(record)
      .find((node) => node.key === "title_commitment");
    if (anchor && !source.some((task) => task.stepKey === "title_commitment")) {
      const meta = record(saved.clientTitleCommitment),
        due = record(anchor.due);
      source.push({
        id: typeof meta.id === "string" ? meta.id : "client-title-commitment",
        stepKey: "title_commitment",
        title: typeof meta.title === "string" ? meta.title : "Title Commitment",
        visibility:
          typeof meta.visibility === "string" ? meta.visibility : "client",
        status:
          anchor.status === "completed"
            ? "completed"
            : anchor.status === "not_needed"
              ? "not_applicable"
              : "pending",
        dueDate: typeof due.date === "string" ? due.date : null,
        dueAt: typeof due.instant === "string" ? new Date(due.instant) : null,
        dateRule: (anchor.rule ?? null) as Prisma.JsonValue,
        details: {
          dateWording:
            typeof meta.dateWording === "string" ? meta.dateWording : "",
          ...(typeof meta.position === "number"
            ? { clientPosition: meta.position }
            : {}),
        },
      });
    }
    const positions = new Map(
      clientSteps.map((step, index) => [step.key, index]),
    );
    const position = (task: PortalTask) => {
      const saved = record(task.details).clientPosition;
      return typeof saved === "number"
        ? saved
        : (positions.get(task.stepKey || "") ?? clientSteps.length);
    };
    source.sort((left, right) => position(left) - position(right));
  }
  return source
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
