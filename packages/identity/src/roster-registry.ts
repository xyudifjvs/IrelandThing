import type { Prisma } from "@weatherly/db";

export function normalizeRosterEmail(email: string) {
  return email.trim().toLowerCase();
}

export const newestRosterInvitations = [
  { createdAt: "desc" },
  { id: "desc" },
] satisfies Prisma.InvitationOrderByWithRelationInput[];

export function matchingRosterInvitations<
  T extends { email: string; rosterAgentId: string | null },
>(invitations: readonly T[], roster: { id: string; email: string | null }) {
  if (!roster.email) return [];
  const email = normalizeRosterEmail(roster.email);
  return invitations.filter(
    (invitation) =>
      (invitation.rosterAgentId === null ||
        invitation.rosterAgentId === roster.id) &&
      normalizeRosterEmail(invitation.email) === email,
  );
}

/** The email key serializes lead capture, roster enrollment and invite acceptance. */
export async function lockRosterEmail(
  tx: Prisma.TransactionClient,
  email: string,
) {
  const key = normalizeRosterEmail(email);
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(546204187, hashtext(${key}))`;
  return key;
}

export async function captureRosterLead(
  tx: Prisma.TransactionClient,
  input: { email: string; name?: string; phone?: string; brokerage?: string },
) {
  const email = await lockRosterEmail(tx, input.email);
  const existing = await tx.rosterAgent.findUnique({
    where: { normalizedEmail: email },
  });
  const name = input.name?.trim().slice(0, 150) || "";
  const phone = input.phone?.trim().slice(0, 60) || null;
  const brokerage = input.brokerage?.trim().slice(0, 250) || null;
  if (!existing) {
    return tx.rosterAgent.create({
      data: {
        name: name || email,
        email,
        normalizedEmail: email,
        phone,
        brokerage,
        business: "weatherly",
      },
    });
  }
  const fields = {
    ...((!existing.name || existing.name === email) && name ? { name } : {}),
    ...(!existing.phone && phone ? { phone } : {}),
    ...(!existing.brokerage && brokerage ? { brokerage } : {}),
  };
  if (!Object.keys(fields).length) return existing;
  return tx.rosterAgent.update({
    where: { id: existing.id },
    data: { ...fields, revision: { increment: 1 } },
  });
}
