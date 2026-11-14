import { prisma } from "@weatherly/db";
import { assertCoordinator, type Principal } from "@weatherly/platform";
import { intakeContractIds, jsonObject } from "../../../intake/src/snapshot";
import { projectSubmitter } from "../../../intake/src/submitter";

export async function listNewIntakes(
  actor: Principal,
  page: number,
  limit: number,
) {
  assertCoordinator(actor);
  const where = { processedAt: null, deletedAt: null };
  return prisma.$transaction(
    async (tx) => {
      const [total, records] = await Promise.all([
        tx.intakeSubmission.count({ where }),
        tx.intakeSubmission.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            matterId: true,
            snapshot: true,
            userId: true,
            createdAt: true,
            documents: {
              select: {
                id: true,
                category: true,
                versions: { select: { id: true }, take: 1 },
              },
            },
          },
        }),
      ]);
      const contractIds = [
        ...new Set(
          records.flatMap((row) => [...intakeContractIds(row.snapshot)]),
        ),
      ];
      const legacyDocuments = await tx.document.findMany({
        where: {
          id: { in: contractIds },
          matterId: { in: records.map((row) => row.matterId) },
        },
        select: {
          id: true,
          matterId: true,
          versions: { select: { id: true }, take: 1 },
        },
      });
      const items = await Promise.all(
        records.map(async (row) => {
          const data = jsonObject(row.snapshot);
          const ids = intakeContractIds(row.snapshot);
          const { agent } = await projectSubmitter(tx, row);
          return {
            id: row.id,
            propertyAddress:
              typeof data.propertyAddress === "string"
                ? data.propertyAddress
                : "",
            agentName: agent?.name ?? null,
            side: typeof data.side === "string" ? data.side : "",
            createdAt: row.createdAt,
            hasContract:
              row.documents.some(
                (document) =>
                  (document.category === "contract" || ids.has(document.id)) &&
                  document.versions.length > 0,
              ) ||
              legacyDocuments.some(
                (document) =>
                  document.matterId === row.matterId &&
                  ids.has(document.id) &&
                  document.versions.length > 0,
              ),
          };
        }),
      );
      return { total, items, page, limit };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
