import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { prisma, type Prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import { listAgentCalendar } from "../../src/portfolio/agent-calendar";
import {
  createPortfolioRouter,
  listPortfolioCalendar,
} from "../../src/portfolio/router";
import { appointmentCalendarLabel } from "../../src/portfolio/calendar-labels";

const prefix = `agent-cal-${randomUUID()}`;
const agent: Principal = {
  id: prefix,
  role: "agent",
  name: "Synthetic agent",
  email: `${prefix}@example.test`,
  sessionId: prefix,
};
const other = {
  ...agent,
  id: prefix + "-other",
  email: `${prefix}-other@example.test`,
};
const owner = {
  ...agent,
  id: prefix + "-owner",
  email: `${prefix}-owner@example.test`,
  role: "coordinator" as const,
};
const ids: string[] = [];
const range = { from: "2026-11-01", through: "2026-12-12" };
const now = new Date("2026-11-23T18:00:00Z");
beforeAll(async () => {
  await prisma.user.createMany({
    data: [agent, other, owner].map(({ id, role, name, email }) => ({
      id,
      role,
      name,
      email,
    })),
  });
});
afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { matterId: { in: ids } } });
  await prisma.intakeSubmission.deleteMany({
    where: { matterId: { in: ids } },
  });
  await prisma.matter.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({
    where: { id: { in: [agent.id, other.id, owner.id] } },
  });
});
async function file(
  patch: Partial<Prisma.MatterCreateInput> = {},
  tasks: Prisma.TaskCreateWithoutMatterInput[] = [
    {
      title: "Loan Application",
      stepKey: "loan_application",
      dueDate: "2026-11-25",
    },
  ],
) {
  const row = await prisma.matter.create({
    data: {
      title: "Synthetic calendar file",
      propertyAddress: "930 Sample Rd, Lancaster, OH 43130",
      side: "buyer",
      packageCode: "essentials",
      business: "hto",
      agent: { connect: { id: agent.id } },
      checklistVersion: 1,
      ...patch,
      tasks: { create: tasks },
    },
  });
  ids.push(row.id);
  return row;
}
async function eventsFor(id: string) {
  return (await listAgentCalendar(agent, range, now)).items.filter(
    (item) => item.matterId === id,
  );
}

it("includes every own active business/side and active participant, excluding terminal, pending and inaccessible files", async () => {
  const own = await file({
    contacts: {
      create: [
        { name: "Visible client", role: "client", shareWithAgent: true },
        { name: "Private client", role: "buyer", shareWithAgent: false },
        {
          name: "Retired client",
          role: "seller",
          shareWithAgent: true,
          retiredAt: now,
        },
      ],
    },
  });
  const seller = await file({
    side: "seller",
    business: "weatherly",
    stage: "closing",
  });
  const listing = await file({ stage: "listing" });
  const participant = await file({
    agent: { connect: { id: other.id } },
    participants: { create: { userId: agent.id, role: "agent" } },
  });
  const hidden = await Promise.all(
    ["closed", "terminated", "archived", "pending_review"].map((stage) =>
      file({ stage }),
    ),
  );
  hidden.push(await file({ details: { fileReview: { status: "pending" } } }));
  hidden.push(await file({ agent: { connect: { id: other.id } } }));
  const revoked = await file({
    agent: { connect: { id: other.id } },
    participants: {
      create: { userId: agent.id, role: "agent", revokedAt: now },
    },
  });
  const response = await listAgentCalendar(agent, range, now);
  for (const row of [own, seller, listing, participant])
    expect(response.items.some((item) => item.matterId === row.id)).toBe(true);
  for (const row of [...hidden, revoked])
    expect(response.items.some((item) => item.matterId === row.id)).toBe(false);
  expect(response.items.find((item) => item.matterId === own.id)).toMatchObject(
    { side: "buyer", clientNames: ["Visible client"] },
  );
  expect(JSON.stringify(response)).not.toContain("Private client");
  await prisma.matterParticipant.update({
    where: { matterId_userId: { matterId: participant.id, userId: agent.id } },
    data: { revokedAt: now },
  });
  expect(await eventsFor(participant.id)).toEqual([]);
});

it("omits skipped, proposed, coordinator-only and client-only steps, exposing no raw task details", async () => {
  const row = await file({}, [
    {
      title: "Visible",
      stepKey: "visible",
      dueDate: "2026-11-25",
      details: { note: "Private note", internal: "Internal source" },
    },
    ...["not_applicable", "not_needed", "proposed"].map((status) => ({
      title: status,
      stepKey: status,
      dueDate: "2026-11-25",
      status,
    })),
    ...["coordinator", "client_only"].map((visibility) => ({
      title: visibility,
      stepKey: visibility,
      dueDate: "2026-11-25",
      visibility,
      details: {
        scheduled: true,
        appointmentAt: "2026-11-25T16:00:00Z",
        appointmentPlace: "Hidden location",
      },
    })),
  ]);
  const events = await eventsFor(row.id);
  expect(events.map((item) => item.label)).toEqual(["Visible"]);
  expect(JSON.stringify(events)).not.toMatch(
    /Private note|Internal source|Hidden location|details|visibility/,
  );
});

it("hides pending intake files and respects approved legacy dates, skipped deadlines and appointment associations", async () => {
  const pending = await file();
  await prisma.intakeSubmission.create({
    data: {
      draftId: pending.id,
      idempotencyKey: pending.id,
      userId: agent.id,
      matterId: pending.id,
      snapshot: {},
    },
  });
  expect(await eventsFor(pending.id)).toEqual([]);
  const legacy = await file(
    {
      checklistVersion: null,
      deadlines: {
        create: [
          {
            label: "Inspections",
            date: "2026-11-27",
            status: "confirmed",
            details: { workflowKey: "inspection" },
          },
          {
            label: "Private deadline",
            date: "2026-11-27",
            status: "confirmed",
            details: { workflowKey: "private" },
          },
          {
            label: "Skipped deadline",
            date: "2026-11-27",
            status: "confirmed",
            details: { workflowKey: "skipped" },
          },
          {
            label: "Unapproved deadline",
            date: "2026-11-27",
            status: "unknown",
            details: { workflowKey: "unapproved" },
          },
        ],
      },
    },
    [
      {
        title: "Home Inspections",
        dueDate: null,
        details: {
          workflowKey: "inspection",
          appointmentAt: "2026-11-25T16:00:00Z",
        },
      },
      {
        title: "Private deadline",
        dueDate: "2026-11-27",
        visibility: "coordinator",
        details: { workflowKey: "private" },
      },
      {
        title: "Skipped deadline",
        status: "not_applicable",
        details: { workflowKey: "skipped" },
      },
    ],
  );
  expect(await eventsFor(legacy.id)).toMatchObject([
    { label: "Inspection appointment", day: "2026-11-25", kind: "appointment" },
  ]);
  expect(await eventsFor(legacy.id)).toHaveLength(1);
});

it.each([
  ["appraisal_ordered", "Appraisal Ordered", "Appraisal appointment"],
  ["inspections", "Home Inspections", "Inspection appointment"],
  ["final_walkthrough", "Final Walkthrough", "Final walkthrough"],
  ["closing", "Closing", "Closing appointment"],
  ["custom_visit", "Survey", "Survey appointment"],
])(
  "names scheduled %s consistently in both calendars",
  async (stepKey, title, label) => {
    expect(appointmentCalendarLabel({ stepKey, title })).toBe(label);
    const row = await file({}, [
      {
        title,
        stepKey,
        dueDate: "2026-11-26",
        details: {
          scheduled: true,
          appointmentAt: "2026-11-25T16:00:00Z",
          appointmentPlace: "Synthetic office",
        },
      },
    ]);
    expect(await eventsFor(row.id)).toMatchObject([
      {
        label,
        kind: "appointment",
        day: "2026-11-25",
        at: "2026-11-25T16:00:00Z",
        location: "Synthetic office",
      },
    ]);
    const tc = (await listPortfolioCalendar(owner, range)).filter(
      (item) => item.matterId === row.id && item.kind === "appointment",
    );
    expect(tc).toMatchObject([{ label }]);
  },
);

it("keeps completed events but excludes them from Next 7 days, and uses the appraisal check-off audit rather than its later edits", async () => {
  const row = await file({}, [
    {
      title: "Appraisal Ordered",
      stepKey: "appraisal_ordered",
      dueDate: "2026-11-27",
      status: "completed",
      updatedAt: new Date("2026-12-03T16:00:00Z"),
    },
    {
      title: "Closing",
      stepKey: "closing",
      dueDate: "2026-11-25",
      status: "signed",
    },
  ]);
  const task = await prisma.task.findFirstOrThrow({
    where: { matterId: row.id, stepKey: "appraisal_ordered" },
  });
  await prisma.auditEvent.createMany({
    data: [
      {
        actorId: owner.id,
        matterId: row.id,
        entityId: task.id,
        entityType: "Task",
        action: "task.updated",
        details: { changes: { status: "completed" } },
        createdAt: new Date("2026-11-24T02:00:00Z"),
      },
      {
        actorId: owner.id,
        matterId: row.id,
        entityId: task.id,
        entityType: "Task",
        action: "task.updated",
        details: { changes: { note: "Later edit" } },
        createdAt: new Date("2026-12-03T16:00:00Z"),
      },
    ],
  });
  const items = await eventsFor(row.id);
  expect(items).toContainEqual(
    expect.objectContaining({
      label: "Appraisal ordered",
      day: "2026-11-23",
      status: "completed",
    }),
  );
  expect(
    (await listPortfolioCalendar(owner, range)).filter(
      (item) => item.matterId === row.id,
    ),
  ).toContainEqual(
    expect.objectContaining({ label: "Appraisal ordered", day: "2026-11-23" }),
  );
  expect(
    (await listAgentCalendar(agent, range, now)).next7.filter(
      (item) => item.matterId === row.id,
    ),
  ).toEqual([]);
  await prisma.task.update({
    where: { id: task.id },
    data: { status: "pending" },
  });
  expect(
    (await eventsFor(row.id)).some(
      (item) => item.label === "Appraisal ordered",
    ),
  ).toBe(false);
});

it("preserves complete appraisal appointments, civil deadlines and Eastern appointment days across UTC midnight", async () => {
  const row = await file({}, [
    {
      title: "Appraisal Ordered",
      stepKey: "appraisal_ordered",
      status: "completed",
      details: {
        scheduled: true,
        appointmentAt: "2026-11-24T01:00:00Z",
        appointmentPlace: "Synthetic address",
      },
    },
    {
      title: "Remedies",
      stepKey: "remedies",
      dueDate: "2026-11-24",
      dueAt: new Date("2026-11-25T01:00:00Z"),
    },
    {
      title: "Undated",
      stepKey: "undated",
      details: { dateWording: "Within 3 days before closing" },
    },
  ]);
  expect(await eventsFor(row.id)).toMatchObject([
    { label: "Appraisal appointment", day: "2026-11-23", status: "completed" },
    { label: "Remedies", day: "2026-11-24", kind: "task" },
  ]);
});

it("builds Next 7 days independently of the browsed month and includes today through day seven, in date/time order", async () => {
  const row = await file({}, [
    { title: "Today", stepKey: "today", dueDate: "2026-11-23" },
    { title: "Day seven", stepKey: "seven", dueDate: "2026-11-30" },
    { title: "Too late", stepKey: "late", dueDate: "2026-12-01" },
    { title: "Overdue", stepKey: "overdue", dueDate: "2026-11-22" },
    {
      title: "Closing",
      stepKey: "closing",
      details: { scheduled: true, appointmentAt: "2026-11-25T18:00:00Z" },
    },
    {
      title: "Home Inspections",
      stepKey: "inspections",
      details: { scheduled: true, appointmentAt: "2026-11-25T16:00:00Z" },
    },
  ]);
  const response = await listAgentCalendar(
    agent,
    { from: "2027-02-01", through: "2027-03-14" },
    now,
  );
  expect(response.items.filter((item) => item.matterId === row.id)).toEqual([]);
  expect(
    response.next7
      .filter((item) => item.matterId === row.id)
      .map((item) => item.label),
  ).toEqual([
    "Today",
    "Inspection appointment",
    "Closing appointment",
    "Day seven",
  ]);
  expect(response).toMatchObject({
    today: "2026-11-23",
    through: "2026-11-30",
  });
});

it("does not truncate an agent's calendar at the file-list page size", async () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({
    id: `${prefix}-bulk-${index}`,
    title: "Synthetic bulk",
    propertyAddress: `${index} Synthetic St`,
    side: "seller",
    packageCode: "essentials",
    agentId: agent.id,
    checklistVersion: 1,
  }));
  ids.push(...rows.map((row) => row.id));
  await prisma.matter.createMany({ data: rows });
  await prisma.task.createMany({
    data: rows.map((row) => ({
      matterId: row.id,
      stepKey: "closing",
      title: "Closing",
      dueDate: "2026-11-26",
    })),
  });
  expect(
    (await listAgentCalendar(agent, range, now)).items.filter((item) =>
      item.matterId.startsWith(prefix + "-bulk-"),
    ).length,
  ).toBe(205);
});

it("enforces the agent role, bounded date range, strict query and private no-store HTTP response", async () => {
  for (const role of ["client", "coordinator"] as const)
    await expect(
      listAgentCalendar({ ...agent, role }, range),
    ).rejects.toMatchObject({ status: 403 });
  await expect(
    listAgentCalendar(agent, { from: "2026-11-30", through: "2026-11-01" }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    listAgentCalendar(agent, { from: "2026-11-01", through: "2027-03-01" }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    listAgentCalendar(agent, { ...range, agentId: other.id }),
  ).rejects.toThrow();
  const app = express();
  app.use((req, _res, next) => {
    if (req.headers.authorization === "synthetic") req.principal = agent;
    next();
  });
  app.use(createPortfolioRouter({ listEmailWork: async () => [] }));
  app.use((error: any, _req: any, res: any, _next: any) =>
    res.status(error.status || 400).json({ code: error.code }),
  );
  await request(app).get("/agent-calendar").query(range).expect(401);
  const response = await request(app)
    .get("/agent-calendar")
    .set("Authorization", "synthetic")
    .query(range)
    .expect(200);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.body).toHaveProperty("items");
});
