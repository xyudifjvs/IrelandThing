import { prisma } from "@weatherly/db";
import { HttpError, type Principal } from "@weatherly/platform";

export async function jobActor(ownerId: string): Promise<Principal> {
  const user = await prisma.user.findUnique({ where: { id: ownerId } });
  if (!user || user.role !== "coordinator")
    throw new HttpError(
      403,
      "WORKER_SCOPE_DENIED",
      "Mailbox jobs require the current coordinator",
    );
  const access = await prisma.auditEvent.findFirst({
    where: {
      entityType: "User",
      entityId: ownerId,
      action: { in: ["identity.access_revoked", "identity.access_restored"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (access?.action === "identity.access_revoked")
    throw new HttpError(
      403,
      "ACCOUNT_REVOKED",
      "Mailbox owner access was revoked",
    );
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: "coordinator",
    sessionId: "worker",
  };
}
