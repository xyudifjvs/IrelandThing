import { z } from "zod";
import { prisma, type Prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import { transactionBusinessSchema } from "@weatherly/platform/handoff-contracts";
import { audit, requireMatter } from "../access";
import { matterChanged } from "../change-hook";
import { fileReviewPending } from "../file-review";
import { json, revision } from "../validation/common";

const businessChange = z
  .object({ expectedRevision: revision, business: transactionBusinessSchema })
  .strict();
const existingTerms = z.object({
  code: z.enum(["essentials", "complete"]),
  name: z.string().trim().min(1).max(200),
  priceCents: z.number().int().positive(),
  currency: z.literal("USD"),
  revision: z.number().int().positive(),
  capturedAt: z.iso.datetime().optional(),
});

async function termsForPackage(
  tx: Prisma.TransactionClient,
  matterId: string,
  packageCode: string,
  currentTerms: unknown,
  fromHto: boolean,
) {
  // All payment writers take the file lock before deciding which service order is current.
  const orders = await tx.paymentOrder.findMany({
    where: {
      matterId,
      kind: "service",
      OR: [
        { status: { notIn: ["expired", "failed", "refunded", "cancelled"] } },
        {
          details: {
            path: ["terminationVoid", "creationOutcomeUncertain"],
            equals: true,
          },
        },
      ],
    },
    select: {
      snapshot: true,
      amountCents: true,
      currency: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const retained = orders[0];
  if (retained) {
    const saved = existingTerms.safeParse(retained.snapshot);
    if (
      !saved.success ||
      saved.data.code !== packageCode ||
      orders.some((order) => {
        const terms = existingTerms.safeParse(order.snapshot);
        return (
          !terms.success ||
          terms.data.code !== packageCode ||
          terms.data.priceCents !== order.amountCents ||
          order.amountCents !== saved.data.priceCents ||
          order.currency !== saved.data.currency
        );
      })
    )
      throw new HttpError(
        409,
        "EXISTING_SERVICE_ORDER",
        "Resolve the current service payment request before changing its approved package.",
      );
    return { ...saved.data, capturedAt: retained.createdAt.toISOString() };
  }
  const stored = existingTerms.safeParse(currentTerms);
  if (stored.success && stored.data.code === packageCode) return stored.data;
  if (fromHto) {
    const history = await tx.auditEvent.findFirst({
      where: {
        matterId,
        action: "matter.business_changed",
        details: { path: ["business"], equals: "hto" },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { details: true },
    });
    const prior = existingTerms.safeParse(
      json.safeParse(history?.details).data?.previousServiceSnapshot,
    );
    if (prior.success && prior.data.code === packageCode) return prior.data;
  }
  const catalog = await tx.catalogItem.findUnique({
    where: { code: packageCode },
  });
  const parsed = existingTerms.safeParse(catalog);
  if (!catalog?.approved || !parsed.success)
    throw new HttpError(
      409,
      "CATALOG_UNAPPROVED",
      "Approve the designated service before changing this file's business.",
    );
  return { ...parsed.data, capturedAt: new Date().toISOString() };
}

export async function changeFileBusiness(
  actor: Principal,
  matterId: string,
  raw: unknown,
) {
  assertCoordinator(actor);
  const { expectedRevision, business } = businessChange.parse(raw);
  return prisma.$transaction(async (tx) => {
    const matter = await requireMatter(actor, matterId, true, tx);
    if (matter.revision !== expectedRevision)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "This file changed. Refresh before changing its business.",
      );
    if (
      fileReviewPending(matter) ||
      !["listing", "under_contract", "closing"].includes(matter.stage)
    )
      throw new HttpError(
        409,
        "TRANSACTION_READ_ONLY",
        "Choose an active transaction to change its business.",
      );
    if (
      matter.business === business.business &&
      matter.packageCode === business.packageCode
    )
      return { matterId, revision: matter.revision, ...business };
    const { serviceSnapshot: priorTerms, ...details } = json.parse(
      matter.details,
    );
    const terms =
      business.business === "weatherly"
        ? await termsForPackage(
            tx,
            matterId,
            business.packageCode,
            priorTerms,
            matter.business === "hto",
          )
        : null;
    const next = await tx.matter.update({
      where: { id: matterId },
      data: {
        ...business,
        details: {
          ...details,
          ...(terms
            ? {
                serviceSnapshot: {
                  ...terms,
                  dueAtClosing: true,
                  noFeeIfTerminatedBeforeClosing: true,
                },
              }
            : {}),
        },
        revision: { increment: 1 },
      },
      select: { revision: true },
    });
    await audit(
      tx,
      actor,
      "matter.business_changed",
      "Matter",
      matterId,
      matterId,
      {
        previousBusiness: matter.business,
        previousPackageCode: matter.packageCode,
        previousServiceSnapshot: priorTerms ?? null,
        ...business,
      },
    );
    await matterChanged(tx, actor, matterId);
    return { matterId, revision: next.revision, ...business };
  });
}
