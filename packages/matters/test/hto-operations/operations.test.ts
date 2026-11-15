import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@weatherly/db";
import { HttpError, sanitizeError, type Principal } from "@weatherly/platform";
import { seedMatterChecklist } from "../../src/checklist/persistence";
import { formatHtoAddress } from "../../src/hto-operations/address";
import {
  applyLinkedClosingDate,
  previewLinkedClosingDate,
} from "../../src/hto-operations/closing-date";
import type {
  HtoAddress,
  HtoClosingRow,
  HtoStatus,
} from "../../src/hto-operations/contracts";
import { exportHtoClosings } from "../../src/hto-operations/csv";
import {
  createHtoOperationsRouter,
  removeHtoClosingBeforeDelete,
  syncHtoClosing,
} from "../../src/hto-operations";
import {
  resolveHtoMatch,
  type UpdateLinkedFileFacts,
} from "../../src/hto-operations/linked";
import {
  addManualClosing,
  updateManualClosing,
} from "../../src/hto-operations/manual";
import { listHtoOperations } from "../../src/hto-operations/queries";

const token = `hto-${randomUUID()}`;
const actor: Principal = {
  id: token,
  name: "Synthetic HTO coordinator",
  role: "coordinator",
  email: `${token}@example.test`,
  sessionId: token,
};
const rosterId = `${token}-roster`;
const weatherlyId = `${token}-weatherly`;
const matters: string[] = [];
let addressNumber = 100;
const people = [
  {
    firstName: 'Morgan "Mo"',
    lastName: "Synthetic",
    email: "mo@example.test",
    phone: "+1 555 0100",
  },
  {
    firstName: "=Synthetic",
    lastName: "Zoë",
    email: "zoe@example.test",
    phone: "555-0101",
  },
];
const now = new Date("2026-01-01T02:00:00Z"); // December 31 in Ohio.
const address = (
  street = `${addressNumber++} Synthetic Drive`,
): HtoAddress => ({
  street,
  city: "Fixture City",
  state: "OH",
  zip: "00000",
});

function manualInput(parts: HtoAddress, status: HtoStatus = "active_listing") {
  return {
    agentRosterId: rosterId,
    address: parts,
    clients: people,
    side: "seller",
    status,
    closeDate: null as string | null,
    listedDate: "2025-11-30",
    purchasePriceCents: null as number | null,
  };
}

async function file(
  parts: HtoAddress,
  {
    business = "hto",
    stage = "under_contract",
    seedDates = false,
  }: {
    business?: "hto" | "weatherly";
    stage?: string;
    seedDates?: boolean;
  } = {},
) {
  const row = await prisma.matter.create({
    data: {
      title: "Synthetic transaction",
      side: "seller",
      propertyAddress: formatHtoAddress(parts),
      packageCode: "essentials",
      stage,
      business,
      agentRosterId: rosterId,
      purchasePriceCents: 25_500_032,
      details: { structuredAddress: parts },
    },
  });
  matters.push(row.id);
  if (seedDates)
    await prisma.$transaction((tx) =>
      seedMatterChecklist(tx, row.id, {
        side: "seller",
        purchaseType: "financed",
        timeZone: "America/New_York",
        acceptance: null,
        dates: [
          {
            key: "closing",
            value: { date: "2025-12-22", instant: null },
            rule: { kind: "fixed" },
          },
          {
            key: "title_commitment",
            value: null,
            rule: {
              kind: "relative",
              offset: {
                anchor: { kind: "step", key: "closing" },
                amount: -15,
                unit: "days",
                counting: "calendar",
                rollover: "none",
                calendar: null,
              },
            },
          },
        ],
      }),
    );
  return row;
}

function synchronize(id: string) {
  return prisma.$transaction((tx) => syncHtoClosing(tx, actor, id));
}

async function view(
  range: "this_year" | "last_month" | "this_month" | "all_time" = "all_time",
) {
  return listHtoOperations(actor, { agentId: rosterId, range }, now);
}

function matchInput(row: HtoClosingRow) {
  return {
    key: row.match!.key,
    expectedRowRevision: row.revision,
    expectedMatterRevision: row.matterRevision!,
  };
}

beforeAll(async () => {
  await prisma.user.create({
    data: {
      id: actor.id,
      email: actor.email,
      role: actor.role,
      name: actor.name,
    },
  });
  await prisma.rosterAgent.createMany({
    data: [
      { id: rosterId, name: "Synthetic Teammate", business: "hto" },
      {
        id: weatherlyId,
        name: "Synthetic Weatherly Agent",
        business: "weatherly",
      },
    ],
  });
});

afterEach(async () => {
  await prisma.auditEvent.deleteMany({ where: { actorId: actor.id } });
  await prisma.htoClosing.deleteMany({
    where: {
      OR: [{ manualAgentRosterId: rosterId }, { matterId: { in: matters } }],
    },
  });
  await prisma.matter.deleteMany({ where: { id: { in: matters } } });
  matters.length = 0;
});

afterAll(async () => {
  await prisma.rosterAgent.deleteMany({
    where: { id: { in: [rosterId, weatherlyId] } },
  });
  await prisma.user.deleteMany({ where: { id: actor.id } });
  await prisma.$disconnect();
});

describe("HTO operations", () => {
  it("validates the HTO roster and edits standalone rows with no transaction writes", async () => {
    const parts = address();
    const before = await prisma.matter.count({
      where: { agentRosterId: rosterId },
    });
    await expect(
      addManualClosing(actor, {
        ...manualInput(parts),
        agentRosterId: weatherlyId,
      }),
    ).rejects.toMatchObject({ code: "HTO_AGENT_REQUIRED" });
    const added = await addManualClosing(actor, {
      ...manualInput(parts),
      closeDate: "2025-12-22",
      purchasePriceCents: 900,
    });
    expect((await view()).rows[0]).toMatchObject({
      id: added.id,
      closeDate: null,
      purchasePriceCents: null,
      listedDate: "2025-11-30",
    });
    const contract = {
      ...manualInput(parts, "under_contract"),
      closeDate: "2025-12-22",
      purchasePriceCents: 21_500_012,
      expectedRevision: added.revision,
    };
    const updated = await updateManualClosing(actor, added.id, contract);
    await expect(
      updateManualClosing(actor, added.id, contract),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await updateManualClosing(actor, added.id, {
      ...contract,
      status: "closed",
      purchasePriceCents: 21_600_032,
      expectedRevision: updated.revision,
    });
    expect((await view("this_month")).totals).toEqual({
      activeListings: 0,
      underContract: 0,
      closed: 1,
      closedVolumeCents: "21600032",
    });
    expect((await view("last_month")).rows).toEqual([]);
    expect((await view()).rows[0]).toMatchObject({
      status: "closed",
      previousPriceCents: 21_500_012,
      purchasePriceCents: 21_600_032,
    });
    expect(
      await prisma.matter.count({ where: { agentRosterId: rosterId } }),
    ).toBe(before);
  });

  it("links one unambiguous manual row under concurrent retry and separates units", async () => {
    const exact = address("413 Synthetic Drive Unit 4");
    const differentUnit = address("413 Synthetic Drive Unit 5");
    const other = await addManualClosing(actor, manualInput(differentUnit));
    const listing = await addManualClosing(actor, manualInput(exact));
    const canonical = await file(exact, { seedDates: true });
    const [first, second] = await Promise.all([
      synchronize(canonical.id),
      synchronize(canonical.id),
    ]);
    expect(first?.id).toBe(listing.id);
    expect(second).toEqual(first);
    expect((await view()).rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: listing.id,
          matterId: canonical.id,
          status: "under_contract",
          closeDate: "2025-12-22",
        }),
        expect.objectContaining({
          id: other.id,
          matterId: null,
          status: "active_listing",
        }),
      ]),
    );
  });

  it("asks before linking an exact contract row with disjoint client emails", async () => {
    const parts = address();
    const manual = await addManualClosing(actor, {
      ...manualInput(parts, "under_contract"),
      closeDate: "2025-12-22",
      purchasePriceCents: 25_500_032,
      clients: [people[0]],
    });
    const canonical = await file(parts, { seedDates: true });
    await prisma.matterContact.createMany({
      data: [
        {
          matterId: canonical.id,
          role: "seller",
          name: "Distinct Seller",
          email: "seller@example.test",
        },
        {
          matterId: canonical.id,
          role: "co_op_agent",
          name: "Co-op",
          email: people[0].email,
        },
      ],
    });
    const separate = (await synchronize(canonical.id))!;
    expect(separate.id).not.toBe(manual.id);
    expect(
      await prisma.htoClosing.findUnique({ where: { id: manual.id } }),
    ).toMatchObject({ matterId: null });
    expect(
      await prisma.auditEvent.count({
        where: { action: "hto.manual_linked", matterId: canonical.id },
      }),
    ).toBe(0);
    const shown = (await view()).rows.find(({ id }) => id === separate.id)!;
    expect(shown.match?.candidates).toEqual([
      expect.objectContaining({ id: manual.id, clientEmailConflict: true }),
    ]);
    await resolveHtoMatch(actor, shown.id, {
      ...matchInput(shown),
      action: "link",
      candidateId: manual.id,
      candidateRevision: manual.revision,
    });
    expect(
      await prisma.htoClosing.findUnique({ where: { matterId: canonical.id } }),
    ).toMatchObject({ id: manual.id });
    expect(
      await prisma.auditEvent.findFirst({
        where: { action: "hto.manual_linked", matterId: canonical.id },
      }),
    ).toMatchObject({
      entityId: manual.id,
      details: { replacedRowId: separate.id, clientEmailConflict: true },
    });
  });

  it("still links an exact contract row with a case-insensitive client email in common", async () => {
    const parts = address();
    const manual = await addManualClosing(actor, {
      ...manualInput(parts, "under_contract"),
      closeDate: "2025-12-22",
      purchasePriceCents: 25_500_032,
    });
    const canonical = await file(parts, { seedDates: true });
    await prisma.matterContact.createMany({
      data: [
        {
          matterId: canonical.id,
          role: "client",
          name: "Existing Client",
          email: people[0].email.toUpperCase(),
        },
        {
          matterId: canonical.id,
          role: "client",
          name: "Additional Client",
          email: "added@example.test",
        },
      ],
    });
    expect((await synchronize(canonical.id))?.id).toBe(manual.id);
  });

  it("dismisses a near match once and requires current revisions for an explicit link", async () => {
    const long = address("414 Synthetic Drive");
    const short = { ...long, street: "414 Synthetic Dr" };
    const manual = await addManualClosing(actor, manualInput(short));
    const canonical = await file(long);
    const linked = (await synchronize(canonical.id))!;
    const shown = (await view()).rows.find(({ id }) => id === linked.id)!;
    expect(shown.match?.candidates).toEqual([
      {
        id: manual.id,
        revision: manual.revision,
        propertyAddress: formatHtoAddress(short),
        agentName: "Synthetic Teammate",
        clientNames: ['Morgan "Mo" Synthetic', "=Synthetic Zoë"],
      },
    ]);
    const updated = await updateManualClosing(actor, manual.id, {
      ...manualInput(short),
      expectedRevision: manual.revision,
    });
    await expect(
      resolveHtoMatch(actor, shown.id, {
        ...matchInput(shown),
        action: "link",
        candidateId: manual.id,
        candidateRevision: manual.revision,
      }),
    ).rejects.toMatchObject({ code: "HTO_MATCH_CONFLICT" });
    await resolveHtoMatch(actor, shown.id, {
      ...matchInput(shown),
      action: "dismiss",
    });
    await synchronize(canonical.id);
    expect(
      (await view()).rows.find(({ id }) => id === linked.id)?.match,
    ).toBeNull();
    expect(
      (await view()).rows.find(({ id }) => id === manual.id),
    ).toMatchObject({ matterId: null, revision: updated.revision });
  });

  it("does not silently choose among identical or conflicting addresses", async () => {
    const parts = address();
    const first = await addManualClosing(actor, manualInput(parts));
    const second = await addManualClosing(actor, manualInput(parts));
    const canonical = await file(parts);
    const placeholder = (await synchronize(canonical.id))!;
    const shown = (await view()).rows.find(({ id }) => id === placeholder.id)!;
    expect(shown.match?.candidates.map(({ id }) => id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
    await resolveHtoMatch(actor, shown.id, {
      ...matchInput(shown),
      action: "link",
      candidateId: first.id,
      candidateRevision: first.revision,
    });
    expect(
      await prisma.htoClosing.findUnique({ where: { id: placeholder.id } }),
    ).toBeNull();
    expect(
      await prisma.htoClosing.findUnique({ where: { matterId: canonical.id } }),
    ).toMatchObject({ id: first.id });
    expect(
      (await view()).rows.find(({ id }) => id === first.id)?.match,
    ).toBeNull();
    const another = await file(parts);
    expect((await synchronize(another.id))?.id).not.toBe(second.id);
    expect(
      await prisma.htoClosing.findUnique({ where: { id: second.id } }),
    ).toMatchObject({ matterId: null });
  });

  it("keeps a linked identity dormant outside HTO and deletes it transactionally with the file", async () => {
    const parts = address();
    const manual = await addManualClosing(actor, manualInput(parts));
    const canonical = await file(parts);
    expect((await synchronize(canonical.id))?.id).toBe(manual.id);
    await prisma.matter.update({
      where: { id: canonical.id },
      data: { business: "weatherly" },
    });
    expect(await synchronize(canonical.id)).toBeNull();
    expect((await view()).rows).toEqual([]);
    await prisma.matter.update({
      where: { id: canonical.id },
      data: { business: "hto", stage: "closed" },
    });
    expect((await synchronize(canonical.id))?.id).toBe(manual.id);
    expect((await view()).rows[0]).toMatchObject({
      id: manual.id,
      status: "closed",
    });
    await prisma.$transaction(async (tx) => {
      await removeHtoClosingBeforeDelete(tx, actor, canonical.id);
      await tx.matter.delete({ where: { id: canonical.id } });
    });
    expect((await view()).rows).toEqual([]);
    expect(
      await prisma.auditEvent.findFirst({
        where: {
          entityId: manual.id,
          matterId: canonical.id,
          action: "hto.file_row_removed",
        },
      }),
    ).not.toBeNull();
  });

  it("synchronizes only a published HTO file", async () => {
    const pending = await file(address(), { stage: "pending_review" });
    const weatherly = await file(address(), { business: "weatherly" });
    expect(await synchronize(pending.id)).toBeNull();
    expect(await synchronize(weatherly.id)).toBeNull();
    expect((await view()).rows).toEqual([]);
  });

  it("previews canonical closing dates and requires the digest and file revision on apply", async () => {
    const canonical = await file(address(), { seedDates: true });
    const row = (await synchronize(canonical.id))!;
    const current = (await view()).rows[0];
    const command = {
      date: "2025-12-26",
      expectedRevision: current.matterRevision,
    };
    const preview = await previewLinkedClosingDate(actor, row.id, command);
    expect(preview.primary).toMatchObject({
      before: { date: "2025-12-22" },
      after: { date: "2025-12-26" },
    });
    expect(preview.dependents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: { kind: "step", key: "title_commitment" },
          after: { date: "2025-12-11", instant: null },
        }),
      ]),
    );
    const apply = {
      ...command,
      mode: "only_this_date",
      previewDigest: preview.previewDigest,
    };
    await expect(
      applyLinkedClosingDate(actor, row.id, { ...apply, date: "2025-12-27" }),
    ).rejects.toMatchObject({ code: "PREVIEW_CONFLICT" });
    await applyLinkedClosingDate(actor, row.id, apply);
    expect((await view()).rows[0]).toMatchObject({ closeDate: "2025-12-26" });
    const task = await prisma.task.findUniqueOrThrow({
      where: {
        matterId_stepKey: {
          matterId: canonical.id,
          stepKey: "title_commitment",
        },
      },
    });
    expect(task).toMatchObject({
      dueDate: "2025-12-07",
      dateRule: { kind: "fixed" },
    });
    await expect(
      applyLinkedClosingDate(actor, row.id, apply),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("uses a recorded actual close date for a closed file while keeping the checklist date distinct", async () => {
    const canonical = await file(address(), { seedDates: true });
    const row = (await synchronize(canonical.id))!;
    expect((await view()).rows[0]).toMatchObject({
      closeDate: "2025-12-22",
      checklistCloseDate: "2025-12-22",
      actualCloseDate: null,
    });
    await prisma.matter.update({
      where: { id: canonical.id },
      data: { stage: "closed" },
    });
    await prisma.task.update({
      where: {
        matterId_stepKey: { matterId: canonical.id, stepKey: "closing" },
      },
      data: { actualDate: "2025-11-28", status: "completed" },
    });
    expect((await view("this_month")).rows).toEqual([]);
    expect((await view("last_month")).rows[0]).toMatchObject({
      closeDate: "2025-11-28",
      checklistCloseDate: "2025-12-22",
      actualCloseDate: "2025-11-28",
      canonicalDateEditable: false,
    });
    const composed = await listHtoOperations(
      actor,
      { agentId: rosterId, range: "all_time" },
      now,
      true,
    );
    expect(composed.rows[0]).toMatchObject({
      id: row.id,
      canonicalDateEditable: true,
    });
  });

  it("exports exact columns per selected person with stable dates, cents, and CSV escaping", async () => {
    const first = await addManualClosing(actor, {
      ...manualInput(address('91 Synthetic, Unit "A"'), "closed"),
      closeDate: "2025-12-22",
      purchasePriceCents: 25_500_032,
    });
    const second = await addManualClosing(actor, {
      ...manualInput(address("92 Synthetic Drive"), "closed"),
      closeDate: "2024-01-15",
      clients: [people[0]],
    });
    const filters = {
      agentId: rosterId,
      status: "closed",
      range: "this_month",
    };
    const all = await exportHtoClosings(actor, { filters }, now);
    expect(all.filename).toBe("synthetic-closings-for-FUB.csv");
    expect(all.csv.split("\r\n")).toEqual([
      "Name,Email,Phone,Street,City,State,ZIP,Close Date,Sale Price,Side,Agent",
      '"Morgan ""Mo"" Synthetic",mo@example.test,+1 555 0100,"91 Synthetic, Unit ""A""",Fixture City,OH,00000,2025-12-22,255000.32,Seller,Synthetic Teammate',
      `'=Synthetic Zoë,zoe@example.test,555-0101,"91 Synthetic, Unit ""A""",Fixture City,OH,00000,2025-12-22,255000.32,Seller,Synthetic Teammate`,
      "",
    ]);
    const selected = await exportHtoClosings(
      actor,
      { filters, rowIds: [second.id] },
      now,
    );
    expect(selected.csv).toContain("92 Synthetic Drive");
    expect(selected.csv).not.toContain("91 Synthetic");
    await expect(
      exportHtoClosings(actor, { filters, rowIds: [first.id, "missing"] }, now),
    ).rejects.toMatchObject({ code: "HTO_EXPORT_SELECTION_CHANGED" });
  });

  it("exports saved canonical names and phone numbers without stale structured fields", async () => {
    const parts = address();
    const canonical = await file(parts);
    const [fresh, stale] = await Promise.all([
      prisma.matterContact.create({
        data: {
          matterId: canonical.id,
          role: "seller",
          name: "Fresh Synthetic",
          email: "fresh@example.test",
          phone: "555-0141",
        },
      }),
      prisma.matterContact.create({
        data: {
          matterId: canonical.id,
          role: "client",
          name: "Changed Synthetic",
          email: "changed@example.test",
          phone: "555-0142",
        },
      }),
      prisma.matterContact.create({
        data: {
          matterId: canonical.id,
          role: "agent",
          name: "Not a Client",
          email: "agent@example.test",
        },
      }),
    ]);
    await prisma.matter.update({
      where: { id: canonical.id },
      data: {
        propertyAddress: "New Synthetic Address",
        details: {
          structuredAddress: parts,
          structuredClientNames: {
            [fresh.id]: { firstName: "Fresh", lastName: "Synthetic" },
            [stale.id]: { firstName: "Stale", lastName: "Synthetic" },
          },
        },
      },
    });
    const row = (await synchronize(canonical.id))!;
    expect((await view()).rows[0]).toMatchObject({
      address: null,
      clients: expect.arrayContaining([
        expect.objectContaining({
          name: "Fresh Synthetic",
          firstName: "Fresh",
          lastName: "Synthetic",
        }),
        expect.objectContaining({
          name: "Changed Synthetic",
          firstName: "",
          lastName: "",
        }),
      ]),
    });
    const exported = await exportHtoClosings(
      actor,
      { filters: { agentId: rosterId }, rowIds: [row.id] },
      now,
    );
    expect(exported.csv).toContain(
      "Changed Synthetic,changed@example.test,555-0142",
    );
    expect(exported.csv).not.toContain("Stale Synthetic");
    expect(exported.csv).not.toContain("agent@example.test");
    expect(exported.csv).not.toContain(parts.street);
  });

  it("reports incomplete clients without skipping legacy entries or inferring their values", async () => {
    const manual = await addManualClosing(
      actor,
      manualInput(address(), "closed"),
    );
    await prisma.htoClosing.update({
      where: { id: manual.id },
      data: {
        manualClients: [
          people[0],
          { email: "legacy@example.test", phone: "555-0145" },
          {
            firstName: "Missing Phone",
            lastName: "",
            email: "other@example.test",
          },
        ],
      },
    });
    await expect(
      exportHtoClosings(actor, { filters: {}, rowIds: [manual.id] }, now),
    ).rejects.toMatchObject({
      code: "HTO_EXPORT_INCOMPLETE",
      issues: [
        { rowId: manual.id, clientNumber: 2, name: null, missing: ["name"] },
        {
          rowId: manual.id,
          clientNumber: 3,
          name: "Missing Phone",
          missing: ["phone"],
        },
      ],
    });
  });

  it("offers a previous row's contact for review only on an unambiguous email match", async () => {
    const canonical = await file(address());
    const row = (await synchronize(canonical.id))!;
    const clients = [
      { name: "Saved client", email: "MO@example.test" },
      { name: "Do not match", email: "unmatched@example.test" },
      { name: "Ambiguous client", email: "zoe@example.test" },
    ];
    await prisma.matterContact.createMany({
      data: clients.map((client) => ({
        ...client,
        matterId: canonical.id,
        role: "client",
      })),
    });
    await prisma.htoClosing.update({
      where: { id: row.id },
      data: { manualClients: [...people, { ...people[1], phone: "555-0999" }] },
    });
    const projected = (await view()).rows.find(({ id }) => id === row.id)!;
    const [matched, unmatched, ambiguous] = clients.map(({ email }) =>
      projected.clients.find((client) => client.email === email),
    );
    expect(matched).toMatchObject({
      phone: "",
      previousClient: { email: "mo@example.test", phone: "+1 555 0100" },
    });
    expect(unmatched?.previousClient).toBeUndefined();
    expect(ambiguous?.previousClient).toBeUndefined();
    expect(ambiguous?.previousClientConflict).toBe(true);
    await expect(
      exportHtoClosings(actor, { filters: {}, rowIds: [row.id] }, now),
    ).rejects.toMatchObject({ code: "HTO_EXPORT_INCOMPLETE" });
  });

  it("serves coordinator-only private HTTP responses and injects the linked canonical writer", async () => {
    const parts = address();
    const canonical = await file(parts, { stage: "closed" });
    const row = (await synchronize(canonical.id))!;
    const fakeCanonicalWriter: UpdateLinkedFileFacts = async (
      tx,
      by,
      id,
      input,
    ) => {
      expect(by.id).toBe(actor.id);
      expect(id).toBe(canonical.id);
      expect(input).toEqual({
        expectedRevision: canonical.revision,
        purchasePriceCents: 500,
      });
      const saved = await tx.matter.update({
        where: { id, revision: input.expectedRevision },
        data: {
          purchasePriceCents: input.purchasePriceCents,
          revision: { increment: 1 },
        },
        select: { revision: true },
      });
      return { matterId: id, revision: saved.revision };
    };
    const app = express()
      .use(express.json())
      .use((req, _res, next) => {
        if (req.get("x-test-role"))
          req.principal = {
            ...actor,
            role: req.get("x-test-role") === "agent" ? "agent" : "coordinator",
          };
        next();
      })
      .use(
        "/hto",
        createHtoOperationsRouter({ updateFileFacts: fakeCanonicalWriter }),
      );
    const errors: express.ErrorRequestHandler = (err, _req, res, _next) => {
      res
        .status(err instanceof HttpError ? err.status : 500)
        .json(sanitizeError(err));
    };
    app.use(errors);
    await request(app)
      .get("/hto")
      .expect(401)
      .expect("Cache-Control", "private, no-store");
    await request(app)
      .post("/hto/export")
      .set("x-test-role", "agent")
      .send({ filters: {} })
      .expect(403);
    await request(app)
      .patch(`/hto/rows/${row.id}/facts`)
      .set("x-test-role", "coordinator")
      .send({ expectedRevision: canonical.revision, purchasePriceCents: 500 })
      .expect(200);
    expect((await view()).rows[0]).toMatchObject({
      status: "closed",
      purchasePriceCents: 500,
    });
    await request(app)
      .post("/hto/export")
      .set("x-test-role", "coordinator")
      .send({ filters: { agentId: rosterId } })
      .expect(422)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({
          code: "HTO_EXPORT_INCOMPLETE",
          issues: [
            { rowId: row.id, clientNumber: null, missing: ["name", "phone"] },
          ],
        });
      });
    await prisma.matterContact.create({
      data: {
        matterId: canonical.id,
        role: "seller",
        name: "Confirmed Synthetic",
        phone: "555-0146",
      },
    });
    await request(app)
      .post("/hto/export")
      .set("x-test-role", "coordinator")
      .send({ filters: { agentId: rosterId } })
      .expect(200)
      .expect("Content-Type", /^text\/csv/)
      .expect(
        "Content-Disposition",
        'attachment; filename="synthetic-closings-for-FUB.csv"',
      );
  });
});
