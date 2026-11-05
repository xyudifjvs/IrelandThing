import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import express from "express";
import request from "supertest";
import { prisma } from "@weatherly/db";
import { type Principal, HttpError } from "@weatherly/platform";
import {
  createBusinessContact,
  updateBusinessContact,
  getBusinessContact,
  listBusinessContacts,
  recordBusinessContactUse,
  businessContactSnapshot,
  createContactsRouter,
} from "../src/index";
const run = randomUUID();
const actor = (role: Principal["role"], suffix: string): Principal => ({
  id: `contacts-${suffix}-${run}`,
  name: `Synthetic ${suffix}`,
  email: `contacts-${suffix}-${run}@example.test`,
  role,
  sessionId: randomUUID(),
});
const owner = actor("coordinator", "owner"),
  other = actor("coordinator", "other"),
  agent = actor("agent", "agent"),
  client = actor("client", "client");
const createdIds: string[] = [];
const matterIds: string[] = [];
async function add(values: Record<string, unknown> = {}) {
  const c = await createBusinessContact(owner, {
    kind: "title_rep",
    name: `Representative ${randomUUID()}`,
    company: "Synthetic Title Company",
    email: "rep@example.test",
    phone: "555-0101",
    ...values,
  });
  createdIds.push(c.id);
  return c;
}
beforeAll(async () => {
  await prisma.user.createMany({
    data: [owner, other, agent, client].map(({ id, name, email, role }) => ({
      id,
      name,
      email,
      role,
    })),
  });
});
afterAll(async () => {
  await prisma.businessContact.deleteMany({
    where: { ownerId: { in: [owner.id, other.id] } },
  });
  await prisma.matter.deleteMany({ where: { id: { in: matterIds } } });
  await prisma.auditEvent.deleteMany({
    where: { actorId: { in: [owner.id, other.id] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [owner.id, other.id, agent.id, client.id] } },
  });
  await prisma.$disconnect();
});
describe("private reusable business contacts", () => {
  it("persists across sessions/database clients and keeps representatives at one company distinct", async () => {
    const first = await add({ name: "Jane First", email: "jane@example.test" }),
      second = await add({ name: "John Second", email: "john@example.test" });
    const secondDb = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
    });
    try {
      expect(
        await secondDb.businessContact.findUnique({ where: { id: first.id } }),
      ).toMatchObject({
        name: "Jane First",
        company: "Synthetic Title Company",
      });
    } finally {
      await secondDb.$disconnect();
    }
    const results = await listBusinessContacts(
      { ...owner, sessionId: randomUUID() },
      { q: "Synthetic Title", sort: "name" },
    );
    expect(results.items.map((c) => c.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
    expect(
      (await listBusinessContacts(owner, { q: "Jane Synthetic" })).items.map(
        (c) => c.id,
      ),
    ).toContain(first.id);
  });
  it("never merges similar names; exact normalized duplicates return a review conflict", async () => {
    const original = await add({
      name: "Mary Representative",
      email: "mary@example.test",
    });
    await expect(
      createBusinessContact(owner, {
        kind: "title_rep",
        name: "  MARY   Representative ",
        company: "synthetic TITLE company",
        email: "MARY@example.test",
        phone: "(555) 0101",
      }),
    ).rejects.toMatchObject({ status: 409, code: "CONTACT_EXISTS" });
    const similar = await add({
      name: "Mary Representatives",
      email: "mary.other@example.test",
    });
    expect(similar.id).not.toBe(original.id);
    expect((await getBusinessContact(owner, original.id)).email).toBe(
      "mary@example.test",
    );
  });
  it("requires an explicit revision for corrections and leaves earlier transaction/sent snapshots intact", async () => {
    const original = await add({
      name: "History Representative",
      email: "old@example.test",
    });
    const snapshot = businessContactSnapshot(original, "title_rep");
    const matter = await prisma.matter.create({
      data: {
        title: "Synthetic contact history",
        propertyAddress: "1 Synthetic Contact Road",
        side: "buyer",
        packageCode: "essentials",
        details: {
          contacts: [{ id: randomUUID(), ...snapshot }],
          sentContactSnapshot: snapshot,
        },
      },
    });
    matterIds.push(matter.id);
    const updated = await updateBusinessContact(owner, original.id, {
      expectedRevision: original.revision,
      email: "corrected@example.test",
      phone: "555-0202",
    });
    expect(updated).toMatchObject({
      email: "corrected@example.test",
      revision: original.revision + 1,
    });
    await expect(
      updateBusinessContact(owner, original.id, {
        expectedRevision: original.revision,
        name: "Stale overwrite",
      }),
    ).rejects.toMatchObject({ status: 409, code: "REVISION_CONFLICT" });
    expect(
      (await prisma.matter.findUniqueOrThrow({ where: { id: matter.id } }))
        .details,
    ).toEqual(matter.details);
    expect(snapshot).toMatchObject({
      email: "old@example.test",
      directoryRevision: original.revision,
      directoryContactId: original.id,
    });
    expect(businessContactSnapshot(updated).email).toBe(
      "corrected@example.test",
    );
  });
  it("scopes every read/write to its coordinator owner, forbids agent/client directory access and rejects stale selection", async () => {
    const saved = await add();
    expect((await listBusinessContacts(other, {})).items).toEqual([]);
    for (const principal of [agent, client]) {
      await expect(listBusinessContacts(principal, {})).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        getBusinessContact(principal, saved.id),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        createBusinessContact(principal, { kind: "other", name: "Forbidden" }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        updateBusinessContact(principal, saved.id, {
          expectedRevision: saved.revision,
          name: "Forbidden",
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        recordBusinessContactUse(principal, saved.id, {
          expectedRevision: saved.revision,
        }),
      ).rejects.toMatchObject({ status: 403 });
    }
    await expect(getBusinessContact(other, saved.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      updateBusinessContact(other, saved.id, {
        expectedRevision: saved.revision,
        name: "Forbidden",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      recordBusinessContactUse(other, saved.id, {
        expectedRevision: saved.revision,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await updateBusinessContact(owner, saved.id, {
      expectedRevision: saved.revision,
      phone: "new",
    });
    await expect(
      recordBusinessContactUse(owner, saved.id, {
        expectedRevision: saved.revision,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("tracks explicit use, recent/frequent/favorite lookup without changing fact revisions", async () => {
    const saved = await add({
      name: "Favorite Representative",
      favorite: true,
    });
    const used = await recordBusinessContactUse(owner, saved.id, {
      expectedRevision: saved.revision,
    });
    expect(used).toMatchObject({ usageCount: 1, revision: saved.revision });
    expect(used.lastUsedAt).toBeInstanceOf(Date);
    expect(
      (await listBusinessContacts(owner, { favorites: "true" })).items.map(
        (c) => c.id,
      ),
    ).toContain(saved.id);
    expect(
      (await listBusinessContacts(owner, { sort: "frequent" })).items[0].id,
    ).toBe(saved.id);
    expect(
      (await listBusinessContacts(owner, { sort: "recent" })).items[0].id,
    ).toBe(saved.id);
  });
  it("rejects unauthenticated HTTP access and exposes only owned records", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (req.get("x-synthetic-role") === "owner") req.principal = owner;
      else if (req.get("x-synthetic-role") === "agent") req.principal = agent;
      next();
    });
    app.use("/contacts", createContactsRouter());
    app.use(
      (
        error: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res
          .status(error instanceof HttpError ? error.status : 500)
          .json({
            error: error instanceof HttpError ? error.code : "INTERNAL",
          });
      },
    );
    expect((await request(app).get("/contacts")).status).toBe(401);
    expect(
      (await request(app).get("/contacts").set("x-synthetic-role", "agent"))
        .status,
    ).toBe(403);
    const result = await request(app)
      .post("/contacts")
      .set("x-synthetic-role", "owner")
      .send({
        kind: "loan_officer",
        name: "Synthetic HTTP Officer",
        company: "Synthetic Lender",
        email: "officer@example.test",
      });
    expect(result.status).toBe(201);
    createdIds.push(result.body.id);
    const list = await request(app)
      .get("/contacts?q=HTTP")
      .set("x-synthetic-role", "owner");
    expect(list.status).toBe(200);
    expect(list.headers["cache-control"]).toBe("private, no-store");
    expect(list.body.items[0]).not.toHaveProperty("identityKey");
    expect(list.body.items.map((x: { id: string }) => x.id)).toContain(
      result.body.id,
    );
  });
});
