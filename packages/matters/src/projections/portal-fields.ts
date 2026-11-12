import type { Prisma } from "@weatherly/db";
import { dateOnly } from "../validation/common";
import { audienceAllows } from "./deadline-fields";

export const portalClientRoles = ["client", "buyer", "seller"];

export function portalClientNames(
  people: readonly { name: string; role: string }[],
) {
  return [
    ...new Set(
      people
        .filter(({ role }) => portalClientRoles.includes(role))
        .map(({ name }) => name),
    ),
  ];
}

export function portalClosedDate(
  matter: { stage: string; details: Prisma.JsonValue },
  tasks: readonly {
    stepKey: string | null;
    actualDate: string | null;
    dueDate: string | null;
    visibility: string;
  }[],
  audience: "client" | "agent",
) {
  if (matter.stage !== "closed") return null;
  const closing = tasks.find(
    ({ stepKey, visibility }) =>
      stepKey === "closing" && audienceAllows(visibility, audience),
  );
  for (const value of [closing?.actualDate, closing?.dueDate]) {
    const parsed = dateOnly.safeParse(value);
    if (parsed.success) return parsed.data;
  }
  const details = matter.details;
  const closeOut =
    details && typeof details === "object" && !Array.isArray(details)
      ? details.closeOut
      : null;
  const at =
    closeOut && typeof closeOut === "object" && !Array.isArray(closeOut)
      ? closeOut.at
      : null;
  return typeof at === "string" && Number.isFinite(Date.parse(at)) ? at : null;
}

export function portalDocument(document: {
  id: string;
  name: string;
  mimeType: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  const { id, name, mimeType, createdAt, updatedAt } = document;
  return { id, name, mimeType, createdAt, updatedAt };
}
