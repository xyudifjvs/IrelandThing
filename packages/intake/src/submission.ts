import { getAgentMembership } from "@weatherly/identity/membership";
import { htoServiceCode } from "@weatherly/platform/handoff-contracts";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import { HttpError, type Principal } from "@weatherly/platform";
import { audit, revision, requireMatter } from "@weatherly/matters";
import { referenceDocumentIds, referenceFollowups } from "./reference";
import { intakePayload, assertSubmissionReady } from "./validation";
import { currentSubmitter } from "./submitter";

export async function draftFor(
  actor: Principal,
  id: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const draft = await db.intakeDraft.findFirst({
    where: {
      id,
      ...(actor.role === "coordinator" ? {} : { userId: actor.id }),
    },
  });
  if (!draft) throw new HttpError(404, "DRAFT_NOT_FOUND", "Draft not found");
  if (actor.role === "client")
    throw new HttpError(
      403,
      "FORBIDDEN",
      "Only agents may submit transactions",
    );
  return draft;
}
export function permitted(actor: Principal) {
  if (actor.role !== "agent")
    throw new HttpError(
      403,
      "FORBIDDEN",
      "Only agents may submit transactions",
    );
}
export async function saveIntakeDraft(
  actor: Principal,
  id: string,
  input: unknown,
) {
  permitted(actor);
  const { expectedRevision, payload } = z
    .object({
      expectedRevision: revision,
      payload: z.record(z.string(), z.json()),
    })
    .strict()
    .parse(input);
  return prisma.$transaction(async (tx) => {
    const draft = await draftFor(actor, id, tx);
    if (draft.status === "submitted")
      throw new HttpError(
        409,
        "ALREADY_SUBMITTED",
        "Submitted intake is immutable",
      );
    const result = await tx.intakeDraft.updateMany({
      where: { id, revision: expectedRevision, status: "draft" },
      data: {
        payload: payload as Prisma.InputJsonValue,
        revision: { increment: 1 },
      },
    });
    if (!result.count)
      throw new HttpError(409, "REVISION_CONFLICT", "Draft changed; refresh");
    return tx.intakeDraft.findUniqueOrThrow({ where: { id } });
  });
}
function assertActiveReceipt(receipt: { deletedAt: Date | null }) {
  if (receipt.deletedAt)
    throw new HttpError(410, "INTAKE_DELETED", "This intake has been deleted.");
}

export async function submitIntake(
  actor: Principal,
  id: string,
  input: unknown,
) {
  permitted(actor);
  const { expectedRevision, idempotencyKey } = z
    .object({
      expectedRevision: revision,
      idempotencyKey: z.string().min(8).max(150),
    })
    .strict()
    .parse(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const draft = await draftFor(actor, id, tx);
      const existing = await tx.intakeSubmission.findUnique({
        where: { draftId: id },
      });
      if (existing) {
        assertActiveReceipt(existing);
        if (existing.idempotencyKey !== idempotencyKey)
          throw new HttpError(
            409,
            "ALREADY_SUBMITTED",
            "This draft has already been submitted",
          );
        return {
          submission: existing,
          matter: await tx.matter.findUniqueOrThrow({
            where: { id: existing.matterId },
          }),
        };
      }
      const data = intakePayload.parse(draft.payload);
      const membership = await getAgentMembership(draft.userId, tx);
      const { business, rosterAgentId } = membership;
      const packageCode = business === "hto" ? htoServiceCode : data.packageCode;
      assertSubmissionReady(data, business);
      const catalog = business === "weatherly"
        ? await tx.catalogItem.findUnique({ where: { code: data.packageCode } })
        : null;
      if (business === "weatherly" && !catalog?.approved)
        throw new HttpError(
          409,
          "CATALOG_UNAPPROVED",
          "The selected service is not available for a new submission.",
        );
      const intakeDetails = {
        ...data,
        packageCode,
        business,
        fileReview: { status: "pending" },
        ...(catalog ? {
          serviceSnapshot: {
            code: catalog.code,
            name: catalog.name,
            revision: catalog.revision,
            priceCents: catalog.priceCents,
            currency: catalog.currency,
            dueAtClosing: true,
            noFeeIfTerminatedBeforeClosing: true,
          },
        } : {}),
      };
      const snapshot = {
        ...intakeDetails,
        submitter: await currentSubmitter(tx, draft.userId),
      };
      if (data.replacesMatterId) {
        // A replacement is a separate submitted record. Lock and re-read the
        // authorized source without modifying its history or documents.
        await requireMatter(actor, data.replacesMatterId, false, tx);
        await tx.$queryRaw`SELECT id FROM "Matter" WHERE id=${data.replacesMatterId} FOR SHARE`;
        const replaced = await requireMatter(
          actor,
          data.replacesMatterId,
          false,
          tx,
        );
        const addressKey = (value: string) =>
          value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
        if (replaced.stage !== "terminated")
          throw new HttpError(
            409,
            "REPLACEMENT_REQUIRES_TERMINATED",
            "A replacement intake must reference an authorized terminated transaction.",
          );
        if (
          replaced.side !== data.side ||
          (data.propertyAddress &&
            replaced.propertyAddress &&
            addressKey(replaced.propertyAddress) !==
              addressKey(data.propertyAddress))
        )
          throw new HttpError(
            422,
            "INVALID_REPLACEMENT",
            "A replacement must keep the represented side and, when supplied, the same property address.",
          );
      }
      if (data.linkedMatterId) {
        const linked = await tx.matter.findFirst({
          where: {
            id: data.linkedMatterId,
            ...(actor.role === "coordinator" ? {} : { agentId: actor.id }),
          },
        });
        if (
          !linked ||
          linked.propertyAddress.toLowerCase() !==
            data.propertyAddress.toLowerCase() ||
          linked.side === data.side
        )
          throw new HttpError(
            422,
            "INVALID_LINK",
            "Linked representation must be the opposite side of the same property",
          );
      }
      // Claim the exact saved revision before creating any downstream records; all effects roll back on a race.
      const claim = await tx.intakeDraft.updateMany({
        where: { id, revision: expectedRevision, status: "draft" },
        data: {
          status: "submitted",
          submittedAt: new Date(),
          revision: { increment: 1 },
        },
      });
      if (!claim.count)
        throw new HttpError(409, "REVISION_CONFLICT", "Draft changed; refresh");
      const allDocumentIds = [
        ...new Set([
          ...data.documentIds,
          ...referenceDocumentIds(data.referenceIntake),
          ...(data.broker?.checklistDocumentId
            ? [data.broker.checklistDocumentId]
            : []),
          ...(data.broker?.checklistDocumentIds || []),
        ]),
      ];
      const docs = await tx.document.findMany({
        where: { id: { in: allDocumentIds }, createdById: draft.userId },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
      if (docs.length !== allDocumentIds.length)
        throw new HttpError(
          422,
          "INVALID_DOCUMENT",
          "Uploaded files must belong to this submitting agent",
        );
      if (
        docs.some((doc) => {
          const latest = doc.versions[0];
          return (
            !latest ||
            latest.size <= 0 ||
            !latest.objectKey ||
            !/^[a-f0-9]{64}$/i.test(latest.checksum)
          );
        })
      )
        throw new HttpError(
          422,
          "DOCUMENT_NOT_AVAILABLE",
          "Complete every selected upload before submitting",
        );
      const matter = await tx.matter.create({
        data: {
          title: data.propertyAddress || "Untitled transaction",
          propertyAddress: data.propertyAddress,
          side: data.side,
          packageCode,
          business,
          stage: "pending_review",
          agentId: draft.userId,
          agentRosterId: rosterAgentId,
          details: intakeDetails as Prisma.InputJsonValue,
        },
      });
      for (const doc of docs) {
        if (doc.matterId)
          throw new HttpError(
            422,
            "DOCUMENT_ALREADY_ASSIGNED",
            "Upload a separate copy of evidence for another matter",
          );
        const assignment = await tx.document.updateMany({
          where: { id: doc.id, matterId: null, createdById: draft.userId },
          data: { matterId: matter.id },
        });
        if (!assignment.count)
          throw new HttpError(
            409,
            "DOCUMENT_ALREADY_ASSIGNED",
            "This document was assigned concurrently; upload a separate copy",
          );
      }
      const tasks: {
        title: string;
        kind: string;
        visibility: string;
        details: Prisma.InputJsonValue;
      }[] = [];
      const add = (title: string, kind = "intake") =>
        tasks.push({
          title,
          kind,
          visibility: "agent",
          details: { intakeDraftId: id },
        });
      if (!data.propertyAddress) add("Obtain property address");
      if (
        !data.clients.length ||
        data.clients.some((c) => !c.name || !c.email || !c.phone)
      )
        add("Complete client contact information");
      const contractIds = data.referenceIntake
        ? data.referenceIntake.uploads.contractDocs || []
        : data.documentIds;
      const dotloopRequested =
        data.referenceIntake?.fields.docsDotloop === true ||
        data.referenceIntake?.fields.docsDotloop === "on";
      add(
        data.contractSource === "not_yet_executed" ||
          (data.contractSource === "upload" &&
            !contractIds.length &&
            !dotloopRequested)
          ? "Obtain executed contract"
          : data.contractSource === "dotloop"
            ? data.dotloopLoopId
              ? "Import executed contract from Dotloop"
              : "Obtain Dotloop loop ID and executed contract"
            : "Review executed contract",
      );
      add(
        data.title.choice === "have"
          ? data.title.name
            ? "Confirm title company details"
            : "Obtain title company details"
          : `Resolve title company via ${data.title.choice}`,
      );
      if (data.lender)
        add(
          data.lender.choice === "have"
            ? data.lender.name
              ? "Confirm lender details"
              : "Obtain lender details"
            : `Resolve lender details via ${data.lender.choice}`,
        );
      else if (data.purchaseType === "financed") add("Obtain lender details");
      if (data.hoa !== "none") add(`HOA follow-up: ${data.hoa}`);
      if (data.priorPolicy && data.priorPolicy !== "not_applicable")
        add(`Prior title policy: ${data.priorPolicy}`);
      if (data.broker?.pre1978)
        add("Review lead-based paint disclosure evidence", "compliance");
      if (data.broker?.ownChecklist)
        add("Obtain and apply brokerage checklist", "compliance");
      if (data.packageCode !== "essentials")
        add("Review broker compliance file", "compliance");
      if (data.gift.requested)
        add("Confirm gift catalog and payment before ordering", "gift");
      if (data.referenceIntake)
        for (const followup of referenceFollowups(data.referenceIntake))
          tasks.push({
            title: followup.title,
            kind: followup.kind,
            visibility: "agent",
            details: { intakeDraftId: id, referenceField: followup.field },
          });
      if (data.replacesMatterId)
        add("Review replacement contract and prior transaction history");
      await tx.task.createMany({
        data: tasks.map((task) => ({ ...task, matterId: matter.id })),
      });
      await tx.deadline.createMany({
        data: ["Closing", "Possession", "Inspection"].map((label) => ({
          matterId: matter.id,
          label,
          status: "unknown",
          details: {
            source: "intake",
            reviewRequired: true,
            visibility: "coordinator",
          },
        })),
      });
      // Ireland confirms the saved intake before the matter workflow becomes active.
      const submission = await tx.intakeSubmission.create({
        data: {
          draftId: id,
          idempotencyKey,
          userId: draft.userId,
          matterId: matter.id,
          business,
          snapshot: snapshot as Prisma.InputJsonValue,
        },
      });
      await tx.intakeDraft.update({
        where: { id },
        data: { submittedMatterId: matter.id },
      });
      await tx.outboxJob.create({
        data: {
          topic: "intake.received",
          idempotencyKey: `intake-received:${submission.id}`,
          payload: { submissionId: submission.id },
        },
      });
      await audit(
        tx,
        actor,
        "intake.submitted",
        "IntakeSubmission",
        submission.id,
        matter.id,
        { draftId: id },
      );
      return {
        submission,
        matter: await tx.matter.findUniqueOrThrow({ where: { id: matter.id } }),
      };
    });
  } catch (error) {
    if (
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002") ||
      (error instanceof HttpError && error.code === "REVISION_CONFLICT")
    ) {
      const existing = await prisma.intakeSubmission.findFirst({
        where: { draftId: id, userId: actor.id, idempotencyKey },
      });
      if (existing) {
        assertActiveReceipt(existing);
        return {
          submission: existing,
          matter: await prisma.matter.findUniqueOrThrow({
            where: { id: existing.matterId },
          }),
        };
      }
    }
    throw error;
  }
}
