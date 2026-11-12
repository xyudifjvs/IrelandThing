import type { Prisma } from "@weatherly/db";

export function documentAudienceWhere(
  role: "agent" | "client",
): Prisma.DocumentWhereInput {
  const legacy = role === "client" ? "client" : { in: ["agent", "client"] };
  return {
    category: { not: "service_agreement" },
    OR: [
      role === "agent" ? { shareWithAgent: true } : { shareWithClient: true },
      role === "agent"
        ? { shareWithAgent: null, visibility: legacy }
        : { shareWithClient: null, visibility: legacy },
    ],
  };
}

export const portalDocumentSelect = {
  id: true,
  name: true,
  mimeType: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.DocumentSelect;
