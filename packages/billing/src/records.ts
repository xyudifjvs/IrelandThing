import { z } from "zod";
import { prisma, type Prisma } from "@weatherly/db";
import { type Principal } from "@weatherly/platform";
import { requireMatter, matterScope } from "@weatherly/matters";
import { lockPaymentMatter, paymentOrderForRead } from "./checkout-policy";

export async function listCatalog() {
  return prisma.catalogItem.findMany({
    where: { code: { in: ["essentials", "complete", "full_listing"] } },
    orderBy: { priceCents: "asc" },
  });
}
const pageOptions = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(200),
});
export async function listPayments(
  actor: Principal,
  matterId?: string,
  options: { cursor?: string; limit?: number } = {},
) {
  const page = pageOptions.parse(options);
  if (matterId) await requireMatter(actor, matterId);
  if (actor.role === "client") return [];
  const matters = await prisma.matter.findMany({
    where: { ...matterScope(actor), ...(matterId ? { id: matterId } : {}) },
    select: { id: true, business: true },
  });
  const orders = await prisma.paymentOrder.findMany({
    where:
      actor.role === "coordinator"
        ? matterId
          ? { matterId }
          : {}
        : {
            OR: [
              {
                matterId: { in: matters.map((matter) => matter.id) },
                kind: { not: "service" },
              },
              {
                matterId: {
                  in: matters
                    .filter((matter) => matter.business !== "hto")
                    .map((matter) => matter.id),
                },
                kind: "service",
              },
            ],
          },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: page.limit,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  });
  return orders.map(paymentOrderForRead);
}

export async function listGifts(
  actor: Principal,
  matterId?: string,
  options: { cursor?: string; limit?: number } = {},
) {
  const page = pageOptions.parse(options);
  if (matterId) await requireMatter(actor, matterId);
  if (actor.role === "client") return [];
  const matters = await prisma.matter.findMany({
    where: { ...matterScope(actor), ...(matterId ? { id: matterId } : {}) },
    select: { id: true },
  });
  return prisma.giftOrder.findMany({
    where: { matterId: { in: matters.map((m) => m.id) } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: page.limit,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  });
}
export async function recordIntakeGift(matterId: string, submissionId: string) {
  await prisma.$transaction(async (tx) => {
    const matter = await lockPaymentMatter(tx, matterId);
    await tx.$queryRaw`SELECT id FROM "IntakeSubmission" WHERE id = ${submissionId} FOR UPDATE`;
    const submission = await tx.intakeSubmission.findUnique({
      where: { id: submissionId },
    });
    if (!submission || submission.matterId !== matterId)
      throw new Error("Intake submission missing");
    if (!matter || submission.deletedAt) return;
    const snapshot = submission.snapshot as Record<string, unknown>;
    const gift = snapshot.gift;
    if (
      !gift ||
      typeof gift !== "object" ||
      (gift as { requested?: boolean }).requested === false
    )
      return;
    await tx.giftOrder.upsert({
      where: { id: `intake-gift-${submissionId}` },
      create: {
        id: `intake-gift-${submissionId}`,
        matterId,
        selection: gift as Prisma.InputJsonValue,
        status: "awaiting_catalog",
      },
      update: {},
    });
  });
}
