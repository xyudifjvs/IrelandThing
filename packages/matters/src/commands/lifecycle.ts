import { type Principal, assertCoordinator, HttpError } from "@weatherly/platform";
import { matterInput, stages } from "./lifecycle-input";
import { prisma, type Prisma } from "@weatherly/db";
import { applyInitialWorkflow } from "../rules";
import { audit, requireMatter } from "../access";
import { z } from "zod";
import { revision, json } from "../validation/common";
import { fileReviewPending } from "../file-review";
import { matterChanged } from "../change-hook";

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
