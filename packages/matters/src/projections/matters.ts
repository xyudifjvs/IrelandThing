import { type Principal, HttpError } from "@weatherly/platform";
import { z } from "zod";
import { requireMatter, matterScope } from "../access";
import { prisma, Prisma } from "@weatherly/db";
import { deadlineProjection, audienceAllows } from "./deadline-fields";
import { fileReviewPending } from "../file-review";
import { approvedWorkflowTaskDates } from "../rules";
import { projectTaskFields, agentMatterDetails } from "./task-fields";
import { portalCoordinatorEmail } from "./coordinator-contact";
import { canonicalPortalTimeline } from "./canonical-timeline";
import { legacyClientPresentation } from "./client-timeline-layout";
import { documentAudienceWhere } from "./document-audience";
import { peopleAudienceWhere, portalPersonSelect } from "../people/projection";
import {
  portalClientNames,
  portalClientRoles,
  portalClosedDate,
  portalDocument,
} from "./portal-fields";

function portalMatterSummary(matter: Prisma.MatterGetPayload<object>) {
  const {
    id,
    title,
    propertyAddress,
    side,
    stage,
    revision,
    createdAt,
    updatedAt,
  } = matter;
  return {
    id,
    title,
    propertyAddress,
    side,
    stage,
    revision,
    createdAt,
    updatedAt,
  };
}

function legacyAgentTask<
  T extends {
    details: Prisma.JsonValue;
    title: string;
    stepKey?: string | null;
    dueDate?: string | null;
  },
>(task: T, position: number, timeZone?: string | null) {
  const { details: _, ...rest } = task;
  return {
    ...rest,
    ...legacyClientPresentation(task, { side: "seller", timeZone }),
    position,
  };
}

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
  const waitingIntakes =
    actor.role === "coordinator"
      ? await prisma.intakeSubmission.findMany({
          where: { processedAt: null },
          select: { matterId: true },
        })
      : [];
  const rows = await prisma.matter.findMany({
    where: {
      AND: [
        matterScope(actor),
        ...(waitingIntakes.length
          ? [{ id: { notIn: waitingIntakes.map((i) => i.matterId) } }]
          : []),
        query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: "insensitive" } },
                { propertyAddress: { contains: query.q, mode: "insensitive" } },
                ...(actor.role === "agent"
                  ? [
                      {
                        contacts: {
                          some: {
                            ...peopleAudienceWhere("agent"),
                            role: { in: portalClientRoles },
                            name: {
                              contains: query.q,
                              mode: "insensitive" as const,
                            },
                          },
                        },
                      },
                    ]
                  : []),
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
      contacts:
        actor.role === "agent"
          ? {
              where: peopleAudienceWhere("agent"),
              select: portalPersonSelect,
              orderBy: { createdAt: "asc" },
            }
          : false,
    },
  });
  const projected = rows.map((matter) => {
    if (matter.checklistVersion !== null) {
      return {
        ...matter,
        tasks: matter.tasks
          .filter((task) => task.stepKey !== null)
          .map(projectTaskFields),
        deadlines: [],
      };
    }
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
          ...portalMatterSummary(m),
          tasks:
            m.checklistVersion !== null
              ? canonicalPortalTimeline(m.tasks, "client", {
                  timeZone: m.deadlineTimeZone,
                  side: m.side,
                  details: m.details,
                })
              : m.tasks
                  .filter(({ status }) => status !== "not_applicable")
                  .map(({ details, note: _note, ...t }, position) => ({
                    ...t,
                    ...legacyClientPresentation(
                      { ...t, details },
                      { side: m.side, timeZone: m.deadlineTimeZone },
                    ),
                    position,
                  })),
          deadlines: m.deadlines.map(
            ({ details: _, sourceDocumentId: __, ...d }) => d,
          ),
        }))
    : actor.role === "agent"
      ? projected.map((matter) => ({
          ...portalMatterSummary(matter),
          business: matter.business,
          packageCode: matter.packageCode,
          clientNames: fileReviewPending(matter)
            ? []
            : portalClientNames(matter.contacts),
          closedOn: portalClosedDate(matter, matter.tasks, "agent"),
          details:
            matter.checklistVersion !== null
              ? {}
              : agentMatterDetails(matter.details),
          tasks:
            matter.checklistVersion !== null
              ? canonicalPortalTimeline(matter.tasks, "agent", {
                  timeZone: matter.deadlineTimeZone,
                  side: matter.side,
                  details: matter.details,
                })
              : matter.tasks.map((task, index) =>
                  legacyAgentTask(task, index, matter.deadlineTimeZone),
                ),
          deadlines: matter.deadlines.map(
            ({ details: _, sourceDocumentId: __, ...deadline }) => deadline,
          ),
        }))
      : projected;
}

export async function getMatter(actor: Principal, id: string) {
  const v =
    actor.role === "coordinator" ? {} : documentAudienceWhere(actor.role);
  const { matter, ownPendingIntake } = await prisma.$transaction(
    async (tx) => {
      const matter = await tx.matter.findFirst({
        where: { id, ...matterScope(actor) },
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
          contacts:
            actor.role === "coordinator"
              ? { where: { retiredAt: null }, orderBy: { createdAt: "asc" } }
              : {
                  where: peopleAudienceWhere(actor.role),
                  select: portalPersonSelect,
                  orderBy: { createdAt: "asc" },
                },
          participants: {
            where: { revokedAt: null },
            select: { id: true, userId: true, role: true },
          },
        },
      });
      const receipt =
        actor.role === "agent" && matter && fileReviewPending(matter)
          ? await tx.intakeSubmission.findFirst({
              where: { matterId: matter.id, userId: actor.id, deletedAt: null },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              select: { snapshot: true },
            })
          : null;
      const snapshot = receipt?.snapshot;
      const ownPendingIntake =
        snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
          ? snapshot.referenceIntake
          : undefined;
      return { matter, ownPendingIntake };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  if (!matter || (actor.role === "client" && fileReviewPending(matter)))
    throw new HttpError(404, "MATTER_NOT_FOUND", "Matter not found");
  const coordinatorEmail =
    actor.role === "agent" ? await portalCoordinatorEmail(matter) : undefined;
  if (matter.checklistVersion !== null) {
    if (actor.role === "coordinator")
      return {
        ...matter,
        tasks: matter.tasks
          .filter((task) => task.stepKey !== null)
          .map(projectTaskFields),
        deadlines: [],
      };
    const summary = {
      ...portalMatterSummary(matter),
      closedOn: portalClosedDate(matter, matter.tasks, actor.role),
      tasks: canonicalPortalTimeline(matter.tasks, actor.role, {
        timeZone: matter.deadlineTimeZone,
        side: matter.side,
        details: matter.details,
      }),
      deadlines: [],
      notes: [],
      documents: matter.documents
        .filter(
          ({ shareWithClient }) =>
            actor.role !== "client" || shareWithClient === true,
        )
        .map(portalDocument),
      people: matter.contacts.map(({ id, role, name, email, phone }) => ({
        id,
        role,
        name,
        email,
        phone,
      })),
    };
    return actor.role === "agent"
      ? {
          ...summary,
          coordinatorEmail,
          business: matter.business,
          packageCode: matter.packageCode,
          clientNames: portalClientNames(matter.contacts),
          details: {},
          participants: [],
        }
      : summary;
  }
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
      closedOn: portalClosedDate(matter, matter.tasks, "client"),
      tasks: matter.tasks
        .filter(({ status }) => status !== "not_applicable")
        .map((task, position) => {
          const { details, note: _note, ...t } = projectTaskFields(task);
          return {
            ...t,
            ...legacyClientPresentation(
              { ...t, details },
              { side: matter.side, timeZone: matter.deadlineTimeZone },
            ),
            position,
          };
        }),
      deadlines: matter.deadlines
        .filter((d) => d.status === "confirmed")
        .map(({ details: _, sourceDocumentId: __, ...d }) => d),
      notes: [],
      documents: matter.documents
        .filter(({ shareWithClient }) => shareWithClient === true)
        .map(portalDocument),
      people: matter.contacts,
    };
  return actor.role === "agent"
    ? {
        ...portalMatterSummary(matter),
        coordinatorEmail,
        business: matter.business,
        packageCode: matter.packageCode,
        details: agentMatterDetails(matter.details, ownPendingIntake),
        clientNames: fileReviewPending(matter)
          ? []
          : portalClientNames(matter.contacts),
        closedOn: portalClosedDate(matter, matter.tasks, "agent"),
        documents: matter.documents.map(portalDocument),
        people: fileReviewPending(matter) ? [] : matter.contacts,
        notes: [],
        participants: [],
        tasks: matter.tasks.map((task, index) =>
          legacyAgentTask(task, index, matter.deadlineTimeZone),
        ),
        deadlines: matter.deadlines.map(
          ({ details: _, sourceDocumentId: __, ...deadline }) => deadline,
        ),
      }
    : matter;
}
