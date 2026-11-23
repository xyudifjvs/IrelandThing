import { prisma, type Prisma } from "@weatherly/db";

const fallbackEmail = "ireland@weatherlytc.com";
/** Resolve the same current profile email displayed in coordinator Settings. */
export async function portalCoordinatorEmail(matter: {
  id: string;
  details: Prisma.JsonValue;
}) {
  const review = await prisma.creationReview.findUnique({
    where: { confirmedMatterId: matter.id },
    select: { owner: { select: { email: true, role: true } } },
  });
  if (review?.owner.role === "coordinator") return review.owner.email;
  const details =
    matter.details &&
    typeof matter.details === "object" &&
    !Array.isArray(matter.details)
      ? matter.details
      : {};
  const recorded = details.fileReview;
  const ownerId =
    recorded &&
    typeof recorded === "object" &&
    !Array.isArray(recorded) &&
    typeof recorded.confirmedById === "string"
      ? recorded.confirmedById
      : null;
  if (ownerId) {
    const owner = await prisma.user.findFirst({
      where: { id: ownerId, role: "coordinator" },
      select: { email: true },
    });
    if (owner) return owner.email;
  }
  // Historical files have no owner relation. Never choose an arbitrary account.
  const owners = await prisma.user.findMany({
    where: { role: "coordinator" },
    select: { email: true },
    take: 2,
  });
  return owners.length === 1 ? owners[0].email : fallbackEmail;
}
