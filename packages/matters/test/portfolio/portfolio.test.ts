import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import {
  listPortfolioCalendar,
  listPortfolioDue,
  listPortfolioTransactions,
  type PortfolioDependencies,
} from "../../src/portfolio/router";
import { listNewIntakes } from "../../src/portfolio/intakes";

const suffix = randomUUID();
const owner: Principal = {
  id: "portfolio-owner-" + suffix,
  name: "Ireland",
  email: "owner@example.test",
  role: "coordinator",
  sessionId: suffix,
};
const base = {
  title: "Synthetic " + suffix,
  propertyAddress: "3 Synthetic Lane " + suffix,
  side: "buyer",
  packageCode: "essentials",
};
let target: string;
let legacy: string;
let intake: string;
let rosterId: string;
const work: PortfolioDependencies = {
  listEmailWork: async (_actor, query) => [
    {
      id: "dated",
      title: "Closing prep",
      propertyAddress: base.propertyAddress,
      matterId: target,
      remindOn: "2027-01-08",
      toSend: true,
    },
    ...(query.through
      ? []
      : [
          {
            id: "later",
            title: "Save for later",
            propertyAddress: base.propertyAddress,
            matterId: target,
            remindOn: null,
            toSend: true,
          },
        ]),
    {
      id: "sent",
      title: "Completed message",
      propertyAddress: base.propertyAddress,
      matterId: target,
      remindOn: "2027-01-08",
      toSend: false,
    },
  ],
};

beforeAll(async () => {
  await prisma.user.create({
    data: {
      id: owner.id,
      name: owner.name,
      role: owner.role,
      email: owner.id + "@example.test",
    },
  });
  const roster = await prisma.rosterAgent.create({
    data: { name: "Serving Agent", business: "hto" },
  });
  rosterId = roster.id;
  const primary = await prisma.matter.create({
    data: {
      ...base,
      rosterAgent: { connect: { id: rosterId } },
      business: "hto",
      checklistVersion: 1,
      contacts: {
        create: [
          { role: "client", name: "Matched Customer" },
          { role: "co_op_agent", name: "Other Side Person" },
          { role: "client", name: "Retired Client", retiredAt: new Date() },
        ],
      },
      tasks: {
        create: [
          {
            title: "Inspections",
            stepKey: "inspection",
            dueDate: "2027-01-06",
          },
          {
            title: "Closing",
            stepKey: "closing",
            dueDate: "2027-01-09",
            details: { appointmentAt: "2027-01-10T01:00:00.000Z" },
          },
          { title: "Undated", stepKey: "undated" },
          {
            title: "Completed",
            stepKey: "completed",
            dueDate: "2027-01-01",
            status: "completed",
          },
          {
            title: "Not needed",
            stepKey: "not_needed",
            dueDate: "2027-01-02",
            status: "not_applicable",
          },
          { title: "Pre-canonical date", dueDate: "2027-01-03" },
        ],
      },
      deadlines: {
        create: {
          label: "Pre-canonical deadline",
          date: "2027-01-04",
          status: "confirmed",
        },
      },
    },
  });
  target = primary.id;
  legacy = (
    await prisma.matter.create({
      data: {
        ...base,
        stage: "closed",
        details: { clients: [{ name: "Historic Client" }] },
        deadlines: {
          create: {
            label: "Closing date",
            date: "2027-01-04",
            status: "confirmed",
          },
        },
      },
    })
  ).id;
  await prisma.matter.createMany({
    data: [
      ...Array.from({ length: 102 }, () => ({
        ...base,
        business: "hto" as const,
        agentRosterId: rosterId,
      })),
      { ...base, stage: "terminated" },
      { ...base, stage: "pre_listing" },
    ],
  });
  const pending = await prisma.matter.create({
    data: { ...base, stage: "pending_review" },
  });
  intake = (
    await prisma.intakeSubmission.create({
      data: {
        draftId: "draft-" + suffix,
        idempotencyKey: "key-" + suffix,
        userId: owner.id,
        matterId: pending.id,
        snapshot: {
          propertyAddress: "Intake " + suffix,
          side: "seller",
          submitter: {
            name: "Submitted Name",
            email: "sample@example.test",
            brokerage: null,
            phone: null,
          },
        },
      },
    })
  ).id;
  await prisma.intakeSubmission.create({
    data: {
      draftId: "deleted-draft-" + suffix,
      idempotencyKey: "deleted-key-" + suffix,
      userId: owner.id,
      matterId: pending.id,
      snapshot: { propertyAddress: "Deleted " + suffix },
      deletedAt: new Date(),
    },
  });
});

afterAll(async () => {
  await prisma.intakeSubmission.deleteMany({ where: { userId: owner.id } });
  await prisma.matter.deleteMany({ where: { title: base.title } });
  await prisma.rosterAgent.delete({ where: { id: rosterId } });
  await prisma.user.delete({ where: { id: owner.id } });
  await prisma.$disconnect();
});

it("counts a combined search before pagination and identifies the serving agent and active client", async () => {
  const filtered = {
    status: "active",
    business: "hto",
    q: "Serving Agent " + suffix,
    limit: "100",
  };
  const first = await listPortfolioTransactions(owner, filtered, work);
  const second = await listPortfolioTransactions(
    owner,
    { ...filtered, page: "2" },
    work,
  );
  expect(first.total).toBe(103);
  expect(first.items).toHaveLength(100);
  expect(second.items).toHaveLength(3);
  expect(
    new Set([...first.items, ...second.items].map((row) => row.id)).size,
  ).toBe(103);
  const matched = await listPortfolioTransactions(
    owner,
    { ...filtered, q: "Matched Customer Serving Agent" },
    work,
  );
  expect(matched.items).toMatchObject([
    {
      id: target,
      agentName: "Serving Agent",
      closing: "2027-01-09",
      nextDeadline: { label: "Inspections" },
      toSend: { count: 2, next: { id: "dated" } },
    },
  ]);
  for (const q of ["Other Side Person", "Retired Client"]) {
    expect(
      (await listPortfolioTransactions(owner, { ...filtered, q }, work)).total,
    ).toBe(0);
  }
  expect(
    (
      await listPortfolioTransactions(
        owner,
        { status: "closed", business: "weatherly", q: "Historic Client" },
        work,
      )
    ).items,
  ).toMatchObject([
    {
      id: legacy,
      closing: "2027-01-04",
      nextDeadline: null,
      toSend: { count: 0 },
    },
  ]);
});

it("uses canonical active dates for Due this week and preserves completed appointments on the range calendar", async () => {
  const due = await listPortfolioDue(
    owner,
    work,
    new Date("2027-01-05T05:00:00Z"),
  );
  expect(
    due.items
      .filter((item) => item.matterId === target)
      .map(({ label }) => label),
  ).toEqual(["Inspections", "Closing prep", "Closing", "Closing appointment"]);
  expect(due.items.some((item) => item.matterId === legacy)).toBe(false);
  const calendar = await listPortfolioCalendar(owner, {
    from: "2027-01-01",
    through: "2027-01-10",
  });
  expect(
    calendar
      .filter((item) => item.matterId === target)
      .map(({ label, day }) => [label, day]),
  ).toEqual([
    ["Completed", "2027-01-01"],
    ["Inspections", "2027-01-06"],
    ["Closing", "2027-01-09"],
    ["Closing appointment", "2027-01-09"],
  ]);
  expect(calendar).toContainEqual(
    expect.objectContaining({ matterId: legacy, label: "Closing date" }),
  );
  await expect(
    listPortfolioCalendar(owner, { from: "2027-01-01", through: "2027-06-10" }),
  ).rejects.toMatchObject({ status: 422 });
});

it("projects pending intake metadata and denies non-coordinator portfolio reads", async () => {
  const rows = await listNewIntakes(owner, 1, 30);
  expect(rows.items.find((row) => row.id === intake)).toMatchObject({
    agentName: "Submitted Name",
    propertyAddress: "Intake " + suffix,
    side: "seller",
    hasContract: false,
  });
  expect(
    rows.items.some((row) => row.propertyAddress === "Deleted " + suffix),
  ).toBe(false);
  const agent = { ...owner, role: "agent" as const };
  await expect(listNewIntakes(agent, 1, 30)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    listPortfolioTransactions(agent, {}, work),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    listPortfolioCalendar(agent, { from: "2027-01-01", through: "2027-01-10" }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(listPortfolioDue(agent, work)).rejects.toMatchObject({
    status: 403,
  });
});
