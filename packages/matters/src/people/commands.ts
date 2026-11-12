import { prisma, type Prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import {
  creationPersonSchema,
  entityIdSchema,
} from "@weatherly/platform/handoff-contracts";
import { z } from "zod";
import { audit, requireMatter } from "../access";
import { matterChanged } from "../change-hook";
import { revision } from "../validation/common";
import {
  contactIdentityKey,
  contactInput,
} from "../../../contacts/src/contact-fields";
import { contactRoleFamily } from "../../../contacts/src/transaction-sources";
import { fileReviewPending } from "../file-review";
import { personRoleKey } from "./role";

const addInput = creationPersonSchema.extend({
  directory: z
    .object({ id: entityIdSchema, expectedRevision: revision })
    .strict()
    .optional(),
  replace: z
    .object({ id: entityIdSchema, expectedRevision: revision })
    .strict()
    .optional(),
});

const updateInput = creationPersonSchema.partial().extend({
  expectedRevision: revision,
  shareWithAgent: z.boolean().optional(),
  shareWithClient: z.boolean().optional(),
});

async function requireEditablePeople(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
) {
  const matter = await requireMatter(actor, matterId, true, tx);
  if (
    fileReviewPending(matter) ||
    !["under_contract", "closing", "listing"].includes(matter.stage)
  )
    throw new HttpError(
      409,
      "TRANSACTION_READ_ONLY",
      "Choose an active transaction to change its people.",
    );
}

async function getCurrentPerson(
  tx: Prisma.TransactionClient,
  matterId: string,
  personId: string,
  expectedRevision: number,
) {
  const person = await tx.matterContact.findFirst({
    where: { id: personId, matterId, retiredAt: null },
  });
  if (!person)
    throw new HttpError(
      404,
      "PERSON_NOT_FOUND",
      "This person is no longer on the transaction.",
    );
  if (person.revision !== expectedRevision)
    throw new HttpError(
      409,
      "REVISION_CONFLICT",
      "This person changed. Refresh before editing.",
    );
  return person;
}

async function recordPeopleChange(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
  personId: string,
  action: string,
) {
  await tx.matter.update({
    where: { id: matterId },
    data: { revision: { increment: 1 } },
  });
  await audit(tx, actor, action, "MatterContact", personId, matterId);
  await matterChanged(tx, actor, matterId);
}

async function saveDirectorySnapshot(
  tx: Prisma.TransactionClient,
  actor: Principal,
  person: z.infer<typeof creationPersonSchema>,
) {
  const role = personRoleKey(person.role);
  const family = contactRoleFamily(role);
  const kind =
    family === "title"
      ? "title_rep"
      : family === "lender"
        ? "lender"
        : family === "coop"
          ? "co_op_agent"
          : ["agent", "my_agent"].includes(role)
            ? "agent"
            : "other";
  const data = contactInput.parse({
    kind,
    name: person.name,
    company: person.company,
    email: person.email,
    phone: person.phone,
  });
  const identityKey = contactIdentityKey(data);
  const now = new Date();
  const contact = await tx.businessContact.upsert({
    where: { ownerId_identityKey: { ownerId: actor.id, identityKey } },
    create: {
      ...data,
      ownerId: actor.id,
      identityKey,
      usageCount: 1,
      lastUsedAt: now,
    },
    update: { usageCount: { increment: 1 }, lastUsedAt: now },
    select: { id: true },
  });
  return contact.id;
}

export async function addMatterPerson(
  actor: Principal,
  matterId: string,
  input: unknown,
) {
  assertCoordinator(actor);
  const { directory, replace, ...data } = addInput.parse(input);
  return prisma.$transaction(async (tx) => {
    await requireEditablePeople(tx, actor, matterId);
    if (directory) {
      const contact = await tx.businessContact.updateMany({
        where: {
          id: directory.id,
          ownerId: actor.id,
          revision: directory.expectedRevision,
        },
        data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
      });
      if (!contact.count)
        throw new HttpError(
          409,
          "CONTACT_CHANGED",
          "Refresh the directory contact before adding it.",
        );
    }
    const role = personRoleKey(data.role);
    if (replace) {
      const previous = await getCurrentPerson(
        tx,
        matterId,
        replace.id,
        replace.expectedRevision,
      );
      if (personRoleKey(previous.role) !== role)
        throw new HttpError(
          422,
          "PERSON_ROLE_MISMATCH",
          "Replace someone who has the same role.",
        );
      await tx.matterContact.update({
        where: { id: previous.id },
        data: { retiredAt: new Date(), revision: { increment: 1 } },
      });
    }
    const directoryContactId =
      directory?.id ?? (await saveDirectorySnapshot(tx, actor, data));
    const person = await tx.matterContact.create({
      data: { ...data, role, matterId, directoryContactId },
    });
    await recordPeopleChange(
      tx,
      actor,
      matterId,
      person.id,
      replace ? "person.replaced" : "person.added",
    );
    return person;
  });
}

export async function updateMatterPerson(
  actor: Principal,
  matterId: string,
  personId: string,
  input: unknown,
  retire = false,
) {
  assertCoordinator(actor);
  const { expectedRevision, ...changes } = updateInput.parse(input);
  return prisma.$transaction(async (tx) => {
    await requireEditablePeople(tx, actor, matterId);
    await getCurrentPerson(tx, matterId, personId, expectedRevision);
    const person = await tx.matterContact.update({
      where: { id: personId },
      data: {
        ...(retire
          ? { retiredAt: new Date() }
          : {
              ...changes,
              role: changes.role ? personRoleKey(changes.role) : undefined,
            }),
        revision: { increment: 1 },
      },
    });
    await recordPeopleChange(
      tx,
      actor,
      matterId,
      person.id,
      retire ? "person.retired" : "person.updated",
    );
    return retire ? { id: person.id, retired: true } : person;
  });
}
