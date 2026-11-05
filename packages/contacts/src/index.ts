import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import {
  HttpError,
  assertCoordinator,
  asyncHandler,
  principal,
  type Principal,
} from "@weatherly/platform";
import { audit, requireMatter, revision } from "@weatherly/matters";

export const contactKinds = [
  "agent",
  "co_op_agent",
  "title_company",
  "title_rep",
  "lender",
  "loan_officer",
  "other",
] as const;
const input = z
  .object({
    kind: z.enum(contactKinds),
    name: z.string().trim().min(1).max(200),
    company: z.string().trim().max(250).default(""),
    email: z.union([z.email(), z.literal("")]).default(""),
    phone: z.string().trim().max(60).default(""),
    favorite: z.boolean().default(false),
  })
  .strict();
export type ContactInput = z.infer<typeof input>;
const normalize = (value: string) =>
  value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
function identityKey(contact: ContactInput) {
  // Exact normalized identity only: equal company or similar names never imply one person.
  return createHash("sha256")
    .update(
      JSON.stringify([
        contact.kind,
        normalize(contact.name),
        normalize(contact.company),
        contact.email.toLowerCase().trim(),
        contact.phone.replace(/[^0-9a-z]/gi, "").toLowerCase(),
      ]),
    )
    .digest("hex");
}
const select = {
  id: true,
  ownerId: true,
  kind: true,
  name: true,
  company: true,
  email: true,
  phone: true,
  favorite: true,
  revision: true,
  usageCount: true,
  lastUsedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BusinessContactSelect;
async function owned(
  actor: Principal,
  id: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  assertCoordinator(actor);
  const contact = await db.businessContact.findFirst({
    where: { id, ownerId: actor.id },
  });
  if (!contact)
    throw new HttpError(
      404,
      "CONTACT_NOT_FOUND",
      "Business contact not found.",
    );
  return contact;
}
function duplicate(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  )
    throw new HttpError(
      409,
      "CONTACT_EXISTS",
      "This exact contact already exists in your directory. Search and review it before choosing whether to update it.",
    );
  throw error;
}
export async function listBusinessContacts(
  actor: Principal,
  raw: unknown = {},
) {
  assertCoordinator(actor);
  const query = z
    .object({
      q: z.string().trim().max(200).optional(),
      kind: z.enum(contactKinds).optional(),
      sort: z.enum(["frequent", "recent", "name"]).default("frequent"),
      favorites: z.enum(["true", "false"]).optional(),
      cursor: z.string().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    })
    .strict()
    .parse(raw);
  if (query.cursor) await owned(actor, query.cursor);
  const terms = (query.q || "").split(/\s+/).filter(Boolean);
  const orderBy: Prisma.BusinessContactOrderByWithRelationInput[] =
    query.sort === "name"
      ? [{ name: "asc" }, { company: "asc" }, { id: "asc" }]
      : query.sort === "recent"
        ? [
            { lastUsedAt: { sort: "desc", nulls: "last" } },
            { updatedAt: "desc" },
            { id: "asc" },
          ]
        : [
            { usageCount: "desc" },
            { lastUsedAt: { sort: "desc", nulls: "last" } },
            { updatedAt: "desc" },
            { id: "asc" },
          ];
  const rows = await prisma.businessContact.findMany({
    where: {
      ownerId: actor.id,
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.favorites === "true" ? { favorite: true } : {}),
      AND: terms.map((term) => ({
        OR: ["name", "company", "email", "phone"].map((key) => ({
          [key]: { contains: term, mode: "insensitive" },
        })),
      })),
    },
    orderBy,
    select,
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > query.limit,
    items = rows.slice(0, query.limit);
  return { items, hasMore, nextCursor: hasMore ? items.at(-1)!.id : null };
}
export async function getBusinessContact(actor: Principal, id: string) {
  await owned(actor, id);
  return prisma.businessContact.findUniqueOrThrow({ where: { id }, select });
}
export async function createBusinessContact(actor: Principal, raw: unknown) {
  assertCoordinator(actor);
  const data = input.parse(raw);
  try {
    return await prisma.$transaction(async (tx) => {
      const saved = await tx.businessContact.create({
        data: { ...data, ownerId: actor.id, identityKey: identityKey(data) },
        select,
      });
      await audit(
        tx,
        actor,
        "contact.created",
        "BusinessContact",
        saved.id,
        null,
      );
      return saved;
    });
  } catch (error) {
    duplicate(error);
  }
}
export async function updateBusinessContact(
  actor: Principal,
  id: string,
  raw: unknown,
) {
  assertCoordinator(actor);
  const { expectedRevision, ...patch } = input
    .partial()
    .extend({ expectedRevision: revision })
    .strict()
    .parse(raw);
  if (!Object.keys(patch).length)
    throw new HttpError(
      422,
      "CONTACT_CHANGE_REQUIRED",
      "Choose a contact field to update.",
    );
  try {
    return await prisma.$transaction(async (tx) => {
      const old = await owned(actor, id, tx),
        next = input.parse({
          kind: old.kind,
          name: old.name,
          company: old.company,
          email: old.email,
          phone: old.phone,
          favorite: old.favorite,
          ...patch,
        });
      const changed = await tx.businessContact.updateMany({
        where: { id, ownerId: actor.id, revision: expectedRevision },
        data: {
          ...patch,
          identityKey: identityKey(next),
          revision: { increment: 1 },
        },
      });
      if (!changed.count)
        throw new HttpError(
          409,
          "REVISION_CONFLICT",
          "This contact changed. Reload it before saving your correction.",
        );
      await audit(tx, actor, "contact.updated", "BusinessContact", id, null, {
        before: {
          name: old.name,
          company: old.company,
          email: old.email,
          phone: old.phone,
          kind: old.kind,
          favorite: old.favorite,
          revision: old.revision,
        },
        changes: patch,
      });
      return tx.businessContact.findUniqueOrThrow({ where: { id }, select });
    });
  } catch (error) {
    duplicate(error);
  }
}
export async function recordBusinessContactUse(
  actor: Principal,
  id: string,
  raw: unknown,
) {
  assertCoordinator(actor);
  const data = z
    .object({
      expectedRevision: revision,
      matterId: z.string().min(1).optional(),
    })
    .strict()
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    await owned(actor, id, tx);
    if (data.matterId) await requireMatter(actor, data.matterId, true, tx);
    // Usage does not modify contact facts or their revision. A selected snapshot
    // keeps the revision actually reviewed by the coordinator.
    const changed = await tx.businessContact.updateMany({
      where: { id, ownerId: actor.id, revision: data.expectedRevision },
      data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
    });
    if (!changed.count)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "This contact changed. Review the latest details before using it.",
      );
    await audit(
      tx,
      actor,
      "contact.selected",
      "BusinessContact",
      id,
      data.matterId || null,
      { directoryRevision: data.expectedRevision },
    );
    return tx.businessContact.findUniqueOrThrow({ where: { id }, select });
  });
}
export function businessContactSnapshot(
  contact: {
    id: string;
    revision: number;
    kind: string;
    name: string;
    company: string;
    email: string;
    phone: string;
  },
  role = contact.kind,
) {
  return {
    directoryContactId: contact.id,
    directoryRevision: contact.revision,
    snapshotAt: new Date().toISOString(),
    role,
    name: contact.name,
    company: contact.company,
    email: contact.email,
    phone: contact.phone,
  };
}
export function createContactsRouter() {
  const r = Router();
  r.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  r.get(
    "/",
    asyncHandler(async (req, res) =>
      res.json(await listBusinessContacts(principal(req), req.query)),
    ),
  );
  r.get(
    "/:id",
    asyncHandler(async (req, res) =>
      res.json(await getBusinessContact(principal(req), String(req.params.id))),
    ),
  );
  r.post(
    "/",
    asyncHandler(async (req, res) =>
      res
        .status(201)
        .json(await createBusinessContact(principal(req), req.body)),
    ),
  );
  r.patch(
    "/:id",
    asyncHandler(async (req, res) =>
      res.json(
        await updateBusinessContact(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  r.post(
    "/:id/usage",
    asyncHandler(async (req, res) =>
      res.json(
        await recordBusinessContactUse(
          principal(req),
          String(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  return r;
}
