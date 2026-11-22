import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { beforeAll, afterAll, expect, it } from "vitest";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import {
  checklistTemplate,
  clientChecklistTemplate,
} from "../../src/checklist/templates";
import {
  seedMatterChecklist,
  readChecklistSnapshot,
} from "../../src/checklist/persistence";
import { getMatter, listMatters } from "../../src/projections/matters";
import {
  createChecklistShare,
  getPublicChecklist,
} from "../../src/checklist-sharing";
import { clientTimelineLayout } from "../../src/projections/client-timeline-layout";
import { mergeFields } from "../../../communications/src/merge-fields";
const prefix = `unified-${randomUUID()}`;
const owner: Principal = {
  id: prefix,
  name: "Synthetic owner",
  email: `${prefix}@example.test`,
  role: "coordinator",
  sessionId: prefix,
};
const client: Principal = {
  ...owner,
  id: prefix + "-client",
  role: "client",
  email: prefix + "-client@example.test",
};
const files: string[] = [];
beforeAll(async () => {
  await prisma.user.createMany({
    data: [owner, client].map(({ id, name, email, role }) => ({
      id,
      name,
      email,
      role,
    })),
  });
});
afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { actorId: owner.id } });
  await prisma.matter.deleteMany({ where: { id: { in: files } } });
  await prisma.user.deleteMany({
    where: { id: { in: [owner.id, client.id] } },
  });
});
async function file() {
  const matter = await prisma.matter.create({
    data: {
      title: "Synthetic seller",
      propertyAddress: "1 Synthetic Lane",
      side: "seller",
      packageCode: "essentials",
      details: { purchaseType: "financed" },
    },
  });
  files.push(matter.id);
  await prisma.matterParticipant.create({
    data: { matterId: matter.id, userId: client.id, role: "client" },
  });
  return matter.id;
}
it("creates the same master checklist for either side with its separate seller client timeline in account and shared-link access", async () => {
  const id = await file();
  await prisma.$transaction((tx) =>
    seedMatterChecklist(tx, id, {
      side: "seller",
      purchaseType: "financed",
      acceptance: null,
      timeZone: "America/New_York",
      dates: [
        {
          key: "title_commitment",
          value: { date: "2026-12-05", instant: null },
          rule: { kind: "fixed" },
        },
      ],
    }),
  );
  const coordinator = await getMatter(owner, id),
    view = await getMatter(client, id);
  expect(coordinator.tasks.map((task) => task.title)).toEqual(
    checklistTemplate("buyer", "financed").map((task) => task.title),
  );
  expect(view.tasks.map((task) => task.title)).toEqual(
    clientTimelineLayout("seller").map(([, title]) => title),
  );
  expect(
    view.tasks.find((task) => task.stepKey === "title_commitment"),
  ).toBeUndefined();
  expect(view.tasks.some((task) => task.stepKey === "appraisal_ordered")).toBe(
    true,
  );
  const list = await listMatters(client);
  expect(
    list.find((matter) => matter.id === id)?.tasks.map((task) => task.title),
  ).toEqual(view.tasks.map((task) => task.title));
  const share = await createChecklistShare(owner, id, {});
  const publicView = await getPublicChecklist(new URL(share.url).hash.slice(1));
  expect(publicView.tasks.map((task) => task.title)).toEqual(
    view.tasks.map((task) => task.title),
  );
  expect(JSON.stringify(publicView)).not.toMatch(
    /dateRule|clientPosition|checklistDateAnchors|coordinatorChecklistUnified/,
  );
});
it("backfills old seller working lists without losing dates, private notes, custom steps, existing client dates or title rules, and is idempotent", async () => {
  const id = await file();
  await prisma.matter.update({
    where: { id },
    data: { checklistVersion: 1, deadlineTimeZone: "America/New_York" },
  });
  const original = clientChecklistTemplate("seller", "financed");
  await prisma.task.createMany({
    data: original.map((step, position) => ({
      matterId: id,
      title: step.title,
      stepKey: step.key,
      position,
      kind: "checklist",
      visibility: "client",
      dateCapable: step.dateCapable,
      status: step.key === "appraisal" ? "completed" : "pending",
      dueDate: step.key === "title_commitment" ? "2026-12-05" : null,
      dateRule: step.key === "title_commitment" ? { kind: "fixed" } : undefined,
      details: {
        scheduled: step.scheduled,
        dateWording: step.key === "title_commitment" ? "By December 5" : "",
        note: "Private source note",
        showNoteToAgent: false,
      },
    })),
  });
  const custom = await prisma.task.create({
    data: {
      matterId: id,
      title: "Custom follow-up",
      stepKey: "custom_followup",
      kind: "custom",
      dateCapable: true,
      position: 20,
      visibility: "client",
      details: { scheduled: false },
    },
  });
  const before = await getMatter(client, id);
  const sql = await readFile(
    new URL(
      "../../../db/prisma/migrations/20261122010100_unified_working_checklist/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const titleSql = await readFile(
    new URL(
      "../../../db/prisma/migrations/20261122010200_title_commitment_step/migration.sql",
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
    await connection.query(titleSql);
  } finally {
    await connection.end();
  }
  const coordinator = await getMatter(owner, id),
    view = await getMatter(client, id);
  expect(coordinator.tasks.slice(0, 18).map((task) => task.title)).toEqual(
    checklistTemplate("buyer", "financed").map((task) => task.title),
  );
  expect(coordinator.tasks[18].id).toBe(custom.id);
  expect(
    view.tasks
      .filter((task) => task.stepKey !== "appraisal_ordered")
      .map((task) => [task.id, task.title, task.status, task.dueDate]),
  ).toEqual(
    before.tasks.map((task) => [
      task.id,
      task.title,
      task.status,
      task.dueDate,
    ]),
  );
  expect(JSON.stringify(view)).not.toContain("Private source note");
  const source = await prisma.matter.findUniqueOrThrow({
    where: { id },
    include: { tasks: true },
  });
  expect(
    source.tasks
      .filter((task) => task.stepKey)
      .filter((task) => task.stepKey !== "custom_followup")
      .every(
        (task) =>
          (task.details as any).note === "Private source note" ||
          [
            "preapproval_pof",
            "loan_application",
            "condo_hoa_doc_review",
            "appraisal_ordered",
          ].includes(task.stepKey!),
      ),
  ).toBe(true);
  const archivedTitle = source.tasks.find(
    (task) => (task.details as any).originalChecklistKey === "title_commitment",
  );
  expect(archivedTitle?.dueDate).toBe("2026-12-05");
  const graph = await prisma.$transaction((tx) =>
    readChecklistSnapshot(tx, source),
  );
  expect(
    graph.snapshot.nodes.find((node) => node.key === "title_commitment")?.due
      ?.date,
  ).toBe("2026-12-05");
  expect(
    (await mergeFields(owner, id)).find(
      (field) => field.key === "title_commitment_deadline",
    )?.value,
  ).toBe("By December 5");
  const again = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await again.connect();
  try {
    await again.query(sql);
    await again.query(titleSql);
  } finally {
    await again.end();
  }
  expect(
    await prisma.matter.findUniqueOrThrow({
      where: { id },
      include: { tasks: true },
    }),
  ).toEqual(source);
});
