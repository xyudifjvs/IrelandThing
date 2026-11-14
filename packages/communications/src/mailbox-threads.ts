import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import {
  HttpError,
  assertCoordinator,
  type Principal,
} from "@weatherly/platform";
import { requireMatter, audit, revision } from "@weatherly/matters";
import { assignDocumentToMatter } from "@weatherly/documents";
import { asRecord, textArray } from "./policy";

async function threadReadScope(
  actor: Principal,
  matterId?: string,
): Promise<Prisma.EmailThreadWhereInput> {
  if (matterId) await requireMatter(actor, matterId);
  return { ownerId: actor.id, ...(matterId ? { matterId } : {}) };
}

export async function listThreads(
  actor: Principal,
  matterId?: string,
  options: { cursor?: string; limit?: number } = {},
) {
  if (actor.role !== "coordinator") return [];
  const limit = z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(100)
    .parse(options.limit);
  const where = await threadReadScope(actor, matterId);
  if (
    options.cursor &&
    !(await prisma.emailThread.findFirst({
      where: { AND: [where, { id: options.cursor }] },
      select: { id: true },
    }))
  )
    throw new HttpError(404, "THREAD_NOT_FOUND", "Thread cursor not found");
  const pagination = {
    orderBy: [{ updatedAt: "desc" as const }, { id: "desc" as const }],
    take: limit,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  };
  return prisma.emailThread.findMany({
    where,
    ...pagination,
    include: {
      messages: {
        orderBy: [{ sentAt: "desc" }, { id: "desc" }],
        take: 100,
      },
    },
  });
}

export async function listMessages(
  actor: Principal,
  matterId?: string,
  options: { cursor?: string; limit?: number; q?: string } = {},
) {
  if (actor.role !== "coordinator") return [];
  const limit = z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(200)
    .parse(options.limit);
  const where: Prisma.EmailMessageWhereInput = {
    AND: [
      { thread: { is: await threadReadScope(actor, matterId) } },
      options.q
        ? {
            OR: [
              { subject: { contains: options.q, mode: "insensitive" } },
              { text: { contains: options.q, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };
  if (
    options.cursor &&
    !(await prisma.emailMessage.findFirst({
      where: { AND: [where, { id: options.cursor }] },
      select: { id: true },
    }))
  )
    throw new HttpError(404, "MESSAGE_NOT_FOUND", "Message cursor not found");
  const pagination = {
    orderBy: [{ sentAt: "desc" as const }, { id: "desc" as const }],
    take: limit,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  };
  const rows = await prisma.emailMessage.findMany({
    where,
    ...pagination,
    include: { thread: { select: { id: true, matterId: true } } },
  });
  return rows.map(({ thread, ...message }) => ({
    ...message,
    matterId: thread.matterId,
  }));
}

export async function associateThread(
  actor: Principal,
  id: string,
  input: unknown,
) {
  assertCoordinator(actor);
  const { matterId, expectedRevision } = z
    .object({ matterId: z.string().nullable(), expectedRevision: revision })
    .strict()
    .parse(input);
  return prisma.$transaction(async (tx) => {
    const thread = await tx.emailThread.findFirst({
      where: { id, ownerId: actor.id },
      include: { messages: true },
    });
    if (!thread)
      throw new HttpError(404, "THREAD_NOT_FOUND", "Thread not found");
    if (matterId) {
      await requireMatter(actor, matterId, true, tx);
      for (const m of thread.messages)
        for (const docId of textArray(asRecord(m.details).documentIds))
          await assignDocumentToMatter(actor, docId, matterId, tx);
    }
    const claim = await tx.emailThread.updateMany({
      where: { id, revision: expectedRevision },
      data: { revision: { increment: 1 } },
    });
    if (!claim.count)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "Thread association changed; refresh",
      );
    if (thread.matterId !== matterId) {
      for (const message of thread.messages)
        await tx.emailMessage.update({
          where: { id: message.id },
          data: {
            revision: { increment: 1 },
            details: {
              ...asRecord(message.details),
              visibility: "coordinator",
              sharingResetReason: "Matter association changed",
            },
          },
        });
    }
    const row = await tx.emailThread.update({
      where: { id },
      data: {
        matterId,
        status: matterId ? "assigned" : "unassigned",
        details: {
          ...asRecord(thread.details),
          associationReviewedBy: actor.id,
          associationReviewedAt: new Date().toISOString(),
        },
      },
    });
    await audit(
      tx,
      actor,
      "email.thread_associated",
      "EmailThread",
      id,
      matterId,
      { previousMatterId: thread.matterId },
    );
    return row;
  });
}

export async function shareMessage(
  actor: Principal,
  id: string,
  input: unknown,
) {
  assertCoordinator(actor);
  const { expectedRevision, visibility } = z
    .object({
      expectedRevision: revision,
      visibility: z.enum(["coordinator", "agent", "client"]),
    })
    .strict()
    .parse(input);
  return prisma.$transaction(async (tx) => {
    const message = await tx.emailMessage.findFirst({
      where: { id, thread: { ownerId: actor.id } },
      include: { thread: true },
    });
    if (!message)
      throw new HttpError(404, "MESSAGE_NOT_FOUND", "Message not found");
    if (visibility !== "coordinator" && !message.thread.matterId)
      throw new HttpError(
        422,
        "MATTER_REQUIRED",
        "Associate the message with a matter before sharing",
      );
    const changed = await tx.emailMessage.updateMany({
      where: { id, revision: expectedRevision },
      data: {
        revision: { increment: 1 },
        details: { ...asRecord(message.details), visibility },
      },
    });
    if (!changed.count)
      throw new HttpError(409, "REVISION_CONFLICT", "Message changed; refresh");
    await audit(
      tx,
      actor,
      "email.visibility_changed",
      "EmailMessage",
      id,
      message.thread.matterId,
      { visibility },
    );
    return tx.emailMessage.findUniqueOrThrow({ where: { id } });
  });
}
