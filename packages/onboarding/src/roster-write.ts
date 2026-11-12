import { prisma, type Prisma } from "@weatherly/db";
import {
  captureRosterLead,
  lockRosterEmail,
  normalizeRosterEmail,
} from "@weatherly/identity/roster";
import { audit, revision } from "@weatherly/matters";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import { z } from "zod";

const name = z.string().trim().min(1).max(150);
const email = z.email().transform(normalizeRosterEmail);
const phone = z.string().trim().max(60);
const brokerage = z.string().trim().max(250);
const business = z.enum(["hto", "weatherly"]);
const profile = z.object({
  name,
  phone: phone.optional(),
  brokerage: brokerage.optional(),
});
const createInput = profile
  .extend({ email: email.optional(), business })
  .strict()
  .refine((value) => value.business === "hto" || !!value.email, {
    path: ["email"],
    message: "Enter the agent's email.",
  });
const editInput = profile
  .partial()
  .extend({
    expectedRevision: revision,
    business: business.optional(),
    email: email.optional(),
  })
  .strict();
const sentInput = z
  .object({ expectedRevision: revision, sentOn: z.iso.date() })
  .strict();
const archiveInput = z.object({ expectedRevision: revision }).strict();

export async function addRosterAgent(actor: Principal, raw: unknown) {
  assertCoordinator(actor);
  const input = createInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    if (input.email) await lockRosterEmail(tx, input.email);
    const existing =
      input.email &&
      (await tx.rosterAgent.findUnique({
        where: { normalizedEmail: input.email },
        select: { id: true },
      }));
    if (existing)
      throw new HttpError(
        409,
        "ROSTER_EMAIL_EXISTS",
        "This email already belongs to a roster entry.",
      );
    const user =
      input.email &&
      (await tx.user.findUnique({
        where: { email: input.email },
        select: { id: true, role: true },
      }));
    const row = await tx.rosterAgent.create({
      data: {
        ...input,
        normalizedEmail: input.email,
        ...(user && user.role === "agent" ? { userId: user.id } : {}),
      },
    });
    await audit(tx, actor, "roster.added", "RosterAgent", row.id, null, {
      business: row.business,
    });
    return row;
  });
}

export async function lockRosterAgent(
  tx: Prisma.TransactionClient,
  id: string,
) {
  const initial = await tx.rosterAgent.findUnique({
    where: { id },
    select: { normalizedEmail: true },
  });
  if (initial?.normalizedEmail)
    await lockRosterEmail(tx, initial.normalizedEmail);
  await tx.$queryRaw`SELECT id FROM "RosterAgent" WHERE id = ${id} FOR UPDATE`;
  const row = await tx.rosterAgent.findUnique({ where: { id } });
  if (!row || row.archivedAt)
    throw new HttpError(
      404,
      "ROSTER_AGENT_NOT_FOUND",
      "Agent not found on the roster.",
    );
  return row;
}

function requireRevision(current: number, expected: number) {
  if (current !== expected)
    throw new HttpError(
      409,
      "REVISION_CONFLICT",
      "The agent record changed. Refresh and try again.",
    );
}

export async function updateRosterAgent(
  actor: Principal,
  id: string,
  raw: unknown,
) {
  assertCoordinator(actor);
  const { expectedRevision, email, ...input } = editInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    if (email) await lockRosterEmail(tx, email);
    const row = await lockRosterAgent(tx, id);
    requireRevision(row.revision, expectedRevision);
    if (email && row.normalizedEmail && row.normalizedEmail !== email)
      throw new HttpError(
        422,
        "ROSTER_EMAIL_LOCKED",
        "An existing roster email cannot be replaced here.",
      );
    if (
      email &&
      !row.normalizedEmail &&
      (await tx.rosterAgent.findUnique({
        where: { normalizedEmail: email },
        select: { id: true },
      }))
    )
      throw new HttpError(
        409,
        "ROSTER_EMAIL_EXISTS",
        "This email already belongs to a roster entry.",
      );
    if (
      row.userId &&
      (input.name !== undefined || input.brokerage !== undefined)
    ) {
      await tx.user.updateMany({
        where: { id: row.userId, role: "agent" },
        data: { name: input.name, brokerage: input.brokerage },
      });
    }
    const saved = await tx.rosterAgent.update({
      where: { id },
      data: {
        ...input,
        ...(email ? { email, normalizedEmail: email } : {}),
        revision: { increment: 1 },
      },
    });
    await audit(tx, actor, "roster.updated", "RosterAgent", id, null, {
      business: saved.business,
      priorBusiness: row.business,
    });
    return saved;
  });
}

const importInput = z
  .object({
    kind: z.enum(["user", "inquiry", "booking"]),
    id: z.string().min(1).max(200),
  })
  .strict();

export async function importRosterAgent(actor: Principal, raw: unknown) {
  assertCoordinator(actor);
  const { kind, id } = importInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    const profile =
      kind === "user"
        ? await tx.user.findFirst({ where: { id, role: "agent" } })
        : null;
    const inquiry =
      kind === "inquiry"
        ? await tx.inquiry.findUnique({ where: { id } })
        : null;
    const booking =
      kind === "booking"
        ? await tx.schedulingBooking.findUnique({ where: { id } })
        : null;
    const source = profile ?? inquiry ?? booking;
    if (!source)
      throw new HttpError(
        404,
        "ROSTER_SOURCE_NOT_FOUND",
        "The earlier agent record could not be found.",
      );
    const data = inquiry?.payload;
    const payload =
      data && typeof data === "object" && !Array.isArray(data) ? data : {};
    const row = await captureRosterLead(tx, {
      name: source.name,
      email: source.email,
      brokerage:
        profile?.brokerage ??
        (typeof payload.brokerage === "string" ? payload.brokerage : undefined),
      phone: typeof payload.phone === "string" ? payload.phone : undefined,
    });
    if (row.archivedAt)
      throw new HttpError(
        409,
        "INQUIRY_ARCHIVED",
        "This inquiry has been archived.",
      );
    const filter = {
      equals: row.normalizedEmail!,
      mode: "insensitive" as const,
    };
    await tx.inquiry.updateMany({
      where: { rosterAgentId: null, email: filter },
      data: { rosterAgentId: row.id },
    });
    await tx.schedulingBooking.updateMany({
      where: { rosterAgentId: null, email: filter },
      data: { rosterAgentId: row.id },
    });
    if (profile && !row.userId && row.business !== "hto")
      return tx.rosterAgent.update({
        where: { id: row.id },
        data: { userId: profile.id, revision: { increment: 1 } },
      });
    return row;
  });
}

export async function markAgreementSent(
  actor: Principal,
  id: string,
  raw: unknown,
) {
  assertCoordinator(actor);
  const { expectedRevision, sentOn } = sentInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    const row = await lockRosterAgent(tx, id);
    requireRevision(row.revision, expectedRevision);
    if (row.business === "hto")
      throw new HttpError(
        409,
        "HTO_AGREEMENT_NOT_REQUIRED",
        "Home Team Ohio agents do not need a service agreement.",
      );
    const saved = await tx.rosterAgent.update({
      where: { id },
      data: { agreementSentOn: sentOn, revision: { increment: 1 } },
    });
    await audit(tx, actor, "roster.agreement_sent", "RosterAgent", id, null, {
      sentOn,
    });
    return saved;
  });
}

export async function archiveRosterInquiry(
  actor: Principal,
  id: string,
  raw: unknown,
) {
  assertCoordinator(actor);
  const { expectedRevision } = archiveInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    const row = await lockRosterAgent(tx, id);
    requireRevision(row.revision, expectedRevision);
    const evidence = await tx.agreement.findFirst({
      where: {
        OR: [
          { rosterAgentId: id },
          ...(row.email ? [{ userId: row.email }] : []),
        ],
        status: { in: ["sent", "received", "approved"] },
      },
      select: { id: true },
    });
    const invitation = await tx.invitation.findFirst({
      where: {
        role: "agent",
        OR: [
          { rosterAgentId: id },
          ...(row.email ? [{ email: row.email }] : []),
        ],
      },
      select: { id: true },
    });
    if (
      row.userId ||
      row.business === "hto" ||
      row.agreementSentOn ||
      evidence ||
      invitation
    )
      throw new HttpError(
        409,
        "INQUIRY_ARCHIVE_ONLY",
        "Only an inquiry can be archived.",
      );
    await tx.rosterAgent.update({
      where: { id },
      data: { archivedAt: new Date(), revision: { increment: 1 } },
    });
    await audit(tx, actor, "roster.inquiry_archived", "RosterAgent", id, null);
    return { archived: true };
  });
}
