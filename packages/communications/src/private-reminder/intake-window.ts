import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { prisma, type Prisma } from "@weatherly/db";
import { jsonObject } from "../../../intake/src/snapshot";
import { projectSubmitter } from "../../../intake/src/submitter";
import { lockIntakeReceiptWindow } from "../../../intake/src/receipt-clock";

const stream = "private-reminder";
const cursorWhere = (recipientId: string) => ({
  recipientId_stream: { recipientId, stream },
});
export type DigestIdentity = {
  recipientUserId: string;
  dateKey: string;
  settingsFingerprint: string;
};
const replayHours = 20;
export function replayable(attemptAt: string, now: Date) {
  return now.valueOf() - Date.parse(attemptAt) < replayHours * 3600000;
}

async function lock(tx: Prisma.TransactionClient, recipientId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"private-reminder:" + recipientId}))`;
}

export async function reserveDigestWindow(
  payload: DigestIdentity,
  key: string,
  firstStart: Date,
  end: Date,
) {
  const recipientId = payload.recipientUserId;
  return prisma.$transaction(async (tx) => {
    await lock(tx, recipientId);
    if (
      await tx.outboxJob.findUnique({
        where: { idempotencyKey: key },
        select: { id: true },
      })
    )
      return "ALREADY_SCHEDULED";
    const cursor = await tx.digestCursor.findUnique({
      where: cursorWhere(recipientId),
    });
    if (cursor?.pendingJobKey) {
      const pending = await tx.outboxJob.findUnique({
        where: { idempotencyKey: cursor.pendingJobKey },
        select: { payload: true, state: true },
      });
      if (
        pending &&
        jsonObject(pending.payload).dispatch &&
        pending.state !== "complete"
      )
        return "PREVIOUS_DELIVERY_UNCONFIRMED";
    }
    const start =
      cursor?.highWaterAt ?? cursor?.pendingWindowStart ?? firstStart;
    if (start >= end) return "ALREADY_SCHEDULED";
    await tx.outboxJob.create({
      data: { topic: "reminder.digest", idempotencyKey: key, payload },
    });
    const pending = {
      pendingWindowStart: start,
      pendingWindowEnd: end,
      pendingJobKey: key,
    };
    await tx.digestCursor.upsert({
      where: cursorWhere(recipientId),
      create: { recipientId, stream, ...pending },
      update: { ...pending, revision: { increment: 1 } },
    });
    return null;
  });
}

export async function readDigestWindow(recipientId: string, key: string) {
  const cursor = await prisma.digestCursor.findUnique({
    where: cursorWhere(recipientId),
  });
  if (!cursor) return null; // Existing queued jobs can still deliver their original deadline-only format.
  if (
    cursor.pendingJobKey !== key ||
    !cursor.pendingWindowStart ||
    !cursor.pendingWindowEnd
  )
    return false;
  return { start: cursor.pendingWindowStart, end: cursor.pendingWindowEnd };
}

export async function persistDigestRequest(
  recipientId: string,
  key: string,
  expected: Prisma.JsonValue,
  payload: Prisma.InputJsonObject,
) {
  return prisma.$transaction(async (tx) => {
    await lock(tx, recipientId);
    const cursor = await tx.digestCursor.findUnique({
      where: cursorWhere(recipientId),
    });
    if (cursor && cursor.pendingJobKey !== key) return false;
    if (expected === null) return false;
    const updated = await tx.outboxJob.updateMany({
      where: {
        idempotencyKey: key,
        topic: "reminder.digest",
        payload: { equals: expected },
      },
      data: { payload },
    });
    return updated.count === 1;
  });
}

export async function finalizeDigestWindow(
  recipientId: string,
  key: string,
  payload: Prisma.InputJsonObject,
  advance: boolean,
) {
  await prisma.$transaction(async (tx) => {
    await lock(tx, recipientId);
    const cursor = await tx.digestCursor.findUnique({
      where: cursorWhere(recipientId),
    });
    if (advance && cursor?.pendingJobKey === key && cursor.pendingWindowEnd) {
      await tx.digestCursor.update({
        where: cursorWhere(recipientId),
        data: {
          highWaterAt: cursor.pendingWindowEnd,
          pendingWindowStart: null,
          pendingWindowEnd: null,
          pendingJobKey: null,
          revision: { increment: 1 },
        },
      });
    }
    await tx.outboxJob.updateMany({
      where: { idempotencyKey: key, topic: "reminder.digest" },
      data: { payload },
    });
  });
}

export async function listDigestIntakes(window: { start: Date; end: Date }) {
  const rows = await prisma.$transaction(
    async (tx) => {
      await lockIntakeReceiptWindow(tx);
      // This statement must take its snapshot after the exclusive lock has
      // waited for intake writers, including those crossing the cutoff.
      return tx.intakeSubmission.findMany({
        where: {
          deletedAt: null,
          createdAt: { gte: window.start, lt: window.end },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { snapshot: true, userId: true, createdAt: true },
      });
    },
    { isolationLevel: "ReadCommitted" },
  );
  return Promise.all(
    rows.map(async (row) => {
      const data = jsonObject(row.snapshot);
      const { agent } = await projectSubmitter(prisma, row);
      return {
        agent: agent?.name ?? "",
        createdAt: row.createdAt,
        property:
          typeof data.propertyAddress === "string" ? data.propertyAddress : "",
        side: typeof data.side === "string" ? data.side : "",
      };
    }),
  );
}

function requestKey(secret: string, context: string) {
  return Buffer.from(
    hkdfSync(
      "sha256",
      secret,
      context,
      "Weatherly private reminder request",
      32,
    ),
  );
}

// Private request content is kept encrypted only while its delivery is uncertain.
// The transport is already required, and rotation invalidates the queued settings fingerprint.
export function sealDigestRequest(
  value: string,
  secret: string,
  context: string,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", requestKey(secret, context), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function openDigestRequest(
  value: string,
  secret: string,
  context: string,
) {
  const parts = value.split(".");
  if (parts.length !== 3 || parts.some((part) => !part))
    throw new Error("Invalid digest dispatch record.");
  const [iv, tag, encrypted] = parts.map((part) =>
    Buffer.from(part, "base64url"),
  );
  const cipher = createDecipheriv(
    "aes-256-gcm",
    requestKey(secret, context),
    iv,
  );
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString(
    "utf8",
  );
}
