import { prisma, type Prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import {
  civilDateSchema,
  entityIdSchema,
  revisionSchema,
} from "@weatherly/platform/handoff-contracts";
import { audit, requireMatter, fileReviewPending } from "@weatherly/matters";
import { z } from "zod";

const openStages = ["under_contract", "closing", "listing"];
const workInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("later"),
      expectedRevision: revisionSchema.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("remind"),
      remindOn: civilDateSchema,
      expectedRevision: revisionSchema.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("clear_reminder"),
      expectedRevision: revisionSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("manual_complete"),
      expectedRevision: revisionSchema.nullable(),
    })
    .strict(),
  z
    .object({ action: z.literal("uncheck"), expectedRevision: revisionSchema })
    .strict(),
]);
type WorkChange = z.infer<typeof workInput>;

const workDetails = {
  template: {
    select: {
      id: true,
      name: true,
      active: true,
      side: true,
      serviceGroup: true,
    },
  },
  matter: {
    select: {
      id: true,
      propertyAddress: true,
      stage: true,
      side: true,
      packageCode: true,
    },
  },
  drafts: {
    where: { status: "sent", sentAt: { not: null } },
    orderBy: [{ sentAt: "desc" as const }, { id: "desc" as const }],
    select: { id: true, sentAt: true },
    take: 1,
  },
} satisfies Prisma.EmailWorkInclude;

function projectWork(
  work: Prisma.EmailWorkGetPayload<{ include: typeof workDetails }>,
) {
  const { drafts, template, matter, ...fields } = work;
  const [delivered] = drafts;
  const available =
    !template ||
    (template.active &&
      [matter.side, "both"].includes(template.side) &&
      (!template.serviceGroup ||
        template.serviceGroup ===
          `${matter.side}_${matter.packageCode === "complete" ? "compliance" : "ctc"}`));
  return {
    ...fields,
    title: template?.name ?? "Scratch email",
    templateActive: available,
    propertyAddress: matter.propertyAddress,
    sentAt: delivered?.sentAt ?? null,
    sentDraftId: delivered?.id ?? null,
    toSend:
      openStages.includes(matter.stage) &&
      available &&
      !delivered &&
      !work.manualCompletedAt &&
      Boolean(work.laterAt || work.remindOn),
  };
}

export async function listEmailWork(actor: Principal, raw: unknown = {}) {
  assertCoordinator(actor);
  const query = z
    .object({
      matterId: entityIdSchema.optional(),
      view: z.enum(["all", "to_send"]).default("to_send"),
      from: civilDateSchema.optional(),
      through: civilDateSchema.optional(),
    })
    .strict()
    .parse(raw);
  if (query.matterId) await requireMatter(actor, query.matterId);
  const works = await prisma.emailWork.findMany({
    where: {
      ...(query.matterId ? { matterId: query.matterId } : {}),
      ...(query.view === "to_send"
        ? {
            matter: { is: { stage: { in: openStages } } },
            manualCompletedAt: null,
            OR: [{ laterAt: { not: null } }, { remindOn: { not: null } }],
            drafts: { none: { status: "sent", sentAt: { not: null } } },
          }
        : {}),
      ...(query.from || query.through
        ? { remindOn: { gte: query.from, lte: query.through } }
        : {}),
    },
    orderBy: [
      { remindOn: { sort: "asc", nulls: "last" } },
      { laterAt: { sort: "asc", nulls: "last" } },
      { id: "asc" },
    ],
    include: workDetails,
  });
  const projected = works.map(projectWork);
  return query.view === "to_send"
    ? projected.filter((work) => work.toSend)
    : projected;
}

export async function ensureTemplateWork(
  tx: Prisma.TransactionClient,
  matter: Pick<Prisma.MatterGetPayload<object>, "id" | "side" | "packageCode">,
  templateId: string,
) {
  const template = await tx.communicationTemplate.findFirst({
    where: {
      id: templateId,
      active: true,
      side: { in: [matter.side, "both"] },
    },
  });
  const serviceGroup = `${matter.side}_${matter.packageCode === "complete" ? "compliance" : "ctc"}`;
  if (
    !template ||
    (template.serviceGroup && template.serviceGroup !== serviceGroup)
  )
    throw new HttpError(
      409,
      "TEMPLATE_CHANGED",
      "Choose a current template for this file.",
    );
  return tx.emailWork.upsert({
    where: { matterId_templateId: { matterId: matter.id, templateId } },
    create: {
      matterId: matter.id,
      templateId,
      templateRevision: template.revision,
      linkedStepKey: template.linkedStepKey,
    },
    update: {},
    include: workDetails,
  });
}

export async function requireEmailWorkFile(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
) {
  const matter = await requireMatter(actor, matterId, true, tx);
  if (fileReviewPending(matter) || !openStages.includes(matter.stage))
    throw new HttpError(
      409,
      "EMAIL_FILE_READ_ONLY",
      "Open an active, confirmed file to change its email work.",
    );
  return matter;
}

async function changeWork(
  tx: Prisma.TransactionClient,
  actor: Principal,
  work: Prisma.EmailWorkGetPayload<{ include: typeof workDetails }>,
  change: WorkChange,
) {
  if (
    change.expectedRevision !== null &&
    change.expectedRevision !== work.revision
  )
    throw new HttpError(
      409,
      "REVISION_CONFLICT",
      "This email changed. Refresh before editing.",
    );
  if (change.expectedRevision === null && work.revision !== 1)
    throw new HttpError(
      409,
      "REVISION_CONFLICT",
      "This email already has saved work. Refresh before editing.",
    );
  if (work.drafts.length || work.template?.active === false)
    throw new HttpError(
      409,
      "EMAIL_WORK_COMPLETE",
      "This email was already sent or its template is unavailable.",
    );
  if (
    work.manualCompletedAt &&
    (change.action === "remind" || change.action === "later")
  )
    throw new HttpError(
      409,
      "EMAIL_WORK_COMPLETE",
      "Uncheck this email before scheduling another reminder.",
    );
  let data: Prisma.EmailWorkUpdateInput;
  switch (change.action) {
    case "later":
      data = { laterAt: new Date() };
      break;
    case "remind":
      data = { remindOn: change.remindOn };
      break;
    case "clear_reminder":
      data = { remindOn: null };
      break;
    case "manual_complete":
      data = {
        manualCompletedAt: new Date(),
        manualCompletedById: actor.id,
        laterAt: null,
        remindOn: null,
      };
      break;
    case "uncheck":
      data = { manualCompletedAt: null, manualCompletedById: null };
      break;
  }
  const updated = await tx.emailWork.update({
    where: { id: work.id },
    data: { ...data, revision: { increment: 1 } },
    include: workDetails,
  });
  await audit(
    tx,
    actor,
    `email.work_${change.action}`,
    "EmailWork",
    work.id,
    work.matterId,
  );
  return projectWork(updated);
}

export async function changeTemplateWork(
  actor: Principal,
  matterId: string,
  templateId: string,
  raw: unknown,
) {
  assertCoordinator(actor);
  const change = workInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    const matter = await requireEmailWorkFile(tx, actor, matterId);
    const work = await ensureTemplateWork(tx, matter, templateId);
    return changeWork(tx, actor, work, change);
  });
}

export async function changeEmailWork(
  actor: Principal,
  id: string,
  raw: unknown,
) {
  assertCoordinator(actor);
  const change = workInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    const original = await tx.emailWork.findUnique({
      where: { id },
      select: { matterId: true },
    });
    if (!original)
      throw new HttpError(404, "EMAIL_WORK_NOT_FOUND", "Email work not found.");
    await requireEmailWorkFile(tx, actor, original.matterId);
    const work = await tx.emailWork.findUnique({
      where: { id },
      include: workDetails,
    });
    if (!work)
      throw new HttpError(404, "EMAIL_WORK_NOT_FOUND", "Email work not found.");
    return changeWork(tx, actor, work, change);
  });
}

export async function finishSentWork(
  tx: Prisma.TransactionClient,
  workItemId: string | null,
) {
  if (!workItemId) return;
  await tx.emailWork.updateMany({
    where: { id: workItemId },
    data: { laterAt: null, remindOn: null, revision: { increment: 1 } },
  });
}
