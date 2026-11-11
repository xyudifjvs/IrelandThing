import { type Principal, assertCoordinator, HttpError } from "@weatherly/platform";
import { type Prisma, prisma } from "@weatherly/db";
import { z } from "zod";
import { revision, dateOnly } from "../validation/common";
import { requireMatter, audit } from "../access";
import { recalculateWorkflow } from "../rules";
import { resolveDateFollowup } from "./date-followup";
import { matterChanged } from "../change-hook";

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
