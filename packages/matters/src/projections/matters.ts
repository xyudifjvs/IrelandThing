import { type Principal, HttpError } from "@weatherly/platform";
import { z } from "zod";
import { requireMatter, matterScope } from "../access";
import { prisma } from "@weatherly/db";
import { deadlineProjection, audienceAllows } from "./deadline-fields";
import { fileReviewPending } from "../file-review";
import { approvedWorkflowTaskDates } from "../rules";
import { projectTaskFields, agentMatterDetails } from "./task-fields";

export async function listMatters(
  actor: Principal,
  query: {
    q?: string;
    stage?: string;
    cursor?: string;
    limit?: number;
    order?: "id";
  } = {},
) {
  const limit = z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(200)
    .parse(query.limit);
  if (query.cursor) await requireMatter(actor, query.cursor);
  const waitingIntakes = actor.role === "coordinator" ? await prisma.intakeSubmission.findMany({where:{processedAt:null},select:{matterId:true}}) : [];
  const rows = await prisma.matter.findMany({
    where: {
      AND: [
        matterScope(actor),
        ...(waitingIntakes.length ? [{ id: { notIn: waitingIntakes.map(i => i.matterId) } }] : []),
        query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: "insensitive" } },
                { propertyAddress: { contains: query.q, mode: "insensitive" } },
              ],
            }
          : {},
        query.stage ? { stage: query.stage } : {},
      ],
    },
    // Internal portfolio scans require an immutable ordering. Keep the normal
    // workspace order while allowing a complete scan to survive ordinary edits.
    orderBy:
      query.order === "id"
        ? [{ id: "asc" }]
        : [{ updatedAt: "desc" }, { id: "desc" }],
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    take: limit,
    include: {
      tasks: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      },
      deadlines: true,
    },
  });
  const projected = rows.map((matter) => {
    const dates = deadlineProjection(
      matter.deadlines,
      matter.tasks,
      matter.details,
      actor.role,
    );
    return {
      ...matter,
      tasks:
        actor.role !== "coordinator" && fileReviewPending(matter)
          ? []
          : approvedWorkflowTaskDates(
              matter.tasks,
              matter.deadlines,
              matter.details,
            )
              .filter((task) => audienceAllows(task.visibility, actor.role))
              .map((task) => projectTaskFields(dates.task(task))),
      deadlines:
        actor.role !== "coordinator" && fileReviewPending(matter)
          ? []
          : dates.deadlines,
    };
  });
  return actor.role === "client"
    ? projected
        .filter((m) => !fileReviewPending(m))
        .map((m) => ({
          id: m.id,
          title: m.title,
          propertyAddress: m.propertyAddress,
          side: m.side,
          stage: m.stage,
          revision: m.revision,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
          tasks: m.tasks.map(({ details: _, ...t }, position) => ({
            ...t,
            position,
          })),
          deadlines: m.deadlines.map(
            ({ details: _, sourceDocumentId: __, ...d }) => d,
          ),
        }))
    : actor.role === "agent"
      ? projected.map((matter) => ({
          ...matter,
          details: agentMatterDetails(matter.details),
          tasks: matter.tasks.map(({ details: _, ...task }, position) => ({
            ...task,
            position,
          })),
          deadlines: matter.deadlines.map(
            ({ details: _, sourceDocumentId: __, ...deadline }) => deadline,
          ),
        }))
      : projected;
}

export async function getMatter(actor: Principal, id: string) {
  await requireMatter(actor, id);
  const v =
    actor.role === "coordinator"
      ? {}
      : {
          visibility:
            actor.role === "client" ? "client" : { in: ["agent", "client"] },
        };
  const matter = await prisma.matter.findUniqueOrThrow({
    where: { id },
    include: {
      tasks: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      },
      deadlines: { orderBy: { createdAt: "asc" } },
      notes: {
        where:
          actor.role === "coordinator"
            ? {}
            : {
                visibility:
                  actor.role === "client"
                    ? "client"
                    : { in: ["agent", "client"] },
              },
        orderBy: { createdAt: "desc" },
      },
      documents: { where: v, orderBy: { createdAt: "desc" } },
      participants: {
        where: { revokedAt: null },
        select: { id: true, userId: true, role: true },
      },
    },
  });
  if (actor.role === "client" && fileReviewPending(matter))
    throw new HttpError(404, "MATTER_NOT_FOUND", "Matter not found");
  const dates = deadlineProjection(
    matter.deadlines,
    matter.tasks,
    matter.details,
    actor.role,
  );
  matter.tasks =
    actor.role !== "coordinator" && fileReviewPending(matter)
      ? []
      : approvedWorkflowTaskDates(
          matter.tasks,
          matter.deadlines,
          matter.details,
        )
          .filter((task) => audienceAllows(task.visibility, actor.role))
          .map((task) => projectTaskFields(dates.task(task)));
  matter.deadlines =
    actor.role !== "coordinator" && fileReviewPending(matter)
      ? []
      : dates.deadlines;
  if (actor.role === "client")
    return {
      id: matter.id,
      title: matter.title,
      propertyAddress: matter.propertyAddress,
      side: matter.side,
      stage: matter.stage,
      revision: matter.revision,
      createdAt: matter.createdAt,
      updatedAt: matter.updatedAt,
      tasks: matter.tasks.map((task, position) => {
        const { details: _, ...t } = projectTaskFields(task);
        return {
          ...t,
          position,
        };
      }),
      deadlines: matter.deadlines
        .filter((d) => d.status === "confirmed")
        .map(({ details: _, sourceDocumentId: __, ...d }) => d),
      notes: matter.notes,
      documents: matter.documents,
    };
  return actor.role === "agent"
    ? {
        ...matter,
        details: agentMatterDetails(matter.details),
        tasks: matter.tasks.map(({ details: _, ...task }, position) => ({
          ...task,
          position,
        })),
        deadlines: matter.deadlines.map(
          ({ details: _, sourceDocumentId: __, ...deadline }) => deadline,
        ),
      }
    : matter;
}
