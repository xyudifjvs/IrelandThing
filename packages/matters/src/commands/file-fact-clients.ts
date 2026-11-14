import type { Prisma } from "@weatherly/db";
import { HttpError } from "@weatherly/platform";
import { entityIdSchema } from "@weatherly/platform/handoff-contracts";
import { z } from "zod";

function fullName(person: { firstName?: string; lastName?: string }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

const structuredName = z.object({
  firstName: z.string().trim().max(200),
  lastName: z.string().trim().max(200),
});

const clientInput = structuredName
  .partial()
  .extend({
    id: entityIdSchema.optional(),
    email: z
      .string()
      .trim()
      .pipe(z.union([z.literal(""), z.email().max(254)])),
    phone: z.string().trim().max(60),
  })
  .strict()
  .refine((person) => {
    const length = fullName(person).length;
    return length <= 200 && (length > 0 || Boolean(person.id));
  }, "Enter a name of at most 200 characters for each new client.");

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
  structuredNames: unknown,
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

  const savedNames =
    z.record(z.string(), z.unknown()).safeParse(structuredNames).data ?? {};
  const kept = new Set<string>();
  const confirmedNames = new Map<string, z.infer<typeof structuredName>>();
  for (const client of clients) {
    const { id, firstName = "", lastName = "", email, phone } = client;
    const suppliedName = fullName(client);
    const prior = id ? byId.get(id) : undefined;
    if (prior) {
      const name = suppliedName || prior.name;
      if (name !== prior.name || email !== prior.email || phone !== prior.phone)
        await tx.matterContact.update({
          where: { id: prior.id },
          data: { name, email, phone, revision: { increment: 1 } },
        });
      kept.add(prior.id);
      const saved = structuredName.safeParse(savedNames[prior.id]).data;
      if (suppliedName) confirmedNames.set(prior.id, { firstName, lastName });
      else if (saved && fullName(saved) && fullName(saved) === prior.name)
        confirmedNames.set(prior.id, saved);
    } else {
      const added = await tx.matterContact.create({
        data: { matterId, role: "client", name: suppliedName, email, phone },
        select: { id: true },
      });
      confirmedNames.set(added.id, { firstName, lastName });
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
  return Object.fromEntries(confirmedNames);
}
