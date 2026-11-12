import { createHash } from "node:crypto";
import { Prisma, prisma } from "@weatherly/db";
import { audit } from "@weatherly/matters";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import {
  creationConfirmSchema,
  type CreationConfirm,
} from "@weatherly/platform/handoff-contracts";
import { sourcesSchema } from "./inputs";
import { jsonObject } from "./intake-defaults";
import { attachReviewDocuments, verifySources } from "./sources";
import {
  assertReviewRevision,
  lockPendingIntake,
  ownedReview,
} from "./storage";

type Facts = CreationConfirm["facts"];

export type CreationReviewDependencies = {
  seedChecklist: (
    tx: Prisma.TransactionClient,
    matterId: string,
    input: {
      side: Facts["side"];
      purchaseType: Facts["purchaseType"];
      acceptance: Facts["acceptance"];
      timeZone: NonNullable<Facts["deadlineTimeZone"]> | null;
      dates: readonly CreationConfirm["dates"][number][];
    },
  ) => Promise<void>;
  seedPeople: (
    tx: Prisma.TransactionClient,
    actor: Principal,
    matterId: string,
    people: readonly CreationConfirm["people"][number][],
  ) => Promise<void>;
  afterConfirm: (
    tx: Prisma.TransactionClient,
    actor: Principal,
    matterId: string,
  ) => Promise<void>;
};

async function resolveAgentId(
  tx: Prisma.TransactionClient,
  input: CreationConfirm,
) {
  const { facts, business } = input;
  let agentId = facts.agentId;
  if (facts.agentRosterId) {
    const roster = await tx.rosterAgent.findUnique({
      where: { id: facts.agentRosterId },
      select: { userId: true, business: true, archivedAt: true },
    });
    if (
      !roster ||
      roster.archivedAt ||
      (roster.business && roster.business !== business.business) ||
      (agentId && roster.userId !== agentId)
    )
      throw new HttpError(
        422,
        "INVALID_AGENT_ROSTER",
        "Select an active roster entry consistent with the assigned agent and business.",
      );
    agentId = roster.userId;
  }
  if (
    agentId &&
    !(await tx.user.findFirst({
      where: { id: agentId, role: "agent" },
      select: { id: true },
    }))
  )
    throw new HttpError(422, "INVALID_AGENT", "Assign an existing agent.");
  return agentId;
}

async function matterDetails(
  tx: Prisma.TransactionClient,
  actor: Principal,
  input: CreationConfirm,
  pending: Awaited<ReturnType<typeof lockPendingIntake>> | null,
  confirmedAt: Date,
) {
  const previous = jsonObject(pending?.matter.details);
  const { serviceSnapshot, ...details } = previous;
  const next = {
    ...details,
    purchaseType: input.facts.purchaseType,
    fileReview: {
      ...jsonObject(previous.fileReview),
      status: "confirmed",
      confirmedAt: confirmedAt.toISOString(),
      confirmedById: actor.id,
    },
  };

  const { business, packageCode } = input.business;
  if (
    pending &&
    (pending.matter.packageCode !== packageCode ||
      (pending.matter.business ?? pending.intake.business ?? "weatherly") !==
        business)
  ) {
    const existingServiceOrder = await tx.paymentOrder.findFirst({
      where: { matterId: pending.matter.id, kind: "service" },
      select: { id: true },
    });
    if (existingServiceOrder)
      throw new HttpError(
        409,
        "EXISTING_SERVICE_ORDER",
        "Resolve the existing service order before changing this file's business or package.",
      );
  }
  if (business === "hto") return next;

  const savedIntakeTerms = jsonObject(pending?.intake.snapshot).serviceSnapshot;
  const retained = jsonObject(savedIntakeTerms ?? serviceSnapshot);
  if (
    pending?.matter.packageCode === packageCode &&
    retained.code === packageCode
  )
    return { ...next, serviceSnapshot: retained };

  const service = await tx.catalogItem.findUnique({
    where: { code: packageCode },
  });
  if (!service?.approved)
    throw new HttpError(
      409,
      "CATALOG_UNAPPROVED",
      "Review the designated service before creating a new file.",
    );
  return {
    ...next,
    serviceSnapshot: {
      code: service.code,
      name: service.name,
      priceCents: service.priceCents,
      currency: service.currency,
      revision: service.revision,
      dueAtClosing: true,
      noFeeIfTerminatedBeforeClosing: true,
      capturedAt: confirmedAt.toISOString(),
    },
  };
}

export async function confirmCreationReview(
  actor: Principal,
  id: string,
  raw: unknown,
  dependencies: CreationReviewDependencies,
) {
  assertCoordinator(actor);
  const input = creationConfirmSchema.parse(raw);
  const { requestId, expectedRevision, facts, business, people, dates } = input;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  try {
    return await prisma.$transaction(async (tx) => {
      const review = await ownedReview(tx, actor, id, true);
      if (review.state === "confirmed") {
        if (
          review.confirmationRequestId !== requestId ||
          review.confirmationFingerprint !== fingerprint
        )
          throw new HttpError(
            409,
            "CONFIRM_REQUEST_CONFLICT",
            "The review was confirmed with a different request.",
          );
        if (!review.confirmedMatterId)
          throw new HttpError(
            410,
            "CONFIRMED_MATTER_DELETED",
            "The confirmed transaction was deleted.",
          );
        return { matterId: review.confirmedMatterId };
      }

      assertReviewRevision(review, expectedRevision);
      const pending = review.intakeId
        ? await lockPendingIntake(tx, review.intakeId)
        : null;
      const sources = sourcesSchema.parse(review.sourceRefs);
      await verifySources(tx, review, sources, true);

      const now = new Date();
      const agentId = await resolveAgentId(tx, input);
      const details = await matterDetails(tx, actor, input, pending, now);
      const data = {
        title: facts.title,
        propertyAddress: facts.propertyAddress,
        side: facts.side,
        agentId,
        agentRosterId: facts.agentRosterId,
        purchasePriceCents: facts.purchasePriceCents,
        business: business.business,
        packageCode: business.packageCode,
        stage: "under_contract",
        details,
      };
      const matter = pending
        ? await tx.matter.update({
            where: { id: pending.matter.id },
            data: { ...data, revision: { increment: 1 } },
          })
        : await tx.matter.create({ data });

      await dependencies.seedChecklist(tx, matter.id, {
        side: facts.side,
        purchaseType: facts.purchaseType,
        acceptance: facts.acceptance,
        timeZone: facts.deadlineTimeZone ?? null,
        dates,
      });
      await dependencies.seedPeople(tx, actor, matter.id, people);
      await attachReviewDocuments(tx, review, matter.id);
      if (pending) {
        await tx.intakeSubmission.update({
          where: { id: pending.intake.id },
          data: {
            processedAt: pending.intake.processedAt ?? now,
            processedById: pending.intake.processedById ?? actor.id,
          },
        });
      }
      await tx.creationReview.update({
        where: { id },
        data: {
          state: "confirmed",
          revision: { increment: 1 },
          payload: { facts, business, people, dates },
          confirmedMatterId: matter.id,
          confirmedAt: now,
          confirmationRequestId: requestId,
          confirmationFingerprint: fingerprint,
        },
      });
      await dependencies.afterConfirm(tx, actor, matter.id);
      await audit(
        tx,
        actor,
        "creation_review.confirmed",
        "CreationReview",
        id,
        matter.id,
        {
          intakeId: review.intakeId,
          generation: review.extractionGeneration,
          sources,
        },
      );
      return { matterId: matter.id };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      (await prisma.creationReview.findUnique({
        where: { confirmationRequestId: requestId },
        select: { id: true },
      }))
    )
      throw new HttpError(
        409,
        "CONFIRM_REQUEST_CONFLICT",
        "The request key belongs to a different confirmation.",
      );
    throw error;
  }
}
