import { type Prisma, prisma } from "@weatherly/db";
import { requireMatter, audit } from "../access";
import { fileReviewPending } from "../file-review";
import { type Principal, assertCoordinator, HttpError } from "@weatherly/platform";
import { z } from "zod";
import { revision } from "../validation/common";
import { applyInitialWorkflow } from "../rules";
import { matterChanged } from "../change-hook";

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
    if (await tx.creationReview.findFirst({
      where: { state: "open", intake: { matterId } },
      select: { id: true },
    }))
      throw new HttpError(
        409,
        "CREATION_REVIEW_REQUIRED",
        "Confirm this file in its creation review.",
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
    await tx.intakeSubmission.updateMany({where:{matterId,processedAt:null},data:{processedAt:new Date(),processedById:actor.id}});
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
