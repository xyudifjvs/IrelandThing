import type { Prisma } from "@weatherly/db";
import { HttpError } from "@weatherly/platform";
import { entityIdSchema } from "@weatherly/platform/handoff-contracts";
import { z } from "zod";

function fullName(person: { firstName: string; lastName: string }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

const clientInput = z
  .object({
    id: entityIdSchema.optional(),
    firstName: z.string().trim().max(200),
    lastName: z.string().trim().max(200),
    email: z
      .string()
      .trim()
      .pipe(z.union([z.literal(""), z.email().max(254)])),
    phone: z.string().trim().max(60),
  })
  .strict()
  .refine(
    (person) => fullName(person).length >= 1 && fullName(person).length <= 200,
    "Enter a client name of at most 200 characters.",
  );

export const fileClientsInput = z
  .array(clientInput)
  .max(100)
  .refine((people) => {
    const ids = people.flatMap(({ id }) => (id ? [id] : []));
    return new Set(ids).size === ids.length;
  }, "Include each saved client at most once.");

export async function writeFileClients(
  tx: Prisma.TransactionClient,
  matterId: string,
  clients: z.infer<typeof fileClientsInput>,
) {
  const existing = await tx.matterContact.findMany({
    where: {
      matterId,
      retiredAt: null,
      role: { in: ["client", "buyer", "seller"] },
    },
    select: { id: true, name: true, email: true, phone: true },
  });
  const byId = new Map(existing.map((person) => [person.id, person]));
  if (clients.some(({ id }) => id && !byId.has(id)))
    throw new HttpError(
      422,
      "INVALID_FILE_CLIENT",
      "Select an active client from this transaction.",
    );

  const kept = new Map<string, { firstName: string; lastName: string }>();
  for (const client of clients) {
    const { id, firstName, lastName, email, phone } = client;
    const name = fullName(client);
    const prior = id ? byId.get(id) : undefined;
    if (prior) {
      if (name !== prior.name || email !== prior.email || phone !== prior.phone)
        await tx.matterContact.update({
          where: { id: prior.id },
          data: { name, email, phone, revision: { increment: 1 } },
        });
      kept.set(prior.id, { firstName, lastName });
    } else {
      const added = await tx.matterContact.create({
        data: { matterId, role: "client", name, email, phone },
        select: { id: true },
      });
      kept.set(added.id, { firstName, lastName });
    }
  }
  const retired = existing
    .filter(({ id }) => !kept.has(id))
    .map(({ id }) => id);
  if (retired.length)
    await tx.matterContact.updateMany({
      where: { matterId, id: { in: retired } },
      data: { retiredAt: new Date(), revision: { increment: 1 } },
    });
  return Object.fromEntries(kept);
}
