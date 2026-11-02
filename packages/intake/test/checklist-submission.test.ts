import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@weatherly/db";
import { type Principal } from "@weatherly/platform";
import {
  createObjectStore,
  listDocuments,
  uploadDocument,
  type ObjectStore,
} from "@weatherly/documents";
import { queryStoredRecords } from "../../assistant/src/records";
import { saveIntakeDraft, submitIntake } from "../src/index";

const runId = randomUUID();
const actors = ["agent", "agent"].map((role, index): Principal => ({
  id: `intake-batch-${runId}-${index}`,
  name: `Synthetic intake ${index}`,
  email: `intake-batch-${runId}-${index}@example.test`,
  role: role as Principal["role"],
  sessionId: `intake-batch-${runId}`,
}));
const [agent, outsider] = actors;
const draftIds: string[] = [];
const matterIds: string[] = [];
let directory = "";
let store: ObjectStore;

function pdf(label: string) {
  const stream = `BT /F1 12 Tf 70 700 Td (${label}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const start = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  source += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(source);
}

async function upload(
  actor: Principal,
  name: string,
  category = "brokerage_checklist",
) {
  const bytes = pdf(name);
  return uploadDocument(
    actor,
    { category, visibility: "agent", uploadRequestId: randomUUID() },
    {
      originalname: name,
      size: bytes.length,
      buffer: bytes,
    },
    store,
  );
}

function payload(contractIds: string[], broker: Record<string, unknown>) {
  return {
    packageCode: "complete",
    side: "buyer",
    propertyAddress: `Synthetic Intake ${runId}`,
    purchaseType: "cash",
    contractSource: "upload",
    documentIds: contractIds,
    clients: [
      {
        name: "Synthetic Buyer",
        email: "buyer@example.test",
        phone: "555-0100",
      },
    ],
    directContact: "copy_agent",
    title: { choice: "have", name: "Synthetic Title" },
    hoa: "none",
    broker: {
      name: "Synthetic Broker",
      email: "broker@example.test",
      pre1978: false,
      ownChecklist: true,
      ...broker,
    },
    notes: "Synthetic intake batch test",
    gift: { requested: false },
  };
}

async function draft(savedPayload: ReturnType<typeof payload>) {
  const created = await prisma.intakeDraft.create({
    data: { userId: agent.id, payload: savedPayload },
  });
  draftIds.push(created.id);
  return created;
}

beforeAll(async () => {
  if (process.env.S3_BUCKET)
    throw new Error("Intake tests require local object storage");
  directory = await mkdtemp(join(tmpdir(), "weatherly-intake-batch-"));
  process.env.OBJECT_STORAGE_DIR = directory;
  store = createObjectStore();
  await prisma.user.createMany({
    data: actors.map(({ id, name, email, role }) => ({
      id,
      name,
      email,
      role,
      emailVerified: true,
    })),
  });
});

afterAll(async () => {
  const receipts = await prisma.intakeSubmission.findMany({
    where: { draftId: { in: draftIds } },
  });
  await prisma.outboxJob.deleteMany({
    where: {
      idempotencyKey: {
        in: receipts.map((receipt) => `intake-submitted:${receipt.id}`),
      },
    },
  });
  await prisma.intakeSubmission.deleteMany({
    where: { draftId: { in: draftIds } },
  });
  await prisma.intakeDraft.deleteMany({ where: { id: { in: draftIds } } });
  await prisma.document.deleteMany({
    where: { createdById: { in: actors.map((actor) => actor.id) } },
  });
  await prisma.matter.deleteMany({ where: { id: { in: matterIds } } });
  await prisma.auditEvent.deleteMany({
    where: { actorId: { in: actors.map((actor) => actor.id) } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: actors.map((actor) => actor.id) } },
  });
  await prisma.$disconnect();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("durable intake document batch submissions", () => {
  it("creates a visible transaction from blank fields without documents and returns the same receipt on retry", async () => {
    const savedPayload = {
      ...payload([], {}),
      propertyAddress: "",
      purchaseType: "financed",
      clients: [{ name: "", email: "", phone: "" }],
      title: { choice: "have" },
      broker: { name: "", email: "", pre1978: false, ownChecklist: false },
    };
    const created = await prisma.intakeDraft.create({
      data: { userId: agent.id, payload: savedPayload },
    });
    draftIds.push(created.id);
    const input = {
      expectedRevision: 1,
      idempotencyKey: `submit-${created.id}`,
    };
    const result = await submitIntake(agent, created.id, input);
    matterIds.push(result.matter.id);
    expect(result.matter.title).toBe("Untitled transaction");
    expect(result.matter.propertyAddress).toBe("");
    expect(result.matter.agentId).toBe(agent.id);
    expect(result.submission.snapshot).toMatchObject({
      propertyAddress: "",
      documentIds: [],
    });
    expect(await listDocuments(agent, result.matter.id)).toEqual([]);
    const tasks = await prisma.task.findMany({
      where: { matterId: result.matter.id },
    });
    expect(tasks.map((task) => task.title)).toEqual(
      expect.arrayContaining([
        "Obtain property address",
        "Complete client contact information",
        "Obtain executed contract",
        "Obtain title company details",
        "Obtain lender details",
      ]),
    );
    const replay = await submitIntake(agent, created.id, input);
    expect(replay.matter.id).toBe(result.matter.id);
    await expect(
      submitIntake(outsider, created.id, input),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("saves every contract and checklist id, assigns all files once, and exposes them through authorized lists and MCP", async () => {
    const contracts = await Promise.all([
      upload(agent, "purchase-contract.pdf", "contract"),
      upload(agent, "amendment.pdf", "contract"),
    ]);
    const checklists = await Promise.all([
      upload(agent, "brokerage-checklist.pdf"),
      upload(agent, "brokerage-addendum.pdf"),
    ]);
    const created = await draft(payload([], {}));
    const savedPayload = payload(
      contracts.map((doc) => doc.id),
      {
        checklistDocumentId: checklists[0].id,
        checklistDocumentIds: checklists.map((doc) => doc.id),
      },
    );
    const saved = await saveIntakeDraft(agent, created.id, {
      expectedRevision: 1,
      payload: savedPayload,
    });
    expect(
      (
        await prisma.intakeDraft.findUniqueOrThrow({
          where: { id: created.id },
        })
      ).payload,
    ).toEqual(savedPayload);
    const result = await submitIntake(agent, created.id, {
      expectedRevision: saved.revision,
      idempotencyKey: `submit-${created.id}`,
    });
    matterIds.push(result.matter.id);
    const ids = [...contracts, ...checklists].map((doc) => doc.id);
    const listed = await listDocuments(agent, result.matter.id);
    expect(listed.map((doc) => doc.id).sort()).toEqual(ids.sort());
    expect(listed.map((doc) => doc.name).sort()).toEqual([
      "amendment.pdf",
      "brokerage-addendum.pdf",
      "brokerage-checklist.pdf",
      "purchase-contract.pdf",
    ]);
    for (const doc of listed) {
      expect(doc.createdById).toBe(agent.id);
      expect(doc.visibility).toBe("agent");
      expect(
        await prisma.documentVersion.count({ where: { documentId: doc.id } }),
      ).toBe(1);
      const version = await prisma.documentVersion.findFirstOrThrow({
        where: { documentId: doc.id },
      });
      expect(await store.get(version.objectKey)).toEqual(pdf(doc.name));
    }
    const projection = await queryStoredRecords(agent, {
      kind: "documents",
      matterId: result.matter.id,
      limit: 100,
    });
    for (const id of ids) expect(JSON.stringify(projection)).toContain(id);
    await expect(
      listDocuments(outsider, result.matter.id),
    ).rejects.toMatchObject({ status: 404 });
    const replay = await submitIntake(agent, created.id, {
      expectedRevision: saved.revision,
      idempotencyKey: `submit-${created.id}`,
    });
    expect(replay.matter.id).toBe(result.matter.id);
    expect(
      await prisma.document.count({ where: { matterId: result.matter.id } }),
    ).toBe(4);
  });

  it("still associates the single checklist field from an existing draft", async () => {
    const contract = await upload(agent, "legacy-contract.pdf", "contract");
    const checklist = await upload(agent, "legacy-checklist.pdf");
    const created = await draft(
      payload([contract.id], { checklistDocumentId: checklist.id }),
    );
    const result = await submitIntake(agent, created.id, {
      expectedRevision: 1,
      idempotencyKey: `submit-${created.id}`,
    });
    matterIds.push(result.matter.id);
    expect(
      (await listDocuments(agent, result.matter.id)).map((doc) => doc.id),
    ).toEqual(expect.arrayContaining([contract.id, checklist.id]));
  });

  it("rejects another agent's checklist without partially submitting or assigning successful files", async () => {
    const contract = await upload(agent, "ownership-contract.pdf", "contract");
    const checklist = await upload(agent, "owned-checklist.pdf");
    const foreign = await upload(outsider, "foreign-checklist.pdf");
    const created = await draft(
      payload([contract.id], {
        checklistDocumentIds: [checklist.id, foreign.id],
      }),
    );
    await expect(
      submitIntake(agent, created.id, {
        expectedRevision: 1,
        idempotencyKey: `submit-${created.id}`,
      }),
    ).rejects.toMatchObject({ code: "INVALID_DOCUMENT", status: 422 });
    expect(
      (
        await prisma.intakeDraft.findUniqueOrThrow({
          where: { id: created.id },
        })
      ).status,
    ).toBe("draft");
    expect(
      await prisma.intakeSubmission.count({ where: { draftId: created.id } }),
    ).toBe(0);
    expect(
      await prisma.document.count({
        where: {
          id: { in: [contract.id, checklist.id, foreign.id] },
          matterId: null,
        },
      }),
    ).toBe(3);
    await expect(
      submitIntake(outsider, created.id, {
        expectedRevision: 1,
        idempotencyKey: `submit-${created.id}`,
      }),
    ).rejects.toMatchObject({ status: 404 });
    const corrected = await saveIntakeDraft(agent, created.id, {
      expectedRevision: 1,
      payload: payload([contract.id], { checklistDocumentIds: [checklist.id] }),
    });
    const result = await submitIntake(agent, created.id, {
      expectedRevision: corrected.revision,
      idempotencyKey: `submit-${created.id}`,
    });
    matterIds.push(result.matter.id);
    expect(
      (await listDocuments(agent, result.matter.id))
        .map((doc) => doc.id)
        .sort(),
    ).toEqual([contract.id, checklist.id].sort());
    expect(
      (await prisma.document.findUniqueOrThrow({ where: { id: foreign.id } }))
        .matterId,
    ).toBeNull();
  });

  it("rejects an already assigned checklist without moving it or claiming other files", async () => {
    const contract = await upload(
      agent,
      "second-intake-contract.pdf",
      "contract",
    );
    const checklist = await upload(agent, "assigned-checklist.pdf");
    const prior = await prisma.matter.create({
      data: {
        title: "Earlier synthetic intake",
        propertyAddress: `Earlier synthetic ${runId}`,
        packageCode: "complete",
        side: "buyer",
        agentId: agent.id,
      },
    });
    matterIds.push(prior.id);
    await prisma.document.update({
      where: { id: checklist.id },
      data: { matterId: prior.id },
    });
    const created = await draft(
      payload([contract.id], { checklistDocumentIds: [checklist.id] }),
    );
    await expect(
      submitIntake(agent, created.id, {
        expectedRevision: 1,
        idempotencyKey: `submit-${created.id}`,
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_ALREADY_ASSIGNED", status: 422 });
    expect(
      (await prisma.document.findUniqueOrThrow({ where: { id: checklist.id } }))
        .matterId,
    ).toBe(prior.id);
    expect(
      (await prisma.document.findUniqueOrThrow({ where: { id: contract.id } }))
        .matterId,
    ).toBeNull();
    expect(
      (
        await prisma.intakeDraft.findUniqueOrThrow({
          where: { id: created.id },
        })
      ).status,
    ).toBe("draft");
  });
});
