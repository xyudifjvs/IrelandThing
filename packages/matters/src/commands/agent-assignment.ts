import type { Prisma } from "@weatherly/db";
import { HttpError } from "@weatherly/platform";

export async function resolveAgentAssignment(
  tx: Prisma.TransactionClient,
  facts: { agentId: string | null; agentRosterId: string | null },
) {
  let agentId = facts.agentId;
  if (facts.agentRosterId) {
    const roster = await tx.rosterAgent.findUnique({
      where: { id: facts.agentRosterId },
      select: { userId: true, archivedAt: true },
    });
    if (!roster || roster.archivedAt || (agentId && roster.userId !== agentId))
      throw new HttpError(
        422,
        "INVALID_AGENT_ROSTER",
        "Select an active roster entry consistent with the assigned agent.",
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
