import type { Prisma } from "@weatherly/db";

export const portalPersonSelect = {
  id: true,
  role: true,
  name: true,
  email: true,
  phone: true,
} as const satisfies Prisma.MatterContactSelect;

export function peopleAudienceWhere(
  role: "agent" | "client",
): Prisma.MatterContactWhereInput {
  return {
    retiredAt: null,
    ...(role === "agent"
      ? { shareWithAgent: true }
      : { shareWithClient: true }),
  };
}
