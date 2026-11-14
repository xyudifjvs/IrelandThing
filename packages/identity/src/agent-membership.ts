import { prisma, type Prisma } from "@weatherly/db";
import type { Business } from "@weatherly/platform/handoff-contracts";

export type AgentMembership = {
  business: Business;
  rosterAgentId: string | null;
};

/** The linked, current roster supplies defaults for new work. File business is stored separately. */
export async function getAgentMembership(
  userId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<AgentMembership> {
  const entry = await db.rosterAgent.findFirst({
    where: { userId, archivedAt: null, user: { role: "agent" } },
    select: { id: true, business: true },
  });
  return {
    business: entry?.business ?? "weatherly",
    rosterAgentId: entry?.id ?? null,
  };
}

export async function hasAgentAgreementAccess(
  userId: string,
  db: Prisma.TransactionClient = prisma,
) {
  if ((await getAgentMembership(userId, db)).business === "hto") return true;
  const agreement = await db.agreement.findFirst({
    where: { userId, status: "approved", documentId: { not: null } },
    select: { id: true },
  });
  if (agreement) return true;
  const override = await db.auditEvent.findFirst({
    where: {
      entityType: "User",
      entityId: userId,
      action: "agent.access_override",
    },
    select: { id: true },
  });
  return !!override;
}
