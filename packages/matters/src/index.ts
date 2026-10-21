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
  if (write) assertCoordinator(actor);
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
  query: { q?: string; stage?: string } = {},
) {
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
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: {
      tasks: {
        where:
          actor.role === "coordinator"
            ? {}
            : {
                visibility:
                  actor.role === "client"
                    ? "client"
                    : { in: ["agent", "client"] },
              },
      },
      deadlines: {
        where: actor.role === "client" ? { status: "confirmed" } : {},
      },
    },
  });
  return actor.role === "client"
    ? rows.map((m) => ({
        id: m.id,
        title: m.title,
        propertyAddress: m.propertyAddress,
        side: m.side,
        stage: m.stage,
        revision: m.revision,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        tasks: m.tasks.map(({ details: _, ...t }) => t),
        deadlines: m.deadlines.map(
          ({ details: _, sourceDocumentId: __, ...d }) => d,
        ),
      }))
    : rows;
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
      tasks: { where: v, orderBy: { createdAt: "asc" } },
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
      tasks: matter.tasks.map(({ details: _, ...t }) => t),
      deadlines: matter.deadlines
        .filter((d) => d.status === "confirmed")
        .map(({ details: _, sourceDocumentId: __, ...d }) => d),
      notes: matter.notes,
      documents: matter.documents,
    };
  return matter;
}
export async function createMatter(actor: Principal, input: unknown) {
  assertCoordinator(actor);
  const data = matterInput.parse(input);
  return prisma.$transaction(async (tx) => {
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
        details: data.details as Prisma.InputJsonValue,
      },
    });
    await audit(tx, actor, "matter.created", "Matter", matter.id, matter.id);
    return matter;
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
      listing: ["under_contract", "terminated", "archived"],
      under_contract: ["closing", "terminated", "archived"],
      closing: ["closed", "under_contract", "terminated"],
      closed: ["archived"],
      terminated: ["archived"],
      archived: [],
    };
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
    visibility: z.enum(["coordinator", "agent", "client"]).default("agent"),
    dueDate: dateOnly.nullable().optional(),
    details: json.default({}),
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
    details: json.default({}),
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
  const data = taskInput.parse(input);
  return prisma.$transaction(async (tx) => {
    await requireMatter(actor, matterId, true, tx);
    const row = await tx.task.create({
      data: {
        ...data,
        matterId,
        details: data.details as Prisma.InputJsonValue,
      },
    });
    await audit(tx, actor, "task.created", "Task", row.id, matterId);
    return row;
  });
}
export async function addDeadline(
  actor: Principal,
  matterId: string,
  input: unknown,
) {
  const data = deadlineInput.parse(input);
  return prisma.$transaction(async (tx) => {
    await requireMatter(actor, matterId, true, tx);
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
        details: data.details as Prisma.InputJsonValue,
      },
    });
    await audit(tx, actor, "deadline.created", "Deadline", row.id, matterId, {
      value: data as Prisma.InputJsonValue,
    });
    return row;
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
            visibility: z.enum(["coordinator", "agent", "client"]).optional(),
            dueDate: dateOnly.nullable().optional(),
            details: json.optional(),
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
              details: json.optional(),
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
      return { deleted: true };
    }
    const patch: Record<string, unknown> = { ...data };
    if (kind === "deadline" && "date" in data) {
      patch.details = {
        ...(old.details &&
        typeof old.details === "object" &&
        !Array.isArray(old.details)
          ? old.details
          : {}),
        ...("details" in data ? data.details : {}),
        manualOverride: true,
      };
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
    return delegate.findUniqueOrThrow({ where: { id } });
  });
}
export function createMattersRouter() {
  const router = Router();
  router.get(
    "/",
    asyncHandler(async (req, res) =>
      res.json(
        await listMatters(principal(req), {
          q: typeof req.query.q === "string" ? req.query.q : undefined,
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
            details,
          },
        });
      }
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
    if (data.facts) {
      const previous =
        matter.details &&
        typeof matter.details === "object" &&
        !Array.isArray(matter.details)
          ? matter.details
          : {};
      await tx.matter.update({
        where: { id: matterId },
        data: { details: { ...previous, confirmedFacts: data.facts } },
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
