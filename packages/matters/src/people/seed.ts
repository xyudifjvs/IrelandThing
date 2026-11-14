import type { Prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import type { CreationPerson } from "@weatherly/platform/handoff-contracts";
import { personRoleKey } from "./role";

const titleRoles = new Set(["title_rep", "title_company", "title"]);
const lenderRoles = new Set(["lender", "loan_officer"]);
const ownAgentRoles = new Set(["my_agent", "agent"]);

export async function seedMatterPeople(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
  people: readonly CreationPerson[],
) {
  assertCoordinator(actor);
  const matter = await tx.matter.findUniqueOrThrow({
    where: { id: matterId },
    select: { side: true },
  });
  if (await tx.matterContact.count({ where: { matterId } }))
    throw new HttpError(
      409,
      "PEOPLE_ALREADY_SEEDED",
      "This file already has people.",
    );

  await tx.matterContact.createMany({
    data: people.map((person) => {
      const role = personRoleKey(person.role);
      return {
        ...person,
        role,
        matterId,
        shareWithAgent: true,
        shareWithClient:
          ownAgentRoles.has(role) ||
          titleRoles.has(role) ||
          (matter.side === "buyer" && lenderRoles.has(role)),
      };
    }),
  });
}
