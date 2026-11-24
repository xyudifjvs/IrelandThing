import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Prisma, prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import type { ChecklistDateInput } from "@weatherly/platform/handoff-contracts";
import {
  seedMatterChecklist,
  readChecklistSnapshot,
} from "../../matters/src/checklist/persistence";
import { getMatter, listMatters } from "../../matters/src/projections/matters";
import {
  createChecklistShare,
  getPublicChecklist,
} from "../../matters/src/checklist-sharing";
import { updateTask } from "../../matters/src/commands/tasks";
import { checklistDateLabel } from "../../matters/src/checklist/display";
import { confirmCreationReview } from "../src/creation-review/confirm";
import {
  startCreationReview,
  saveCreationReview,
  readCreationReview,
} from "../src/creation-review/storage";
import {
  assembleDates,
  previewDates,
  reviewDates,
} from "../../../apps/web/app/(workspace)/workspace/_features/creation/review-model";
import { clientStepDate } from "../../../apps/web/app/(portal)/portal/_views/portal-model";

type Task = Prisma.TaskGetPayload<object>;

const actors = (["coordinator", "agent", "client"] as const).map(
  (role): Principal => {
    const id = randomUUID();
    return {
      id,
      role,
      name: "Synthetic",
      email: `${id}@example.test`,
      sessionId: id,
    };
  },
);
const [owner, agent, client] = actors;
const createdMatterIds = new Set<string>();
beforeAll(async () => {
  await prisma.user.createMany({
    data: actors.map(({ id, role, name, email }) => ({
      id,
      role,
      name,
      email,
    })),
  });
});
afterAll(async () => {
  await prisma.creationReview.deleteMany({ where: { ownerId: owner.id } });
  await prisma.intakeSubmission.deleteMany({ where: { userId: agent.id } });
  await prisma.matter.deleteMany({
    where: { id: { in: [...createdMatterIds] } },
  });
  await prisma.auditEvent.deleteMany({
    where: { actorId: { in: actors.map((actor) => actor.id) } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: actors.map((actor) => actor.id) } },
  });
});
const fixed = (date: string) => ({ date, instant: null });
const dates: ChecklistDateInput[] = [
  { key: "preapproval_pof", value: null, rule: null, dateWording: "Received" },
  { key: "inspections", value: fixed("2026-08-13"), rule: { kind: "fixed" } },
  {
    key: "remedies",
    value: fixed("2026-08-15"),
    rule: { kind: "fixed" },
    dateWording: "on or before 8/15/26",
  },
  {
    key: "remedies_negotiated",
    value: null,
    rule: {
      kind: "relative",
      offset: {
        anchor: { kind: "step", key: "remedies" },
        amount: 3,
        unit: "days",
        counting: "calendar",
        rollover: "none",
        calendar: null,
      },
    },
  },
  {
    key: "final_walkthrough",
    value: null,
    rule: null,
    dateWording: "within 3 days of closing",
  },
  {
    key: "closing",
    value: fixed("2026-08-30"),
    rule: { kind: "fixed" },
    dateWording: "on or before 8/30/26",
  },
  {
    key: "possession",
    value: null,
    rule: null,
    dateWording: "date and time of closing",
  },
];

describe("checklist date and display text", () => {
  it.each([false, true])(
    "saves, resumes, and confirms date/text entries with intake=%s",
    async (withIntake) => {
      const pending = withIntake
        ? await prisma.matter.create({
            data: {
              title: "Synthetic pending",
              propertyAddress: "1 Synthetic Lane",
              side: "buyer",
              packageCode: "hto_included",
              business: "hto",
              stage: "pending_review",
              agentId: agent.id,
            },
          })
        : null;
      if (pending) createdMatterIds.add(pending.id);
      const intake = pending
        ? await prisma.intakeSubmission.create({
            data: {
              userId: agent.id,
              draftId: randomUUID(),
              idempotencyKey: randomUUID(),
              snapshot: {},
              matterId: pending.id,
            },
          })
        : null;
      const review = await startCreationReview(owner, {
        requestId: randomUUID(),
        ...(intake ? { intakeId: intake.id } : {}),
      });
      const saved = await saveCreationReview(owner, review.id, {
        expectedRevision: review.revision,
        dates,
      });
      const resumed = await readCreationReview(owner, review.id);
      expect(resumed.dates).toEqual(dates);
      const result = await confirmCreationReview(
        owner,
        review.id,
        {
          requestId: randomUUID(),
          expectedRevision: saved.revision,
          business: { business: "hto", packageCode: "hto_included" },
          facts: {
            title: "Synthetic display text",
            propertyAddress: "1 Synthetic Lane",
            side: "buyer",
            agentId: agent.id,
            agentRosterId: null,
            purchaseType: "financed",
            purchasePriceCents: null,
            acceptance: null,
            deadlineTimeZone: "America/New_York",
          },
          people: [
            { role: "client", name: "Synthetic Buyer", email: "", phone: "" },
          ],
          dates: resumed.dates,
        },
        {
          seedChecklist: seedMatterChecklist,
          seedPeople: async () => {},
          afterConfirm: async () => {},
        },
      );
      createdMatterIds.add(result.matterId);
      await prisma.matterParticipant.create({
        data: { matterId: result.matterId, userId: client.id, role: "client" },
      });
      const coordinator = (await getMatter(owner, result.matterId)) as {
        tasks: Task[];
      };
      const received = coordinator.tasks.find(
        (t) => t.stepKey === "preapproval_pof",
      )!;
      expect(received).toMatchObject({
        dueDate: null,
        status: "pending",
        details: { dateWording: "Received" },
      });
      const inspection = coordinator.tasks.find(
        (t) => t.stepKey === "inspections",
      )!;
      await updateTask(owner, result.matterId, inspection.id, {
        expectedRevision: inspection.revision,
        note: "PRIVATE-NOTE",
        showNoteToAgent: false,
      });
      const share = await createChecklistShare(owner, result.matterId);
      const publicView = await getPublicChecklist(
        new URL(share.url).hash.slice(1),
      );
      const clientView = await getMatter(client, result.matterId);
      const agentView = await getMatter(agent, result.matterId);
      expect(clientView.tasks).toEqual(publicView.tasks);
      const agentListView = (await listMatters(agent)).find(
        (m) => m.id === result.matterId,
      )!;
      for (const view of [
        clientView,
        agentView,
        publicView,
        agentListView,
        (await listMatters(client)).find((m) => m.id === result.matterId)!,
      ]) {
        const tasks = view.tasks as {
          id: string;
          title: string;
          status: string;
          stepKey: string | null;
          dateLabel?: string;
        }[];
        const label = (key: string) =>
          tasks.find((t) => t.stepKey === key)?.dateLabel;
        expect(label("preapproval_pof")).toBe("Received");
        expect(label("inspections")).toBe("By 8/13/26");
        expect(label("remedies")).toBe("on or before 8/15/26");
        expect(label("remedies_negotiated")).toBe("By 8/18/26");
        expect(label("final_walkthrough")).toBe("within 3 days of closing");
        expect(label("closing")).toBe("on or before 8/30/26");
        expect(label("possession")).toBe("date and time of closing");
        expect(JSON.stringify(tasks)).not.toMatch(
          /PRIVATE-NOTE|dateRule|details|checklistDateAnchors/,
        );
        expect(
          tasks
            .filter((t) =>
              ["inspections", "remedies", "remedies_negotiated"].includes(
                t.stepKey!,
              ),
            )
            .map((t) => t.title),
        ).toEqual(["Home Inspections", "Remedies", "Remedies Negotiated"]);
      }
      const remedies = coordinator.tasks.find((t) => t.stepKey === "remedies")!;
      await updateTask(owner, result.matterId, remedies.id, {
        expectedRevision: remedies.revision,
        status: "completed",
        dateWording: "Received",
      });
      expect(
        (await getPublicChecklist(new URL(share.url).hash.slice(1))).tasks.find(
          (t) => t.id === remedies.id,
        ),
      ).toMatchObject({
        status: "completed",
        dateLabel: "Received",
        dueDate: "2026-08-15",
      });
    },
  );

  it("keeps wording literal and out of date calculations, with one Remedies row per side", () => {
    for (const side of ["buyer", "seller"] as const)
      expect(
        reviewDates({ side }).filter((row) => row.key === "remedies"),
      ).toHaveLength(1);
    const assembled = assembleDates({ side: "buyer" }, dates, null);
    expect(assembled.find((d) => d.key === "possession")?.dateWording).toBe(
      "date and time of closing",
    );
    expect(
      previewDates({ side: "buyer" }, assembled).get("final_walkthrough"),
    ).toBeNull();
    expect(
      checklistDateLabel(
        { dueDate: "2026-08-13", dateRule: { kind: "fixed" } },
        "final_walkthrough",
      ),
    ).toBe("8/13/26");
    expect(
      checklistDateLabel(
        {
          dueDate: "2026-08-30",
          dueAt: "2026-08-30T18:30:00Z",
          dateRule: { kind: "fixed" },
        },
        "closing",
      ),
    ).toBe("on or before 8/30/26 at 2:30 PM EDT");
    expect(
      clientStepDate({
        id: "x",
        title: "Possession",
        status: "pending",
        dueDate: null,
        dateLabel: "date and time of closing",
      }),
    ).toBe("date and time of closing");
  });

  it("backfills an old hidden Remedies node without losing dates, rules, state, order, or privacy", async () => {
    const rule = { kind: "fixed" };
    const old = await prisma.matter.create({
      data: {
        title: "Synthetic old canonical",
        propertyAddress: "2 Synthetic Lane",
        side: "seller",
        packageCode: "hto_included",
        checklistVersion: 1,
        details: {
          privateNote: "PRIVATE",
          checklistDateAnchors: [
            {
              key: "remedies",
              dateCapable: true,
              status: "completed",
              due: { date: "2026-08-15", instant: "2026-08-15T18:00:00Z" },
              actual: fixed("2026-08-14"),
              rule,
            },
          ],
        },
        tasks: {
          create: [
            {
              stepKey: "inspections",
              title: "Buyer's Inspections",
              position: 0,
              dateCapable: true,
              visibility: "agent",
            },
            {
              stepKey: "remedies_negotiated",
              title: "Repairs Agreed On",
              position: 1,
              dateCapable: true,
              status: "completed",
              dueDate: "2026-08-18",
            },
            {
              stepKey: "custom_example",
              title: "Custom later",
              position: 2,
              dateCapable: true,
            },
          ],
        },
      },
    });
    createdMatterIds.add(old.id);
    const sql = await readFile(
      new URL(
        "../../db/prisma/migrations/20261118010000_remedies_checklist_step/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const connection = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await connection.connect();
    try {
      await connection.query(sql);
    } finally {
      await connection.end();
    }
    const updated = await prisma.matter.findUniqueOrThrow({
      where: { id: old.id },
      include: { tasks: { orderBy: { position: "asc" } } },
    });
    expect(updated.tasks.map((t) => t.title)).toEqual([
      "Buyer's Inspections",
      "Remedies",
      "Remedies Negotiated",
      "Custom later",
    ]);
    expect(updated.tasks[1]).toMatchObject({
      status: "completed",
      visibility: "agent",
      dueDate: "2026-08-15",
      dueAt: new Date("2026-08-15T18:00:00Z"),
      actualDate: "2026-08-14",
      dateRule: rule,
    });
    expect(updated.tasks[2]).toMatchObject({
      status: "completed",
      dueDate: "2026-08-18",
    });
    expect(updated.details).toMatchObject({
      privateNote: "PRIVATE",
      checklistDateAnchors: [],
    });
    const snapshot = await prisma.$transaction((tx) =>
      readChecklistSnapshot(tx, updated),
    );
    expect(
      snapshot.snapshot.nodes.filter((n) => n.key === "remedies"),
    ).toHaveLength(1);
  });
});
