import { type Principal, HttpError, assertCoordinator } from "@weatherly/platform";
import { type Prisma, prisma } from "@weatherly/db";

export function matterScope(actor: Principal): Prisma.MatterWhereInput {
  return actor.role === "coordinator"
    ? {}
    : {
        OR: [
          { agentId: actor.id },
          { participants: { some: { userId: actor.id, revokedAt: null } } },
        ],
      };
}

export async function requireMatter(
  actor: Principal,
  id: string,
  write = false,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const matter = await db.matter.findFirst({
    where: { id, ...matterScope(actor) },
  });
  if (!matter) throw new HttpError(404, "MATTER_NOT_FOUND", "Matter not found");
  if (write) {
    assertCoordinator(actor);
    if (db !== prisma) {
      await db.$queryRaw`SELECT "id" FROM "Matter" WHERE "id" = ${id} FOR UPDATE`;
      // A competing writer may have committed while this lock was waiting.
      // Validate the authorized, current row rather than the pre-lock snapshot.
      const current = await db.matter.findFirst({
        where: { id, ...matterScope(actor) },
      });
      if (!current)
        throw new HttpError(404, "MATTER_NOT_FOUND", "Matter not found");
      return current;
    }
  }
  return matter;
}

export async function audit(
  db: Prisma.TransactionClient | typeof prisma,
  actor: Principal,
  action: string,
  entityType: string,
  entityId: string,
  matterId: string | null,
  details: Prisma.InputJsonValue = {},
) {
  await db.auditEvent.create({
    data: {
      actorId: actor.id,
      action,
      entityType,
      entityId,
      matterId,
      details,
    },
  });
}
