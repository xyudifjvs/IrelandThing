import { z } from "zod";
import type { Prisma } from "@weatherly/db";
import { taskVisibility } from "./task-fields";

type Visibility = z.infer<typeof taskVisibility>;
type Audience = "coordinator" | "agent" | "client";
type TaskSource = {
  id: string;
  title: string;
  visibility: string;
  details: Prisma.JsonValue;
};
type DeadlineSource = { label: string; details: Prisma.JsonValue };
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const normalized = (value: unknown) =>
  typeof value === "string"
    ? value.trim().toLowerCase().replace(/\s+/g, " ")
    : "";
export const deadlineDetails = z
  .record(z.string(), z.json())
  .superRefine((details, context) => {
    if (
      Object.hasOwn(details, "visibility") &&
      !taskVisibility.safeParse(details.visibility).success
    )
      context.addIssue({
        code: "custom",
        path: ["visibility"],
        message: "Choose a valid deadline audience.",
      });
  });
export function audienceAllows(visibility: string, audience: Audience) {
  return (
    audience === "coordinator" ||
    visibility === "client" ||
    visibility === audience ||
    (audience === "client" && visibility === "client_only")
  );
}
const scope = (value: unknown): Visibility =>
  taskVisibility.safeParse(value).success
    ? (value as Visibility)
    : "coordinator";
function intersection(left: Visibility, right: Visibility): Visibility {
  const agent = audienceAllows(left, "agent") && audienceAllows(right, "agent");
  const client =
    audienceAllows(left, "client") && audienceAllows(right, "client");
  return agent
    ? client
      ? "client"
      : "agent"
    : client
      ? "client_only"
      : "coordinator";
}
/** Canonical tasks determine linked audiences. An explicit date scope only narrows them. */
function deadlineAudience(
  deadline: DeadlineSource,
  tasks: TaskSource[],
  details: unknown,
) {
  const metadata = record(deadline.details),
    directKey = normalized(metadata.workflowKey);
  const definition = record(record(record(details).workflow).definition);
  const keys = new Set(
    (Array.isArray(definition.steps) ? definition.steps : [])
      .map(record)
      .filter((step) => normalized(step.title) === normalized(deadline.label))
      .map((step) => normalized(step.key))
      .filter(Boolean),
  );
  const matches = tasks.filter((task) =>
    directKey
      ? normalized(record(task.details).workflowKey) === directKey
      : keys.has(normalized(record(task.details).workflowKey)) ||
        normalized(task.title) === normalized(deadline.label),
  );
  const linkedToTask = !!directKey || keys.size > 0 || matches.length > 0;
  // Missing or duplicate associations are not permission to publish a private date.
  const inheritedVisibility =
    matches.length === 1 ? scope(matches[0].visibility) : "coordinator";
  const explicit = Object.hasOwn(metadata, "visibility")
    ? scope(metadata.visibility)
    : "client";
  return {
    visibility: linkedToTask
      ? intersection(explicit, inheritedVisibility)
      : explicit,
    linkedToTask,
    ...(linkedToTask ? { inheritedVisibility } : {}),
    taskIds: matches.map((task) => task.id),
  };
}
export function projectDeadlineFields<T extends DeadlineSource>(
  deadline: T,
  tasks: TaskSource[],
  details: unknown,
) {
  const { taskIds: _, ...audience } = deadlineAudience(
    deadline,
    tasks,
    details,
  );
  return { ...deadline, ...audience };
}
export function deadlineProjection<
  T extends DeadlineSource & { status: string },
>(deadlines: T[], tasks: TaskSource[], details: unknown, audience: Audience) {
  const states = deadlines.map((deadline) => ({
    deadline,
    state: deadlineAudience(deadline, tasks, details),
  }));
  const hiddenTaskIds = new Set(
    states
      .filter(({ state }) => !audienceAllows(state.visibility, audience))
      .flatMap(({ state }) => state.taskIds),
  );
  return {
    deadlines:
      audience === "coordinator"
        ? states.map(({ deadline, state: { taskIds: _, ...state } }) => ({
            ...deadline,
            ...state,
          }))
        : states
            .filter(
              ({ deadline, state }) =>
                deadline.status === "confirmed" &&
                audienceAllows(state.visibility, audience),
            )
            .map(({ deadline }) => deadline),
    // A hidden date must not reappear as the derived dueDate of a shared task.
    task: <U extends TaskSource & { dueDate: string | null }>(task: U): U =>
      audience !== "coordinator" && hiddenTaskIds.has(task.id)
        ? { ...task, dueDate: null }
        : task,
  };
}
