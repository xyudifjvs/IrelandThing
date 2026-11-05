import { fileReviewPending } from "./file-review";
import {
  deadlineDetails,
  deadlineProjection,
  projectDeadlineFields,
  audienceAllows,
} from "./deadline-fields";
export { fileReviewPending } from "./file-review";
import {
  taskVisibility,
  taskNote,
  taskAppointment,
  taskDetails,
  projectTaskFields,
  agentMatterDetails,
} from "./task-fields";
import {
  applyInitialWorkflow,
  recalculateWorkflow,
  approvedWorkflowTaskDates,
} from "./rules";
export * from "./rules";
export * from "./checklist-sharing";
import {
  checklistPrivacyHeaders,
  registerChecklistShareRoutes,
} from "./checklist-sharing";
import { Router } from "express";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import {
  HttpError,
  asyncHandler,
  principal,
  assertCoordinator,
  type Principal,
} from "@weatherly/platform";

export type MatterChangeHook = (
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
) => Promise<void>;
let matterChangeHook: MatterChangeHook | undefined;
export function registerMatterChangeHook(hook?: MatterChangeHook) {
  matterChangeHook = hook;
}
async function matterChanged(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
) {
  if (matterChangeHook) await matterChangeHook(tx, actor, matterId);
}
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const d = new Date(`${value}T12:00:00Z`);
    return (
      Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value
    );
  }, "Use a real calendar date (YYYY-MM-DD)");
export const revision = z.number().int().positive();
const json = z.record(z.string(), z.json());
export const matterInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    propertyAddress: z.string().trim().min(1).max(500),
    side: z.enum(["buyer", "seller"]),
    packageCode: z.enum(["essentials", "complete", "full_listing"]),
    agentId: z.string().min(1).optional(),
    details: json.default({}),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.packageCode === "full_listing" && v.side !== "seller")
      c.addIssue({
        code: "custom",
        path: ["side"],
        message: "Full Listing is for sellers",
      });
  });
const stages = [
  "pending_review",
  "listing",
  "under_contract",
  "closing",
  "closed",
  "terminated",
  "archived",
] as const;
export function matterScope(actor: Principal): Prisma.MatterWhereInput {
  return actor.role === "coordinator"
    ? {}
    : {
        OR: [
          { agentId: actor.id },
          { participants: { some: { userId: actor.id, revokedAt: null } } },
        ],
      };
}
export async function requireMatter(
  actor: Principal,
  id: string,
  write = false,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const matter = await db.matter.findFirst({
    where: { id, ...matterScope(actor) },
  });
  if (!matter) throw new HttpError(404, "MATTER_NOT_FOUND", "Matter not found");
  if (write) {
    assertCoordinator(actor);
    if (db !== prisma) {
      await db.$queryRaw`SELECT "id" FROM "Matter" WHERE "id" = ${id} FOR UPDATE`;
      // A competing writer may have committed while this lock was waiting.
      // Validate the authorized, current row rather than the pre-lock snapshot.
      const current = await db.matter.findFirst({
        where: { id, ...matterScope(actor) },
      });
      if (!current)
        throw new HttpError(404, "MATTER_NOT_FOUND", "Matter not found");
      return current;
    }
  }
  return matter;
}
export async function audit(
  db: Prisma.TransactionClient | typeof prisma,
  actor: Principal,
  action: string,
  entityType: string,
  entityId: string,
  matterId: string | null,
  details: Prisma.InputJsonValue = {},
) {
  await db.auditEvent.create({
    data: {
      actorId: actor.id,
      action,
      entityType,
      entityId,
      matterId,
      details,
    },
  });
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
  const rows = await prisma.matter.findMany({
    where: {
      AND: [
        matterScope(actor),
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
export async function createMatter(actor: Principal, input: unknown) {
  assertCoordinator(actor);
  const data = matterInput.parse(input);
  if (data.packageCode === "full_listing")
    throw new HttpError(
      409,
      "SERVICE_COMING_SOON",
      "Full Listing is coming soon and cannot be created as a new service.",
    );
  return prisma.$transaction(async (tx) => {
    const service = await tx.catalogItem.findUnique({
      where: { code: data.packageCode },
    });
    if (!service?.approved)
      throw new HttpError(
        409,
        "CATALOG_UNAPPROVED",
        "Review the designated service before creating a new file.",
      );
    if (data.agentId) {
      const agent = await tx.user.findFirst({
        where: { id: data.agentId, role: "agent" },
      });
      if (!agent)
        throw new HttpError(422, "INVALID_AGENT", "Assign an existing agent");
    }
    const matter = await tx.matter.create({
      data: {
        ...data,
        stage:
          data.packageCode === "full_listing" ? "listing" : "under_contract",
        details: {
          ...data.details,
          serviceSnapshot: {
            code: service.code,
            name: service.name,
            priceCents: service.priceCents,
            currency: service.currency,
            revision: service.revision,
            dueAtClosing: true,
            noFeeIfTerminatedBeforeClosing: true,
            capturedAt: new Date().toISOString(),
          },
        } as Prisma.InputJsonValue,
      },
    });
    await applyInitialWorkflow(tx, actor, matter.id);
    await audit(tx, actor, "matter.created", "Matter", matter.id, matter.id);
    return tx.matter.findUniqueOrThrow({ where: { id: matter.id } });
  });
}
export async function updateMatter(
  actor: Principal,
  id: string,
  input: unknown,
) {
  assertCoordinator(actor);
  const data = z
    .object({
      expectedRevision: revision,
      title: z.string().min(1).max(200).optional(),
      propertyAddress: z.string().min(1).max(500).optional(),
      stage: z.enum(stages).optional(),
      agentId: z.string().optional(),
      details: json.optional(),
    })
    .strict()
    .parse(input);
  return prisma.$transaction(async (tx) => {
    const old = await requireMatter(actor, id, true, tx);
    const allowed: Record<string, readonly string[]> = {
      pending_review: ["terminated", "archived"],
      listing: ["under_contract", "terminated", "archived"],
      under_contract: ["closing", "terminated", "archived"],
      closing: ["closed", "under_contract", "terminated"],
      closed: ["archived"],
      terminated: ["archived"],
      archived: [],
    };
    if (fileReviewPending(old) && data.stage === "under_contract")
      throw new HttpError(
        409,
        "FILE_REVIEW_REQUIRED",
        "Confirm the initial file review before opening an active timeline.",
      );
    if (
      data.stage &&
      data.stage !== old.stage &&
      !allowed[old.stage]?.includes(data.stage)
    )
      throw new HttpError(
        422,
        "INVALID_STAGE",
        "This lifecycle transition is not allowed",
      );
    if (
      data.agentId &&
      !(await tx.user.findFirst({ where: { id: data.agentId, role: "agent" } }))
    )
      throw new HttpError(422, "INVALID_AGENT", "Assign an existing agent");
    const { expectedRevision, ...patch } = data;
    const priorDetails = json.parse(old.details);
    if (patch.details) {
      if (priorDetails.serviceSnapshot !== undefined)
        patch.details.serviceSnapshot = priorDetails.serviceSnapshot;
      else delete patch.details.serviceSnapshot;
    }
    if (data.stage === "terminated" && old.stage !== "terminated") {
      // Closed files cannot enter this path. Preserve the original lifecycle
      // decision so later archival does not make a canceled checkout payable.
      patch.details = {
        ...priorDetails,
        ...(patch.details || {}),
        termination: {
          beforeClosing: [
            "pending_review",
            "listing",
            "under_contract",
            "closing",
          ].includes(old.stage),
          fromStage: old.stage,
          at: new Date().toISOString(),
          byId: actor.id,
        },
      };
    } else if (patch.details && priorDetails.termination) {
      // Ordinary detail edits retain the recorded termination history.
      patch.details = {
        ...patch.details,
        termination: priorDetails.termination,
      };
    }
    const result = await tx.matter.updateMany({
      where: { id, revision: expectedRevision },
      data: {
        ...patch,
        details: patch.details as Prisma.InputJsonValue | undefined,
        revision: { increment: 1 },
      },
    });
    if (!result.count)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "This matter changed; refresh before saving",
      );
    await audit(tx, actor, "matter.updated", "Matter", id, id, {
      beforeRevision: old.revision,
      changes: patch as Prisma.InputJsonValue,
    });
    await matterChanged(tx, actor, id);
    return tx.matter.findUniqueOrThrow({ where: { id } });
  });
}
const taskInput = z
  .object({
    title: z.string().trim().min(1).max(300),
    kind: z.string().max(80).default("checklist"),
    status: z
      .enum([
        "pending",
        "received",
        "proposed",
        "completed",
        "signed",
        "not_applicable",
      ])
      .default("pending"),
    visibility: taskVisibility.default("agent"),
    dueDate: dateOnly.nullable().optional(),
    note: taskNote.optional(),
    appointmentAt: taskAppointment.optional(),
    details: taskDetails.default({}),
  })
  .strict();
const deadlineInput = z
  .object({
    label: z.string().trim().min(1).max(200),
    date: dateOnly.nullable().optional(),
    status: z
      .enum(["unknown", "proposed", "confirmed", "rejected"])
      .default("unknown"),
    sourceDocumentId: z.string().nullable().optional(),
    visibility: taskVisibility.optional(),
    details: deadlineDetails.default({}),
  })
  .strict();
const noteInput = z
  .object({
    body: z.string().trim().min(1).max(30000),
    visibility: z
      .enum(["coordinator", "agent", "client"])
      .default("coordinator"),
  })
  .strict();
export async function addTask(
  actor: Principal,
  matterId: string,
  input: unknown,
) {
  assertCoordinator(actor);
  const { note, appointmentAt, ...data } = taskInput.parse(input);
  return prisma.$transaction(async (tx) => {
    await requireMatter(actor, matterId, true, tx);
    const last = await tx.task.aggregate({
      where: { matterId },
      _max: { position: true },
    });
    const row = await tx.task.create({
      data: {
        ...data,
        matterId,
        position: (last._max.position ?? -1) + 1,
        details: {
          ...data.details,
          ...(note !== undefined ? { note } : {}),
          ...(appointmentAt !== undefined ? { appointmentAt } : {}),
        } as Prisma.InputJsonValue,
      },
    });
    await audit(tx, actor, "task.created", "Task", row.id, matterId);
    await tx.matter.update({
      where: { id: matterId },
      data: { revision: { increment: 1 } },
    });
    await matterChanged(tx, actor, matterId);
    return projectTaskFields(row);
  });
}
export async function addDeadline(
  actor: Principal,
  matterId: string,
  input: unknown,
) {
  const { visibility, details, ...data } = deadlineInput.parse(input);
  return prisma.$transaction(async (tx) => {
    const matter = await requireMatter(actor, matterId, true, tx);
    if (
      data.sourceDocumentId &&
      !(await tx.document.findFirst({
        where: { id: data.sourceDocumentId, matterId },
      }))
    )
      throw new HttpError(
        422,
        "INVALID_SOURCE",
        "Document must belong to this matter",
      );
    const row = await tx.deadline.create({
      data: {
        ...data,
        matterId,
        details: {
          ...details,
          visibility: visibility ?? details.visibility ?? "coordinator",
        } as Prisma.InputJsonValue,
      },
    });
    await audit(tx, actor, "deadline.created", "Deadline", row.id, matterId, {
      value: {
        ...data,
        visibility: visibility ?? details.visibility ?? "coordinator",
      } as Prisma.InputJsonValue,
    });
    await tx.matter.update({
      where: { id: matterId },
      data: { revision: { increment: 1 } },
    });
    await recalculateWorkflow(tx, actor, matterId);
    await matterChanged(tx, actor, matterId);
    return projectDeadlineFields(
      row,
      await tx.task.findMany({ where: { matterId } }),
      matter.details,
    );
  });
}
export async function addNote(
  actor: Principal,
  matterId: string,
  input: unknown,
) {
  const data = noteInput.parse(input);
  return prisma.$transaction(async (tx) => {
    await requireMatter(actor, matterId, true, tx);
    const row = await tx.note.create({
      data: { ...data, matterId, authorId: actor.id },
    });
    await audit(tx, actor, "note.created", "Note", row.id, matterId);
    return row;
  });
}
async function resolveDateFollowup(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
  deadlineId: string,
) {
  const deadline = await tx.deadline.findUnique({ where: { id: deadlineId } });
  if (!deadline || deadline.status !== "confirmed" || !deadline.date) return;
  const done = await tx.task.updateMany({
    where: {
      matterId,
      kind: "unresolved_date",
      details: { path: ["deadlineId"], equals: deadlineId },
      status: { not: "completed" },
    },
    data: { status: "completed", revision: { increment: 1 } },
  });
  const matter = await tx.matter.findUniqueOrThrow({ where: { id: matterId } });
  const details =
    matter.details &&
    typeof matter.details === "object" &&
    !Array.isArray(matter.details)
      ? matter.details
      : {};
  const fileReview =
    details.fileReview &&
    typeof details.fileReview === "object" &&
    !Array.isArray(details.fileReview)
      ? details.fileReview
      : {};
  if (Array.isArray(fileReview.unresolvedDates))
    await tx.matter.update({
      where: { id: matterId },
      data: {
        details: {
          ...details,
          fileReview: {
            ...fileReview,
            unresolvedDates: fileReview.unresolvedDates.filter(
              (item) =>
                !(
                  item &&
                  typeof item === "object" &&
                  !Array.isArray(item) &&
                  item.deadlineId === deadlineId
                ),
            ),
          },
        },
      },
    });
  if (done.count)
    await audit(
      tx,
      actor,
      "deadline.unresolved_followup_resolved",
      "Deadline",
      deadlineId,
      matterId,
      { date: deadline.date, taskCount: done.count },
    );
}

async function updateChild(
  actor: Principal,
  matterId: string,
  id: string,
  kind: "task" | "deadline" | "note",
  input: unknown,
  remove = false,
) {
  assertCoordinator(actor);
  const schema =
    kind === "task"
      ? z
          .object({
            title: z.string().trim().min(1).max(300).optional(),
            kind: z.string().max(80).optional(),
            status: z
              .enum([
                "pending",
                "received",
                "proposed",
                "completed",
                "signed",
                "not_applicable",
              ])
              .optional(),
            visibility: taskVisibility.optional(),
            dueDate: dateOnly.nullable().optional(),
            note: taskNote.optional(),
            appointmentAt: taskAppointment.optional(),
            position: z.number().int().min(0).max(1000000).optional(),
            details: taskDetails.optional(),
          })
          .strict()
      : kind === "deadline"
        ? z
            .object({
              label: z.string().trim().min(1).max(200).optional(),
              date: dateOnly.nullable().optional(),
              status: z
                .enum(["unknown", "proposed", "confirmed", "rejected"])
                .optional(),
              sourceDocumentId: z.string().nullable().optional(),
              visibility: taskVisibility.optional(),
              details: deadlineDetails.optional(),
            })
            .strict()
        : z
            .object({
              body: z.string().trim().min(1).max(30000).optional(),
              visibility: z.enum(["coordinator", "agent", "client"]).optional(),
            })
            .strict();
  const { expectedRevision, ...data } = schema
    .extend({ expectedRevision: revision })
    .parse(input);
  return prisma.$transaction(async (tx) => {
    await requireMatter(actor, matterId, true, tx);
    if (
      kind === "deadline" &&
      "sourceDocumentId" in data &&
      data.sourceDocumentId &&
      !(await tx.document.findFirst({
        where: { id: String(data.sourceDocumentId), matterId },
      }))
    )
      throw new HttpError(
        422,
        "INVALID_SOURCE",
        "Document must belong to this matter",
      );
    // Preserve full prior values in audit before a deadline correction or deletion.
    const delegate = tx[kind] as typeof tx.task;
    const old = await delegate.findFirst({ where: { id, matterId } });
    if (!old) throw new HttpError(404, "NOT_FOUND", "Record not found");
    if (remove) {
      const changed = await delegate.deleteMany({
        where: { id, matterId, revision: expectedRevision },
      });
      if (!changed.count)
        throw new HttpError(
          409,
          "REVISION_CONFLICT",
          "Record changed; refresh",
        );
      await audit(tx, actor, `${kind}.deleted`, kind, id, matterId, {
        before: JSON.parse(JSON.stringify(old)),
      });
      if (kind === "deadline" || kind === "task") {
        await tx.matter.update({
          where: { id: matterId },
          data: { revision: { increment: 1 } },
        });
        if (kind === "deadline") await recalculateWorkflow(tx, actor, matterId);
        await matterChanged(tx, actor, matterId);
      }
      return { deleted: true };
    }
    const patch: Record<string, unknown> = { ...data };
    if (kind === "task" && ("note" in data || "appointmentAt" in data)) {
      const previous =
        old.details &&
        typeof old.details === "object" &&
        !Array.isArray(old.details)
          ? old.details
          : {};
      patch.details = {
        ...previous,
        ...("details" in data ? data.details : {}),
        ...("note" in data ? { note: data.note } : {}),
        ...("appointmentAt" in data
          ? { appointmentAt: data.appointmentAt }
          : {}),
      };
      delete patch.note;
      delete patch.appointmentAt;
    }
    if (kind === "task" && "position" in data) {
      if (old.revision !== expectedRevision)
        throw new HttpError(
          409,
          "REVISION_CONFLICT",
          "Record changed; refresh",
        );
      const tasks = await tx.task.findMany({
        where: { matterId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      });
      const ordered = tasks.filter((task) => task.id !== id);
      ordered.splice(Math.min(Number(data.position), ordered.length), 0, old);
      for (const [position, task] of ordered.entries()) {
        if (task.id === id) patch.position = position;
        else if (task.position !== position)
          await tx.task.update({
            where: { id: task.id },
            data: { position, revision: { increment: 1 } },
          });
      }
    }
    if (
      kind === "deadline" &&
      ("date" in data || "visibility" in data || "details" in data)
    ) {
      patch.details = {
        ...(old.details &&
        typeof old.details === "object" &&
        !Array.isArray(old.details)
          ? old.details
          : {}),
        ...("details" in data ? data.details : {}),
        ...("visibility" in data ? { visibility: data.visibility } : {}),
        ...("date" in data ? { manualOverride: true } : {}),
      };
      delete patch.visibility;
    }
    const changed = await delegate.updateMany({
      where: { id, matterId, revision: expectedRevision },
      data: {
        ...patch,
        revision: { increment: 1 },
      } as Prisma.TaskUpdateManyMutationInput,
    });
    if (!changed.count)
      throw new HttpError(409, "REVISION_CONFLICT", "Record changed; refresh");
    await audit(tx, actor, `${kind}.updated`, kind, id, matterId, {
      before: JSON.parse(JSON.stringify(old)),
      changes: data as Prisma.InputJsonValue,
    });
    if (kind === "deadline" || kind === "task") {
      await tx.matter.update({
        where: { id: matterId },
        data: { revision: { increment: 1 } },
      });
      if (kind === "deadline") {
        await recalculateWorkflow(tx, actor, matterId);
        await resolveDateFollowup(tx, actor, matterId, id);
      }
      await matterChanged(tx, actor, matterId);
    }
    const updated = await delegate.findUniqueOrThrow({ where: { id } });
    if (kind === "deadline")
      return projectDeadlineFields(
        await tx.deadline.findUniqueOrThrow({ where: { id } }),
        await tx.task.findMany({ where: { matterId } }),
        (await tx.matter.findUniqueOrThrow({ where: { id: matterId } }))
          .details,
      );
    return kind === "task" ? projectTaskFields(updated) : updated;
  });
}
/** Reorder the complete canonical task set without overwriting a concurrent edit. */
export async function reorderTasks(
  actor: Principal,
  matterId: string,
  input: unknown,
) {
  assertCoordinator(actor);
  const data = z
    .object({
      expectedRevision: revision,
      taskIds: z.array(z.string().min(1)).max(10000),
    })
    .strict()
    .parse(input);
  return prisma.$transaction(async (tx) => {
    await requireMatter(actor, matterId, true, tx);
    const tasks = await tx.task.findMany({ where: { matterId } });
    const ids = new Set(data.taskIds);
    if (
      ids.size !== data.taskIds.length ||
      ids.size !== tasks.length ||
      tasks.some((task) => !ids.has(task.id))
    )
      throw new HttpError(
        422,
        "INVALID_TASK_ORDER",
        "Include every task from this matter exactly once.",
      );
    const claimed = await tx.matter.updateMany({
      where: { id: matterId, revision: data.expectedRevision },
      data: { revision: { increment: 1 } },
    });
    if (!claimed.count)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "This matter changed; refresh before reordering.",
      );
    const byId = new Map(tasks.map((task) => [task.id, task]));
    for (const [position, id] of data.taskIds.entries()) {
      if (byId.get(id)!.position !== position)
        await tx.task.update({
          where: { id },
          data: { position, revision: { increment: 1 } },
        });
    }
    await audit(tx, actor, "task.reordered", "Matter", matterId, matterId, {
      taskIds: data.taskIds,
      beforeRevision: data.expectedRevision,
    });
    await matterChanged(tx, actor, matterId);
    return tx.matter.findUniqueOrThrow({
      where: { id: matterId },
      select: { id: true, revision: true },
    });
  });
}

type UnresolvedAcknowledgement = {
  proposalId?: string;
  deadlineId?: string;
  label: string;
};
async function pendingFileReview(
  tx: Prisma.TransactionClient,
  matter: Awaited<ReturnType<typeof requireMatter>>,
) {
  const proposals = await tx.aIProposal.findMany({
    where: {
      matterId: matter.id,
      kind: "contract",
      status: { in: ["queued", "processing", "pending", "resolved"] },
    },
  });
  const dates = await tx.deadline.findMany({
    where: { matterId: matter.id, status: { in: ["unknown", "proposed"] } },
  });
  const acknowledgements: UnresolvedAcknowledgement[] = dates.map((date) => ({
    deadlineId: date.id,
    label: date.label,
  }));
  for (const proposal of proposals.filter(
    (p) => p.status === "pending" || p.status === "resolved",
  )) {
    const result = proposal.result as {
      deadlines?: { label?: string; date?: unknown }[];
      timingRules?: { label?: string }[];
      conflicts?: { kind?: string; field?: string }[];
    };
    const labels = new Set(
      [
        // An applicable finding with no proposed date still needs an explicit
        // unresolved disposition and follow-up before the file is published.
        ...(result.deadlines || []).map((d) => d.label),
        ...(result.timingRules || []).map((rule) => rule.label),
      ].filter((label): label is string => !!label),
    );
    const resolvedLabels =
      proposal.status === "resolved"
        ? new Set(
            (result.conflicts || [])
              .filter((conflict) => conflict.kind === "deadline")
              .map((conflict) => conflict.field),
          )
        : new Set<string>();
    for (const label of labels)
      if (!resolvedLabels.has(label))
        acknowledgements.push({ proposalId: proposal.id, label });
  }
  const details =
    matter.details &&
    typeof matter.details === "object" &&
    !Array.isArray(matter.details)
      ? matter.details
      : {};
  const conflicts = Array.isArray(details.sourceConflicts)
    ? details.sourceConflicts
    : [];
  const processing = proposals
    .filter((p) => p.status === "queued" || p.status === "processing")
    .map((p) => p.id);
  return {
    matterId: matter.id,
    expectedRevision: matter.revision,
    pending: fileReviewPending(matter),
    acknowledgements,
    blockers: [
      ...(conflicts.length
        ? [
            {
              code: "SOURCE_CONFLICT_REVIEW_REQUIRED",
              message:
                "Choose or correct source conflicts before confirming the file.",
            },
          ]
        : []),
      ...(processing.length
        ? [
            {
              code: "DATE_REVIEW_PROCESSING",
              message:
                "Wait for source extraction to finish before confirming the file.",
              proposalIds: processing,
            },
          ]
        : []),
    ],
  };
}
export async function getFileReview(actor: Principal, matterId: string) {
  assertCoordinator(actor);
  return prisma.$transaction(async (tx) =>
    pendingFileReview(tx, await requireMatter(actor, matterId, false, tx)),
  );
}
/** Ireland may retain an explicitly acknowledged date as unresolved; never invent one. */
export async function confirmFile(
  actor: Principal,
  matterId: string,
  input: unknown,
) {
  assertCoordinator(actor);
  const data = z
    .object({
      expectedRevision: revision,
      acknowledgedUnresolved: z
        .array(
          z
            .object({
              proposalId: z.string().optional(),
              deadlineId: z.string().optional(),
              label: z.string().min(1).max(200),
              reason: z.string().min(1).max(1000),
            })
            .strict(),
        )
        .max(200)
        .default([]),
    })
    .strict()
    .parse(input);
  return prisma.$transaction(async (tx) => {
    const matter = await requireMatter(actor, matterId, true, tx);
    if (!fileReviewPending(matter) || matter.stage !== "pending_review")
      throw new HttpError(
        409,
        "FILE_ALREADY_CONFIRMED",
        "This file is not awaiting initial review.",
      );
    const state = await pendingFileReview(tx, matter);
    if (state.blockers.length)
      throw new HttpError(
        409,
        state.blockers[0].code,
        state.blockers[0].message,
      );
    const matches = (
      expected: UnresolvedAcknowledgement,
      supplied: (typeof data.acknowledgedUnresolved)[number],
    ) =>
      expected.label === supplied.label &&
      expected.proposalId === supplied.proposalId &&
      expected.deadlineId === supplied.deadlineId;
    if (
      state.acknowledgements.some(
        (expected) =>
          !data.acknowledgedUnresolved.some((supplied) =>
            matches(expected, supplied),
          ),
      )
    )
      throw new HttpError(
        409,
        "DATE_REVIEW_REQUIRED",
        "Approve the remaining dates or explicitly acknowledge each unresolved date with a reason.",
      );
    if (
      data.acknowledgedUnresolved.some(
        (supplied) =>
          !state.acknowledgements.some((expected) =>
            matches(expected, supplied),
          ),
      )
    )
      throw new HttpError(
        422,
        "INVALID_UNRESOLVED_ACKNOWLEDGEMENT",
        "Acknowledge only unresolved dates returned by the current file review.",
      );
    const details =
      matter.details &&
      typeof matter.details === "object" &&
      !Array.isArray(matter.details)
        ? matter.details
        : {};
    const unresolved: ((typeof data.acknowledgedUnresolved)[number] & {
      deadlineId: string;
    })[] = [];
    for (const acknowledgement of data.acknowledgedUnresolved) {
      const existing = acknowledgement.deadlineId
        ? await tx.deadline.findFirst({
            where: { id: acknowledgement.deadlineId, matterId },
          })
        : await tx.deadline.findFirst({
            where: { matterId, label: acknowledgement.label },
          });
      const previous =
        existing?.details &&
        typeof existing.details === "object" &&
        !Array.isArray(existing.details)
          ? existing.details
          : {};
      const evidence = {
        ...previous,
        visibility: previous.visibility ?? "coordinator",
        ...(existing
          ? {
              unresolvedPriorDate: existing.date,
              unresolvedPriorStatus: existing.status,
            }
          : {}),
        fileReviewUnresolved: true,
        reason: acknowledgement.reason,
        ...(acknowledgement.proposalId
          ? { sourceProposalId: acknowledgement.proposalId }
          : {}),
        acknowledgedById: actor.id,
        acknowledgedAt: new Date().toISOString(),
        manualOverride: true,
      };
      const date = existing
        ? await tx.deadline.update({
            where: { id: existing.id },
            data: {
              date: null,
              status: "unknown",
              details: evidence,
              revision: { increment: 1 },
            },
          })
        : await tx.deadline.create({
            data: {
              matterId,
              label: acknowledgement.label,
              date: null,
              status: "unknown",
              details: evidence,
            },
          });
      await audit(
        tx,
        actor,
        "deadline.initial_review_left_unresolved",
        "Deadline",
        date.id,
        matterId,
        {
          before: existing ? JSON.parse(JSON.stringify(existing)) : null,
          acknowledgement,
        },
      );
      if (!unresolved.some((item) => item.deadlineId === date.id)) {
        unresolved.push({ ...acknowledgement, deadlineId: date.id });
        await tx.task.create({
          data: {
            matterId,
            title: "Resolve date: " + acknowledgement.label,
            kind: "unresolved_date",
            visibility: "coordinator",
            details: {
              deadlineId: date.id,
              reason: acknowledgement.reason,
              ...(acknowledgement.proposalId
                ? { sourceProposalId: acknowledgement.proposalId }
                : {}),
            },
          },
        });
      }
    }
    const proposalIds = [
      ...new Set(
        data.acknowledgedUnresolved.flatMap((item) =>
          item.proposalId ? [item.proposalId] : [],
        ),
      ),
    ];
    for (const proposalId of proposalIds) {
      const proposal = await tx.aIProposal.findUniqueOrThrow({
        where: { id: proposalId },
      });
      await tx.aIProposal.update({
        where: { id: proposalId },
        data: {
          status: "acknowledged_unresolved",
          reviewedById: actor.id,
          reviewedAt: new Date(),
          result: {
            ...(proposal.result as Record<string, Prisma.InputJsonValue>),
            acknowledgedUnresolved: data.acknowledgedUnresolved.filter(
              (item) => item.proposalId === proposalId,
            ),
          },
        },
      });
    }
    const fileReview =
      details.fileReview &&
      typeof details.fileReview === "object" &&
      !Array.isArray(details.fileReview)
        ? details.fileReview
        : {};
    const changed = await tx.matter.updateMany({
      where: { id: matterId, revision: data.expectedRevision },
      data: {
        stage: "under_contract",
        details: {
          ...details,
          fileReview: {
            ...fileReview,
            status: "confirmed",
            reviewedById: actor.id,
            reviewedAt: new Date().toISOString(),
            unresolvedDates: unresolved,
          },
        },
        revision: { increment: 1 },
      },
    });
    if (!changed.count)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "The file changed. Review its current version before confirming.",
      );
    await applyInitialWorkflow(tx, actor, matterId);
    await tx.task.updateMany({
      where: { matterId, kind: "manual_review" },
      data: { status: "completed", revision: { increment: 1 } },
    });
    await audit(
      tx,
      actor,
      "matter.initial_file_confirmed",
      "Matter",
      matterId,
      matterId,
      {
        beforeRevision: matter.revision,
        acknowledgedUnresolved: data.acknowledgedUnresolved,
      },
    );
    await matterChanged(tx, actor, matterId);
    return tx.matter.findUniqueOrThrow({
      where: { id: matterId },
      include: { tasks: true, deadlines: true },
    });
  });
}

export function createMattersRouter() {
  const router = Router();
  router.use(checklistPrivacyHeaders);
  router.get(
    "/:id/file-review",
    asyncHandler(async (req, res) =>
      res.json(await getFileReview(principal(req), String(req.params.id))),
    ),
  );
  router.post(
    "/:id/confirm-file",
    asyncHandler(async (req, res) =>
      res.json(
        await confirmFile(principal(req), String(req.params.id), req.body),
      ),
    ),
  );
  registerChecklistShareRoutes(router);
  router.post(
    "/:id/tasks/reorder",
    asyncHandler(async (req, res) => {
      res.json(
        await reorderTasks(principal(req), String(req.params.id), req.body),
      );
    }),
  );
  router.get(
    "/",
    asyncHandler(async (req, res) =>
      res.json(
        await listMatters(principal(req), {
          q: typeof req.query.q === "string" ? req.query.q : undefined,
          cursor:
            typeof req.query.cursor === "string" ? req.query.cursor : undefined,
          limit:
            req.query.limit === undefined ? undefined : Number(req.query.limit),
          stage:
            typeof req.query.stage === "string" ? req.query.stage : undefined,
        }),
      ),
    ),
  );
  router.post(
    "/",
    asyncHandler(async (req, res) =>
      res.status(201).json(await createMatter(principal(req), req.body)),
    ),
  );
  router.get(
    "/:id",
    asyncHandler(async (req, res) =>
      res.json(await getMatter(principal(req), String(req.params.id))),
    ),
  );
  router.patch(
    "/:id",
    asyncHandler(async (req, res) =>
      res.json(
        await updateMatter(principal(req), String(req.params.id), req.body),
      ),
    ),
  );
  for (const kind of ["tasks", "deadlines", "notes"] as const) {
    const one =
      kind === "tasks" ? "task" : kind === "notes" ? "note" : "deadline";
    router.post(
      `/:id/${kind}`,
      asyncHandler(async (req, res) =>
        res
          .status(201)
          .json(
            await (
              one === "task" ? addTask : one === "note" ? addNote : addDeadline
            )(principal(req), String(req.params.id), req.body),
          ),
      ),
    );
    router.patch(
      `/:id/${kind}/:childId`,
      asyncHandler(async (req, res) =>
        res.json(
          await updateChild(
            principal(req),
            String(req.params.id),
            String(req.params.childId),
            one,
            req.body,
          ),
        ),
      ),
    );
    router.delete(
      `/:id/${kind}/:childId`,
      asyncHandler(async (req, res) =>
        res.json(
          await updateChild(
            principal(req),
            String(req.params.id),
            String(req.params.childId),
            one,
            req.body,
            true,
          ),
        ),
      ),
    );
  }
  router.post(
    "/:id/participants",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      assertCoordinator(actor);
      const data = z
        .object({ userId: z.string(), role: z.enum(["agent", "client"]) })
        .strict()
        .parse(req.body);
      res.status(201).json(
        await prisma.$transaction(async (tx) => {
          await requireMatter(actor, String(req.params.id), true, tx);
          if (
            !(await tx.user.findFirst({
              where: { id: data.userId, role: data.role },
            }))
          )
            throw new HttpError(
              422,
              "INVALID_PARTICIPANT",
              "User role does not match",
            );
          const row = await tx.matterParticipant.upsert({
            where: {
              matterId_userId: {
                matterId: String(req.params.id),
                userId: data.userId,
              },
            },
            create: { ...data, matterId: String(req.params.id) },
            update: { role: data.role, revokedAt: null },
          });
          await audit(
            tx,
            actor,
            "participant.granted",
            "MatterParticipant",
            row.id,
            row.matterId,
          );
          return row;
        }),
      );
    }),
  );
  router.delete(
    "/:id/participants/:participantId",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      assertCoordinator(actor);
      await prisma.$transaction(async (tx) => {
        await requireMatter(actor, String(req.params.id), true, tx);
        const changed = await tx.matterParticipant.updateMany({
          where: {
            id: String(req.params.participantId),
            matterId: String(req.params.id),
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
        if (!changed.count)
          throw new HttpError(404, "NOT_FOUND", "Participant not found");
        await audit(
          tx,
          actor,
          "participant.revoked",
          "MatterParticipant",
          String(req.params.participantId),
          String(req.params.id),
        );
      });
      res.json({ revoked: true });
    }),
  );
  router.get(
    "/:id/activity",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      await requireMatter(actor, String(req.params.id));
      assertCoordinator(actor);
      res.json(
        await prisma.auditEvent.findMany({
          where: { matterId: String(req.params.id) },
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
      );
    }),
  );
  return router;
}

/** Applies an explicitly reviewed proposal. Every confirmed date retains its evidence and prior value. */
export async function applyReviewedFacts(
  actor: Principal,
  matterId: string,
  input: unknown,
  transaction?: Prisma.TransactionClient,
) {
  assertCoordinator(actor);
  const data = z
    .object({
      expectedRevision: revision,
      deadlines: z
        .array(
          z
            .object({
              label: z.string().min(1).max(200),
              date: dateOnly,
              sourceDocumentId: z.string().min(1),
              sourceQuote: z.string().min(1).max(5000),
              overrideManual: z.boolean().default(false),
            })
            .strict(),
        )
        .max(80)
        .default([]),
      facts: z.record(z.string().max(100), z.json()).optional(),
      reason: z
        .string()
        .min(1)
        .max(1000)
        .default("Coordinator accepted reviewed extraction"),
    })
    .strict()
    .parse(input);
  const apply = async (tx: Prisma.TransactionClient) => {
    const matter = await requireMatter(actor, matterId, true, tx);
    const labels = data.deadlines.map((deadline) =>
      deadline.label.replace(/\s+/g, " ").trim().toLowerCase(),
    );
    const selectedDates = new Map<string, string>();
    for (const [index, label] of labels.entries()) {
      if (
        selectedDates.has(label) &&
        selectedDates.get(label) !== data.deadlines[index].date
      )
        throw new HttpError(
          422,
          "SOURCE_CONFLICT_REVIEW_REQUIRED",
          "Choose one value per deadline; conflicting source dates cannot be applied together.",
        );
      selectedDates.set(label, data.deadlines[index].date);
    }
    const currentDetails =
      matter.details &&
      typeof matter.details === "object" &&
      !Array.isArray(matter.details)
        ? matter.details
        : {};
    const markers = Array.isArray(currentDetails.sourceConflicts)
      ? currentDetails.sourceConflicts
      : [];
    if (
      markers.some(
        (marker) =>
          marker &&
          typeof marker === "object" &&
          !Array.isArray(marker) &&
          ((marker.kind === "fact" &&
            typeof marker.field === "string" &&
            data.facts &&
            Object.hasOwn(data.facts, marker.field)) ||
            (marker.kind === "deadline" &&
              typeof marker.label === "string" &&
              labels.includes(
                marker.label.replace(/\s+/g, " ").trim().toLowerCase(),
              ))),
      )
    )
      throw new HttpError(
        409,
        "SOURCE_CONFLICT_REVIEW_REQUIRED",
        "Resolve the flagged source conflict before applying an authoritative value.",
      );
    const changed = await tx.matter.updateMany({
      where: { id: matterId, revision: data.expectedRevision },
      data: { revision: { increment: 1 } },
    });
    if (!changed.count)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "Matter changed since extraction; review the current record",
      );
    const approvedDeadlineIds = new Set<string>();
    for (const proposed of data.deadlines) {
      const doc = await tx.document.findFirst({
        where: { id: proposed.sourceDocumentId, matterId },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
      if (!doc)
        throw new HttpError(
          422,
          "INVALID_SOURCE",
          "Extraction evidence must belong to this matter",
        );
      const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
      if (
        !doc.versions[0]?.extractedText ||
        !normalize(doc.versions[0].extractedText).includes(
          normalize(proposed.sourceQuote),
        )
      )
        throw new HttpError(
          422,
          "SOURCE_QUOTE_MISMATCH",
          "Evidence quote must match the stored document text",
        );
      const previous = await tx.deadline.findFirst({
        where: { matterId, label: proposed.label },
        orderBy: { createdAt: "desc" },
      });
      const previousDetails =
        previous?.details &&
        typeof previous.details === "object" &&
        !Array.isArray(previous.details)
          ? (previous.details as Record<string, Prisma.JsonValue>)
          : {};
      if (previousDetails.manualOverride === true && !proposed.overrideManual)
        throw new HttpError(
          409,
          "MANUAL_OVERRIDE",
          "A reviewed deadline has a manual override; explicitly approve replacing it",
        );
      const details = {
        ...previousDetails,
        sourceQuote: proposed.sourceQuote,
        sourceVersionId: doc.versions[0].id,
        reviewedById: actor.id,
        reviewedAt: new Date().toISOString(),
        reason: data.reason,
        manualOverride: false,
      };
      let deadline;
      if (previous) {
        const result = await tx.deadline.updateMany({
          where: { id: previous.id, revision: previous.revision },
          data: {
            date: proposed.date,
            status: "confirmed",
            sourceDocumentId: doc.id,
            details,
            revision: { increment: 1 },
          },
        });
        if (!result.count)
          throw new HttpError(
            409,
            "REVISION_CONFLICT",
            "Deadline changed during review; refresh before applying",
          );
        deadline = await tx.deadline.findUniqueOrThrow({
          where: { id: previous.id },
        });
      } else {
        deadline = await tx.deadline.create({
          data: {
            matterId,
            label: proposed.label,
            date: proposed.date,
            status: "confirmed",
            sourceDocumentId: doc.id,
            details: { ...details, visibility: "coordinator" },
          },
        });
      }
      approvedDeadlineIds.add(deadline.id);
      await audit(
        tx,
        actor,
        "deadline.extraction_confirmed",
        "Deadline",
        deadline.id,
        matterId,
        {
          before: previous ? JSON.parse(JSON.stringify(previous)) : null,
          after: JSON.parse(JSON.stringify(deadline)),
          reason: data.reason,
        },
      );
    }
    await recalculateWorkflow(tx, actor, matterId, { approvedDeadlineIds });
    for (const deadlineId of approvedDeadlineIds)
      await resolveDateFollowup(tx, actor, matterId, deadlineId);
    await matterChanged(tx, actor, matterId);
    if (data.facts) {
      const latest = await tx.matter.findUniqueOrThrow({
        where: { id: matterId },
      });
      const previous =
        latest.details &&
        typeof latest.details === "object" &&
        !Array.isArray(latest.details)
          ? latest.details
          : {};
      await tx.matter.update({
        where: { id: matterId },
        data: {
          details: {
            ...previous,
            confirmedFacts: {
              ...(previous.confirmedFacts &&
              typeof previous.confirmedFacts === "object" &&
              !Array.isArray(previous.confirmedFacts)
                ? previous.confirmedFacts
                : {}),
              ...data.facts,
            },
          },
        },
      });
    }
    await audit(
      tx,
      actor,
      "matter.reviewed_facts_applied",
      "Matter",
      matterId,
      matterId,
      {
        beforeRevision: matter.revision,
        reason: data.reason,
        facts: data.facts || {},
      },
    );
    return tx.matter.findUniqueOrThrow({
      where: { id: matterId },
      include: { deadlines: true },
    });
  };
  return transaction ? apply(transaction) : prisma.$transaction(apply);
}

export const updateTask = (
  actor: Principal,
  matterId: string,
  id: string,
  input: unknown,
) => updateChild(actor, matterId, id, "task", input);
export const updateDeadline = (
  actor: Principal,
  matterId: string,
  id: string,
  input: unknown,
) => updateChild(actor, matterId, id, "deadline", input);
export const updateNote = (
  actor: Principal,
  matterId: string,
  id: string,
  input: unknown,
) => updateChild(actor, matterId, id, "note", input);
export const deleteTask = (
  actor: Principal,
  matterId: string,
  id: string,
  input: unknown,
) => updateChild(actor, matterId, id, "task", input, true);
export const deleteDeadline = (
  actor: Principal,
  matterId: string,
  id: string,
  input: unknown,
) => updateChild(actor, matterId, id, "deadline", input, true);
export const deleteNote = (
  actor: Principal,
  matterId: string,
  id: string,
  input: unknown,
) => updateChild(actor, matterId, id, "note", input, true);
