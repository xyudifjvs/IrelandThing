import { prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import { z } from "zod";
import { requireMatter } from "../access";

const idSchema = z.string().trim().min(1).max(200);
const revisionSchema = z.number().int().positive();
const scopeSchema = z.object({ matterId: idSchema.optional() }).strict();
const todoSelection = {
  id: true,
  matterId: true,
  body: true,
  completedAt: true,
  revision: true,
  matter: { select: { propertyAddress: true } },
} as const;

const changed = () =>
  new HttpError(
    409,
    "PRIVATE_NOTE_CHANGED",
    "This item changed. Refresh and try again.",
  );

export async function listPrivateTodos(actor: Principal, input: unknown) {
  assertCoordinator(actor);
  const { matterId, cursor, limit } = scopeSchema
    .extend({
      cursor: idSchema.optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    })
    .parse(input);
  const where = { ownerId: actor.id, ...(matterId ? { matterId } : {}) };
  return prisma.$transaction(async (tx) => {
    if (
      cursor &&
      !(await tx.privateTodo.findFirst({
        where: { ...where, id: cursor },
        select: { id: true },
      }))
    ) {
      throw new HttpError(
        404,
        "PRIVATE_NOTE_NOT_FOUND",
        "This item is no longer available.",
      );
    }
    const items = await tx.privateTodo.findMany({
      where,
      select: todoSelection,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const total = await tx.privateTodo.count({ where });
    return {
      items: items.slice(0, limit),
      total,
      nextCursor: items.length > limit ? items[limit - 1].id : null,
    };
  });
}

export async function addPrivateTodo(actor: Principal, input: unknown) {
  assertCoordinator(actor);
  const { body, matterId } = scopeSchema
    .extend({ body: z.string().trim().min(1).max(5000) })
    .parse(input);
  return prisma.$transaction(async (tx) => {
    if (matterId) {
      const matter = await requireMatter(actor, matterId, true, tx);
      if (!["under_contract", "closing", "listing"].includes(matter.stage)) {
        throw new HttpError(
          409,
          "INACTIVE_FILE",
          "Choose an active transaction for this item.",
        );
      }
    }
    return tx.privateTodo.create({
      data: { ownerId: actor.id, matterId, body },
      select: todoSelection,
    });
  });
}

export async function setPrivateTodoCompletion(
  actor: Principal,
  id: string,
  input: unknown,
) {
  assertCoordinator(actor);
  const { expectedRevision, completed } = z
    .object({ expectedRevision: revisionSchema, completed: z.boolean() })
    .strict()
    .parse(input);
  return prisma.$transaction(async (tx) => {
    const result = await tx.privateTodo.updateMany({
      where: { id, ownerId: actor.id, revision: expectedRevision },
      data: {
        completedAt: completed ? new Date() : null,
        revision: { increment: 1 },
      },
    });
    if (!result.count) throw changed();
    return tx.privateTodo.findUniqueOrThrow({
      where: { id },
      select: todoSelection,
    });
  });
}

export async function removePrivateTodo(
  actor: Principal,
  id: string,
  input: unknown,
) {
  assertCoordinator(actor);
  const { expectedRevision } = z
    .object({ expectedRevision: revisionSchema })
    .strict()
    .parse(input);
  const result = await prisma.privateTodo.deleteMany({
    where: { id, ownerId: actor.id, revision: expectedRevision },
  });
  if (!result.count) throw changed();
  return { removed: true };
}

export async function clearCompletedPrivateTodos(
  actor: Principal,
  input: unknown,
) {
  assertCoordinator(actor);
  const { matterId } = scopeSchema.parse(input);
  const { count } = await prisma.privateTodo.deleteMany({
    where: {
      ownerId: actor.id,
      completedAt: { not: null },
      ...(matterId ? { matterId } : {}),
    },
  });
  return { removed: count };
}

const scratchpadSelection = { body: true, revision: true } as const;

export async function readPrivateScratchpad(actor: Principal) {
  assertCoordinator(actor);
  return (
    (await prisma.privateScratchpad.findUnique({
      where: { ownerId: actor.id },
      select: scratchpadSelection,
    })) ?? { body: "", revision: 0 }
  );
}

export async function savePrivateScratchpad(actor: Principal, input: unknown) {
  assertCoordinator(actor);
  const { body, expectedRevision } = z
    .object({
      body: z.string().max(50000),
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict()
    .parse(input);
  return prisma.$transaction(async (tx) => {
    const result =
      expectedRevision === 0
        ? await tx.privateScratchpad.createMany({
            data: { ownerId: actor.id, body },
            skipDuplicates: true,
          })
        : await tx.privateScratchpad.updateMany({
            where: { ownerId: actor.id, revision: expectedRevision },
            data: { body, revision: { increment: 1 } },
          });
    if (!result.count) {
      throw new HttpError(
        409,
        "SCRATCHPAD_CHANGED",
        "My notes changed in another window. Your draft is preserved.",
      );
    }
    return tx.privateScratchpad.findUniqueOrThrow({
      where: { ownerId: actor.id },
      select: scratchpadSelection,
    });
  });
}
