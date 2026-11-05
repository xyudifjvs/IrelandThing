import { Router } from "express";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  principal,
  asyncHandler,
  type Principal,
  validDate,
} from "@weatherly/platform";
import { requireMatter, audit } from "./index";
const stepSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_-]{1,80}$/),
    title: z.string().min(1).max(200),
    kind: z.enum(["checklist", "broker"]),
    visibility: z.enum(["coordinator", "agent", "client"]),
    when: z
      .object({
        financing: z.enum(["cash", "financed"]).optional(),
        pre1978: z.boolean().optional(),
      })
      .strict()
      .optional(),
    rule: z
      .object({
        anchor: z.string().min(1).max(200),
        offsetDays: z.number().int().min(-365).max(365),
        businessDays: z.boolean(),
        skipDates: z.array(z.string().refine(validDate)).max(100),
      })
      .strict()
      .optional(),
  })
  .strict();
export const definitionSchema = z
  .object({ steps: z.array(stepSchema).min(1).max(150) })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.steps.map((s) => s.key)).size !== value.steps.length ||
      new Set(value.steps.map((s) => s.title)).size !== value.steps.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Step keys and titles must be unique.",
      });
    for (const s of value.steps)
      if (s.rule?.anchor === s.title)
        ctx.addIssue({
          code: "custom",
          message: "A step cannot use itself as a date anchor.",
        });
  });
const templateInput = z
  .object({
    name: z.string().min(1).max(150),
    side: z.enum(["buyer", "seller", "any"]),
    packageCode: z.enum(["essentials", "complete", "full_listing", "any"]),
    definition: definitionSchema,
  })
  .strict();
const milestoneNames = [
  "Pre-approval / VOD",
  "Loan application",
  "Earnest money (EMD)",
  "Attorney review",
  "Inspections",
  "Remedies",
  "Remedies negotiated",
  "Home warranty ordered",
  "Condo / HOA docs provided",
  "Condo / HOA docs reviewed",
  "Appraisal ordered",
  "Appraisal completed",
  "Loan commitment",
  "Title commitment",
  "Final walkthrough",
  "Closing date",
  "Possession date and time",
];
export const defaultDefinition = {
  steps: milestoneNames.map((title, i) => ({
    key: `milestone-${i + 1}`,
    title,
    kind: "checklist" as const,
    visibility: "agent" as const,
    ...([1, 10, 11, 12].includes(i)
      ? { when: { financing: "financed" as const } }
      : {}),
  })),
};
export function offsetDate(
  anchor: string,
  offset: number,
  businessDays: boolean,
  skipDates: string[] = [],
) {
  if (!validDate(anchor))
    throw new HttpError(422, "INVALID_DATE", "Use a valid date anchor.");
  const date = new Date(`${anchor}T12:00:00Z`);
  let remaining = Math.abs(offset);
  const direction = offset < 0 ? -1 : 1;
  let walked = 0;
  while (remaining) {
    date.setUTCDate(date.getUTCDate() + direction);
    if (++walked > 1500)
      throw new HttpError(
        422,
        "DATE_RULE_LIMIT",
        "This date rule cannot be calculated.",
      );
    const weekday = date.getUTCDay();
    if (
      (!businessDays || (weekday !== 0 && weekday !== 6)) &&
      !skipDates.includes(date.toISOString().slice(0, 10))
    )
      remaining--;
  }
  return date.toISOString().slice(0, 10);
}
export async function listWorkflowTemplates(actor: Principal) {
  assertCoordinator(actor);
  return prisma.workflowTemplate.findMany({ orderBy: { name: "asc" } });
}
export async function createWorkflowTemplate(actor: Principal, raw: unknown) {
  assertCoordinator(actor);
  const input = templateInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    const row = await tx.workflowTemplate.create({
      data: { ...input, definition: input.definition },
    });
    await audit(
      tx,
      actor,
      "workflow.template_created",
      "WorkflowTemplate",
      row.id,
      null,
      { revision: row.revision },
    );
    return row;
  });
}
export async function updateWorkflowTemplate(
  actor: Principal,
  id: string,
  raw: unknown,
) {
  assertCoordinator(actor);
  const input = z
    .object({
      expectedRevision: z.number().int().positive(),
      name: z.string().min(1).max(150).optional(),
      active: z.boolean().optional(),
      definition: definitionSchema.optional(),
    })
    .strict()
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    const { expectedRevision, ...patch } = input;
    const updated = await tx.workflowTemplate.updateMany({
      where: { id, revision: expectedRevision },
      data: { ...patch, revision: { increment: 1 } },
    });
    if (!updated.count)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "The template changed. Refresh before saving.",
      );
    await audit(
      tx,
      actor,
      "workflow.template_updated",
      "WorkflowTemplate",
      id,
      null,
      { previousRevision: expectedRevision, newTransactionsOnly: true },
    );
    return tx.workflowTemplate.findUniqueOrThrow({ where: { id } });
  });
}
/** Called inside initial matter/intake transaction. The snapshot is permanent; later template edits affect new matters only. */
export async function applyInitialWorkflow(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
) {
  const matter = await tx.matter.findUniqueOrThrow({ where: { id: matterId } });
  const details = matter.details as Record<string, Prisma.InputJsonValue>;
  if (details.workflow) return;
  const templates = await tx.workflowTemplate.findMany({
    where: {
      active: true,
      side: { in: [matter.side, "any"] },
      packageCode: { in: [matter.packageCode, "any"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  templates.sort(
    (a, b) =>
      Number(b.side === matter.side) +
      Number(b.packageCode === matter.packageCode) -
      Number(a.side === matter.side) -
      Number(a.packageCode === matter.packageCode),
  );
  const template = templates[0];
  const definition = definitionSchema.parse(
    template?.definition || defaultDefinition,
  );
  const snapshot = {
    templateId: template?.id || "source-milestones",
    templateRevision: template?.revision || 1,
    definition,
  };
  await tx.matter.update({
    where: { id: matterId },
    data: { details: { ...details, workflow: snapshot } },
  });
  for (const [position, step] of definition.steps.entries()) {
    const broker = details.broker as { pre1978?: boolean } | undefined;
    const applicable =
      (!step.when?.financing || step.when.financing === details.purchaseType) &&
      (step.when?.pre1978 === undefined ||
        step.when.pre1978 === broker?.pre1978);
    await tx.task.create({
      data: {
        matterId,
        title: step.title,
        kind: step.kind,
        visibility: step.visibility,
        position,
        status: applicable ? "pending" : "not_applicable",
        details: {
          workflowKey: step.key,
          templateId: snapshot.templateId,
          templateRevision: snapshot.templateRevision,
        },
      },
    });
    if (applicable && step.rule)
      await tx.deadline.create({
        data: {
          matterId,
          label: step.title,
          status: "unknown",
          details: {
            workflowKey: step.key,
            rule: step.rule,
            templateRevision: snapshot.templateRevision,
          },
        },
      });
  }
  await audit(
    tx,
    actor,
    "workflow.snapshot_applied",
    "Matter",
    matterId,
    matterId,
    {
      templateId: snapshot.templateId,
      templateRevision: snapshot.templateRevision,
    },
  );
  await recalculateWorkflow(tx, actor, matterId);
}
/** Rule calculations are proposals. Only coordinator-confirmed deadlines may
 * supply the authoritative task date consumed by calendars and shared views.
 * Read projection also protects records saved before this approval boundary.
 */
export function approvedWorkflowTaskDates<
  T extends { dueDate: string | null; details: Prisma.JsonValue },
>(
  tasks: T[],
  deadlines: {
    date: string | null;
    status: string;
    details: Prisma.JsonValue;
  }[],
  matterDetails: Prisma.JsonValue,
): T[] {
  const details = matterDetails as {
    workflow?: { definition?: unknown };
  } | null;
  const definition = definitionSchema.safeParse(details?.workflow?.definition);
  if (!definition.success) return tasks;
  const ruleKeys = new Set(
    definition.data.steps.filter((step) => step.rule).map((step) => step.key),
  );
  return tasks.map((task) => {
    const key = (task.details as { workflowKey?: string } | null)?.workflowKey;
    if (!key || !ruleKeys.has(key)) return task;
    const matching = deadlines.filter(
      (deadline) =>
        (deadline.details as { workflowKey?: string } | null)?.workflowKey ===
        key,
    );
    const approved =
      matching.length === 1 && matching[0].status === "confirmed"
        ? matching[0].date
        : null;
    return { ...task, dueDate: approved };
  });
}

async function syncApprovedTaskDate(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
  key: string,
  date: string | null,
) {
  const updated = await tx.task.updateMany({
    where: {
      matterId,
      details: { path: ["workflowKey"], equals: key },
      ...(date
        ? { OR: [{ dueDate: null }, { dueDate: { not: date } }] }
        : { dueDate: { not: null } }),
    },
    data: { dueDate: date, revision: { increment: 1 } },
  });
  if (updated.count)
    await audit(
      tx,
      actor,
      "workflow.approved_task_date_synced",
      "Matter",
      matterId,
      matterId,
      {
        workflowKey: key,
        date,
        taskCount: updated.count,
      },
    );
}

/** Recomputes rule-owned dates after anchor changes. Explicit manual overrides are preserved. */
export async function recalculateWorkflow(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
  options: { approvedDeadlineIds?: ReadonlySet<string> } = {},
) {
  const matter = await tx.matter.findUniqueOrThrow({ where: { id: matterId } });
  const details = matter.details as Record<string, Prisma.JsonValue>;
  const workflow = details.workflow as { definition?: unknown } | undefined;
  if (!workflow?.definition) return [];
  const definition = definitionSchema.parse(workflow.definition);
  // A downstream rule must see its anchor's final state in this transaction,
  // even when the saved presentation order puts the dependent step first.
  const remaining = definition.steps.filter((step) => step.rule);
  const ordered: typeof remaining = [];
  while (remaining.length) {
    const ready = remaining.filter(
      (step) => !remaining.some((other) => other.title === step.rule!.anchor),
    );
    if (!ready.length)
      throw new HttpError(
        422,
        "DATE_RULE_CYCLE",
        "Workflow date rules contain a circular anchor. Correct the workflow before recalculating.",
      );
    ordered.push(...ready);
    for (const step of ready) remaining.splice(remaining.indexOf(step), 1);
  }
  const changes: { label: string; date: string | null; preserved?: boolean }[] =
    [];
  for (const step of ordered) {
    if (!step.rule) continue;
    // Re-read our own earlier writes rather than using an obsolete confirmed
    // anchor from the start of the recalculation.
    const deadlines = await tx.deadline.findMany({ where: { matterId } });
    const deadline = deadlines.find(
      (d) => (d.details as { workflowKey?: string }).workflowKey === step.key,
    );
    if (!deadline) {
      await syncApprovedTaskDate(tx, actor, matterId, step.key, null);
      continue;
    }
    if ((deadline.details as { manualOverride?: boolean }).manualOverride) {
      await syncApprovedTaskDate(
        tx,
        actor,
        matterId,
        step.key,
        deadline.status === "confirmed" ? deadline.date : null,
      );
      changes.push({
        label: deadline.label,
        date: deadline.date,
        preserved: true,
      });
      continue;
    }
    const anchors = deadlines.filter(
      (d) =>
        d.label === step.rule!.anchor && d.status === "confirmed" && d.date,
    );
    const date =
      anchors.length === 1
        ? offsetDate(
            anchors[0].date!,
            step.rule.offsetDays,
            step.rule.businessDays,
            step.rule.skipDates,
          )
        : null;
    if (
      options.approvedDeadlineIds?.has(deadline.id) &&
      deadline.status === "confirmed" &&
      deadline.date &&
      deadline.date !== date
    ) {
      // An explicit approval of quoted source evidence wins over a configured
      // calculation. Treat that conflict as the existing manual-override policy,
      // rather than silently replacing Ireland's accepted date in this transaction.
      const preserved = await tx.deadline.updateMany({
        where: { id: deadline.id, revision: deadline.revision },
        data: {
          details: {
            ...(deadline.details as Record<string, Prisma.InputJsonValue>),
            manualOverride: true,
            ruleOverrideReason:
              "Coordinator approved source date over calculated rule",
          },
          revision: { increment: 1 },
        },
      });
      if (!preserved.count)
        throw new HttpError(
          409,
          "REVISION_CONFLICT",
          "Deadline changed during review; refresh before applying",
        );
      await syncApprovedTaskDate(tx, actor, matterId, step.key, deadline.date);
      await audit(
        tx,
        actor,
        "deadline.reviewed_rule_override_preserved",
        "Deadline",
        deadline.id,
        matterId,
        {
          approvedDate: deadline.date,
          calculatedProposal: date,
          rule: step.rule,
        },
      );
      changes.push({
        label: deadline.label,
        date: deadline.date,
        preserved: true,
      });
      continue;
    }
    const previousAnchor = deadline.details as {
      anchorId?: string;
      anchorRevision?: number;
    };
    if (
      deadline.date === date &&
      previousAnchor.anchorId === (anchors[0]?.id || null) &&
      previousAnchor.anchorRevision === (anchors[0]?.revision || null)
    ) {
      await syncApprovedTaskDate(
        tx,
        actor,
        matterId,
        step.key,
        deadline.status === "confirmed" ? deadline.date : null,
      );
      continue;
    }
    const nextStatus = date
      ? deadline.date === date && deadline.status === "confirmed"
        ? "confirmed"
        : "proposed"
      : "unknown";
    const changed = await tx.deadline.updateMany({
      where: { id: deadline.id, revision: deadline.revision },
      data: {
        date,
        status: nextStatus,
        revision: { increment: 1 },
        details: {
          ...(deadline.details as Record<string, Prisma.InputJsonValue>),
          calculatedAt: new Date().toISOString(),
          anchorId: anchors[0]?.id || null,
          anchorRevision: anchors[0]?.revision || null,
        },
      },
    });
    if (!changed.count)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "A deadline changed during recalculation. Refresh and try again.",
      );
    // Only a changed calculated value needs a new approval; a metadata-only
    // anchor revision must not revoke approval of an unchanged date.
    await syncApprovedTaskDate(
      tx,
      actor,
      matterId,
      step.key,
      nextStatus === "confirmed" ? date : null,
    );
    await audit(
      tx,
      actor,
      "deadline.rule_recalculated",
      "Deadline",
      deadline.id,
      matterId,
      { before: deadline.date, after: date, rule: step.rule },
    );
    changes.push({ label: step.title, date });
  }
  return changes;
}
export function createWorkflowsRouter() {
  const r = Router();
  r.get(
    "/templates",
    asyncHandler(async (req, res) =>
      res.json(await listWorkflowTemplates(principal(req))),
    ),
  );
  r.post(
    "/templates",
    asyncHandler(async (req, res) =>
      res
        .status(201)
        .json(await createWorkflowTemplate(principal(req), req.body)),
    ),
  );
  r.patch(
    "/templates/:id",
    asyncHandler(async (req, res) =>
      res.json(
        await updateWorkflowTemplate(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  r.post(
    "/matters/:id/recalculate",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      assertCoordinator(actor);
      const input = z
        .object({ expectedRevision: z.number().int().positive() })
        .strict()
        .parse(req.body);
      const matterId = String(req.params.id);
      res.json(
        await prisma.$transaction(async (tx) => {
          await requireMatter(actor, matterId, true, tx);
          const claim = await tx.matter.updateMany({
            where: { id: matterId, revision: input.expectedRevision },
            data: { revision: { increment: 1 } },
          });
          if (!claim.count)
            throw new HttpError(
              409,
              "REVISION_CONFLICT",
              "The transaction changed. Refresh before recalculating.",
            );
          return { changes: await recalculateWorkflow(tx, actor, matterId) };
        }),
      );
    }),
  );
  return r;
}
