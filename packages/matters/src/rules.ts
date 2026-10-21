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
  for (const step of definition.steps) {
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
/** Recomputes rule-owned dates after anchor changes. Explicit manual overrides are preserved. */
export async function recalculateWorkflow(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
) {
  const matter = await tx.matter.findUniqueOrThrow({ where: { id: matterId } });
  const details = matter.details as Record<string, Prisma.JsonValue>;
  const workflow = details.workflow as { definition?: unknown } | undefined;
  if (!workflow?.definition) return [];
  const definition = definitionSchema.parse(workflow.definition);
  const deadlines = await tx.deadline.findMany({ where: { matterId } });
  const changes: { label: string; date: string | null; preserved?: boolean }[] =
    [];
  for (const step of definition.steps) {
    if (!step.rule) continue;
    const deadline = deadlines.find(
      (d) => (d.details as { workflowKey?: string }).workflowKey === step.key,
    );
    if (!deadline) continue;
    if ((deadline.details as { manualOverride?: boolean }).manualOverride) {
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
    const previousAnchor = deadline.details as {
      anchorId?: string;
      anchorRevision?: number;
    };
    if (
      deadline.date === date &&
      previousAnchor.anchorId === (anchors[0]?.id || null) &&
      previousAnchor.anchorRevision === (anchors[0]?.revision || null)
    )
      continue;
    const changed = await tx.deadline.updateMany({
      where: { id: deadline.id, revision: deadline.revision },
      data: {
        date,
        status: date ? "proposed" : "unknown",
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
    await tx.task.updateMany({
      where: {
        matterId,
        details: { path: ["workflowKey"], equals: step.key },
        status: { notIn: ["completed", "signed", "not_applicable"] },
      },
      data: { dueDate: date, revision: { increment: 1 } },
    });
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
