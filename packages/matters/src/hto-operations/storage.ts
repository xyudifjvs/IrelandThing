import { prisma, type Prisma } from "@weatherly/db";
import { HttpError } from "@weatherly/platform";
import { fileReviewPending } from "../file-review";

export const eligibleStages = [
  "listing",
  "under_contract",
  "closing",
  "closed",
  "terminated",
];

export const htoMatterInclude = {
  rosterAgent: { select: { id: true, name: true } },
  agent: { select: { id: true, name: true } },
  contacts: {
    where: { retiredAt: null, role: { in: ["client", "buyer", "seller"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  tasks: {
    where: { stepKey: "closing" },
    select: {
      dueDate: true,
      actualDate: true,
      status: true,
      dateCapable: true,
    },
  },
} satisfies Prisma.MatterInclude;

export const htoInclude = {
  manualAgent: { select: { id: true, name: true } },
  matter: { include: htoMatterInclude },
} satisfies Prisma.HtoClosingInclude;
export type StoredHtoClosing = Prisma.HtoClosingGetPayload<{
  include: typeof htoInclude;
}>;
export type HtoMatter = NonNullable<StoredHtoClosing["matter"]>;
export type HtoDb = Prisma.TransactionClient | typeof prisma;

export function eligibleMatter(matter: {
  business: string | null;
  stage: string;
  details: Prisma.JsonValue;
}) {
  return (
    matter.business === "hto" &&
    eligibleStages.includes(matter.stage) &&
    !fileReviewPending(matter)
  );
}

export async function lockHtoOperations(tx: Prisma.TransactionClient) {
  // File hooks and linked edits already hold the Matter lock. Manual changes
  // hold only this lock so matching cannot race a manual edit or deadlock a file.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('weatherly.hto-operations', 0))`;
}

export async function isHtoTeamMember(db: HtoDb, id: string | null) {
  if (!id) return false;
  return Boolean(
    await db.rosterAgent.findFirst({
      where: { id, business: "hto", archivedAt: null },
      select: { id: true },
    }),
  );
}

export async function requireHtoTeamMember(db: HtoDb, id: string | null) {
  if (id && !(await isHtoTeamMember(db, id)))
    throw new HttpError(
      422,
      "HTO_AGENT_REQUIRED",
      "Select an active Home Team Ohio team member.",
    );
}

export function decimalCents(value: Prisma.Decimal | null) {
  const cents = value?.toNumber();
  return cents !== undefined && Number.isSafeInteger(cents) && cents >= 0
    ? cents
    : null;
}

export function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
