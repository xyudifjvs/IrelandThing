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
import { getMatter } from "@weatherly/matters";
import { queryStoredRecords } from "../../assistant/src/records";
import { saveIntakeDraft, submitIntake } from "../src/index";
import { completedReference } from "./reference-fixture";

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
  it("saves blank drafts and requires a contract location before creating a transaction", async () => {
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
    await expect(submitIntake(agent, created.id, input)).rejects.toMatchObject({
      code: "CONTRACT_REQUIRED",
      status: 422,
    });
    const saved = await saveIntakeDraft(agent, created.id, {
      expectedRevision: 1,
      payload: {
        ...savedPayload,
        contractSource: "dotloop",
        dotloopLoopId: "synthetic-legacy-loop",
      },
    });
    input.expectedRevision = saved.revision;
    const result = await submitIntake(agent, created.id, input);
    matterIds.push(result.matter.id);
    expect(result.matter.title).toBe("Untitled transaction");
    expect(result.matter.propertyAddress).toBe("");
    expect(result.matter.agentId).toBe(agent.id);
    expect(result.matter.stage).toBe("pending_review");
    expect(result.matter.details).toMatchObject({
      fileReview: { status: "pending" },
    });
    expect(result.matter.details).not.toHaveProperty("workflow");
    const initialDates = await prisma.deadline.findMany({
      where: { matterId: result.matter.id },
    });
    expect(initialDates).toHaveLength(3);
    for (const date of initialDates)
      expect(date).toMatchObject({
        status: "unknown",
        date: null,
        details: { visibility: "coordinator", reviewRequired: true },
      });
    expect(result.submission.snapshot).toMatchObject({
      serviceSnapshot: {
        code: "complete",
        name: "Contract to Close + Compliance",
        priceCents: 51500,
        currency: "USD",
      },
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
        "Import executed contract from Dotloop",
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

  it("preserves every reference field and upload group, including files absent from legacy documentIds", async () => {
    const groups = {
      contractDocs: [await upload(agent, "reference-contract.pdf", "contract")],
      hoaFiles: [await upload(agent, "reference-hoa.pdf", "hoa")],
      utilFiles: [await upload(agent, "reference-utilities.pdf", "utilities")],
      policyFiles: [
        await upload(agent, "reference-policy.pdf", "prior_policy"),
      ],
    };
    const reference = {
      version: 1,
      variant: "seller-compliance",
      fields: {
        ...completedReference("seller-compliance").fields,
        service: "ctcc",
        side: "seller",
        a_num: "1420",
        a_street: "Synthetic Road",
        a_city: "Columbus",
        a_state: "OH",
        a_zip: "43215",
        occ: "Occupied",
        b1_name: "First seller",
        b1_email: "first@example.test",
        b1_phone: "555-0101",
        b2_name: "Second seller",
        b2_email: "second@example.test",
        b2_phone: "555-0102",
        buyerRel: "other",
        buyerRelOther: "Mother / daughter",
        coop: "type",
        co_brokerage: "Synthetic brokerage",
        co_name: "Synthetic Co-op",
        co_email: "coop@example.test",
        co_phone: "555-0103",
        addl: "yes",
        c1_name: "Additional person",
        c1_email: "additional@example.test",
        c1_rel: "Parent",
        title: "mls",
        lender: "cash",
        cash: "yes",
        fee: "$500",
        listcomm: "3%",
        hoa: "yes",
        hoaDocs: "upload",
        hoaSent: "yes",
        hoaDate: "2026-11-04",
        utilNotes: "Policy attached",
        docsDotloop: true,
        notes: "Synthetic reference submission",
        gift: "yes",
        tier: "Classic",
        giftOpt: "Gift Option 1",
        giftAgree: true,
      },
      uploads: Object.fromEntries(
        Object.entries(groups).map(([key, docs]) => [
          key,
          docs.map((doc) => doc.id),
        ]),
      ),
      fileNames: Object.fromEntries(
        Object.values(groups)
          .flat()
          .map((doc) => [doc.id, doc.name]),
      ),
    };
    const savedPayload = {
      ...payload([], {}),
      side: "seller",
      referenceIntake: reference,
    };
    const created = await prisma.intakeDraft.create({
      data: { userId: agent.id, payload: savedPayload },
    });
    draftIds.push(created.id);
    const saved = await saveIntakeDraft(agent, created.id, {
      expectedRevision: 1,
      payload: savedPayload,
    });
    await expect(
      saveIntakeDraft(agent, created.id, {
        expectedRevision: 1,
        payload: savedPayload,
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const input = {
      expectedRevision: saved.revision,
      idempotencyKey: `submit-${created.id}`,
    };
    const result = await submitIntake(agent, created.id, input);
    matterIds.push(result.matter.id);
    expect(result.submission.snapshot).toMatchObject({
      referenceIntake: reference,
    });
    const owned = await getMatter(agent, result.matter.id);
    expect(owned).toMatchObject({ details: { referenceIntake: reference } });
    expect(
      (await listDocuments(agent, result.matter.id))
        .map((doc) => doc.id)
        .sort(),
    ).toEqual(
      Object.values(groups)
        .flat()
        .map((doc) => doc.id)
        .sort(),
    );
    const coordinator = { ...agent, role: "coordinator" as const };
    const records = await queryStoredRecords(coordinator, {
      kind: "intake_submissions",
      matterId: result.matter.id,
    });
    expect(records.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          snapshot: expect.objectContaining({ referenceIntake: reference }),
        }),
      ]),
    );
    await expect(getMatter(outsider, result.matter.id)).rejects.toMatchObject({
      status: 404,
    });
    await prisma.matterParticipant.create({
      data: { matterId: result.matter.id, userId: outsider.id, role: "client" },
    });
    await expect(
      getMatter({ ...outsider, role: "client" }, result.matter.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      queryStoredRecords(
        { ...outsider, role: "client" },
        { kind: "intake_submissions", matterId: result.matter.id },
      ),
    ).rejects.toMatchObject({ status: 403 });
    const replay = await submitIntake(agent, created.id, input);
    expect(replay.submission.id).toBe(result.submission.id);
    expect(
      await prisma.matterParticipant.count({
        where: { matterId: result.matter.id },
      }),
    ).toBe(1);
    const tasks = await prisma.task.findMany({
      where: { matterId: result.matter.id },
    });
    expect(tasks.map((task) => task.title)).toEqual(
      expect.arrayContaining([
        "Review additional communication and portal contact requests",
        "Review seller utilities and previous title policy",
        "Verify reported HOA document delivery date",
      ]),
    );
  });

  it("rejects foreign files in every new upload group and rejects unfinished upload records atomically", async () => {
    const foreign = await upload(outsider, "foreign-reference.pdf", "hoa");
    for (const key of [
      "contractDocs",
      "hoaFiles",
      "utilFiles",
      "policyFiles",
    ]) {
      const created = await prisma.intakeDraft.create({
        data: {
          userId: agent.id,
          payload: {
            ...payload([], {}),
            referenceIntake: {
              version: 1,
              variant: "buyer-compliance",
              fields: {
                ...completedReference("buyer-compliance").fields,
                contractLocation:
                  "Synthetic external executed-contract location",
              },
              uploads: { [key]: [foreign.id] },
              fileNames: {},
            },
          },
        },
      });
      draftIds.push(created.id);
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
    }
    const unfinished = await prisma.document.create({
      data: {
        name: "unfinished.pdf",
        mimeType: "application/pdf",
        createdById: agent.id,
      },
    });
    const created = await prisma.intakeDraft.create({
      data: {
        userId: agent.id,
        payload: {
          ...payload([], {}),
          referenceIntake: {
            version: 1,
            variant: "buyer-compliance",
            fields: {
              ...completedReference("buyer-compliance").fields,
              contractLocation: "Synthetic external executed-contract location",
            },
            uploads: { hoaFiles: [unfinished.id] },
            fileNames: {},
          },
        },
      },
    });
    draftIds.push(created.id);
    await expect(
      submitIntake(agent, created.id, {
        expectedRevision: 1,
        idempotencyKey: `submit-${created.id}`,
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_NOT_AVAILABLE", status: 422 });
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
  });

  it("keeps an HOA-only upload and still requests the missing contract", async () => {
    const hoa = await upload(agent, "only-hoa-evidence.pdf", "hoa");
    const created = await prisma.intakeDraft.create({
      data: {
        userId: agent.id,
        payload: {
          ...payload([hoa.id], {}),
          referenceIntake: {
            version: 1,
            variant: "buyer-compliance",
            fields: {
              ...completedReference("buyer-compliance").fields,
              docsDotloop: false,
              hoa: "yes",
              hoaDocs: "upload",
              contractLocation: "Dotloop: synthetic executed contract folder",
            },
            uploads: { hoaFiles: [hoa.id] },
            fileNames: { [hoa.id]: hoa.name },
          },
        },
      },
    });
    draftIds.push(created.id);
    const result = await submitIntake(agent, created.id, {
      expectedRevision: 1,
      idempotencyKey: `submit-${created.id}`,
    });
    matterIds.push(result.matter.id);
    expect(
      (await listDocuments(agent, result.matter.id)).map((doc) => doc.id),
    ).toEqual([hoa.id]);
    expect(
      (
        await prisma.task.findMany({ where: { matterId: result.matter.id } })
      ).map((task) => task.title),
    ).toContain("Obtain executed contract");
  });

  it("keeps Full Listing drafts resumable and replays historical submitted receipts", async () => {
    const created = await prisma.intakeDraft.create({
      data: {
        userId: agent.id,
        payload: {
          ...payload([], {}),
          side: "seller",
          packageCode: "full_listing",
        },
      },
    });
    draftIds.push(created.id);
    const saved = await saveIntakeDraft(agent, created.id, {
      expectedRevision: 1,
      payload: {
        ...payload([], {}),
        side: "seller",
        packageCode: "full_listing",
        notes: "Still resumable",
      },
    });
    await expect(
      submitIntake(agent, created.id, {
        expectedRevision: saved.revision,
        idempotencyKey: `submit-${created.id}`,
      }),
    ).rejects.toMatchObject({ code: "SERVICE_COMING_SOON" });
    expect(
      (
        await prisma.intakeDraft.findUniqueOrThrow({
          where: { id: created.id },
        })
      ).status,
    ).toBe("draft");
    const matter = await prisma.matter.create({
      data: {
        title: "Historical Full Listing",
        propertyAddress: "Synthetic historical address",
        side: "seller",
        packageCode: "full_listing",
        agentId: agent.id,
        details: { priceCents: 62500 },
      },
    });
    matterIds.push(matter.id);
    const historical = await prisma.intakeSubmission.create({
      data: {
        draftId: created.id,
        matterId: matter.id,
        userId: agent.id,
        idempotencyKey: `historical-${created.id}`,
        snapshot: { packageCode: "full_listing", priceCents: 62500 },
      },
    });
    await prisma.intakeDraft.update({
      where: { id: created.id },
      data: { status: "submitted", submittedMatterId: matter.id },
    });
    const replay = await submitIntake(agent, created.id, {
      expectedRevision: 1,
      idempotencyKey: historical.idempotencyKey,
    });
    expect(replay.submission).toEqual(historical);
    expect(replay.matter.details).toEqual({ priceCents: 62500 });
  });

  it("requires a plain-service upload while allowing an identified compliance loop without a deep URL", async () => {
    const initial = {
      ...payload([], {}),
      packageCode: "essentials",
      propertyAddress: "1420 Synthetic Loop Road",
      referenceIntake: {
        version: 1,
        variant: "buyer",
        fields: {
          ...completedReference("buyer").fields,
          docsDotloop: true,
        },
        uploads: {},
        fileNames: {},
      },
    };
    const created = await prisma.intakeDraft.create({
      data: { userId: agent.id, payload: initial },
    });
    draftIds.push(created.id);
    const saved = await saveIntakeDraft(agent, created.id, {
      expectedRevision: 1,
      payload: initial,
    });
    await expect(
      submitIntake(agent, created.id, {
        expectedRevision: saved.revision,
        idempotencyKey: `submit-${created.id}`,
      }),
    ).rejects.toMatchObject({ code: "CONTRACT_UPLOAD_REQUIRED", status: 422 });
    expect(
      (
        await prisma.intakeDraft.findUniqueOrThrow({
          where: { id: created.id },
        })
      ).status,
    ).toBe("draft");
    const compliance = {
      ...initial,
      packageCode: "complete",
      referenceIntake: {
        ...initial.referenceIntake,
        variant: "buyer-compliance",
        fields: { ...initial.referenceIntake.fields, service: "ctcc" },
      },
    };
    const updated = await saveIntakeDraft(agent, created.id, {
      expectedRevision: saved.revision,
      payload: compliance,
    });
    const result = await submitIntake(agent, created.id, {
      expectedRevision: updated.revision,
      idempotencyKey: `submit-${created.id}`,
    });
    matterIds.push(result.matter.id);
    expect(result.submission.snapshot).toMatchObject({
      serviceSnapshot: {
        code: "complete",
        priceCents: 51500,
        dueAtClosing: true,
      },
      referenceIntake: { fields: { docsDotloop: true } },
    });
    expect(
      await prisma.paymentOrder.count({
        where: { matterId: result.matter.id },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.task.findMany({ where: { matterId: result.matter.id } })
      ).map((task) => task.title),
    ).toContain(
      "Locate executed contract in identified transaction loop; verify account access",
    );
  });

  it("links a new replacement intake to an authorized terminated transaction without changing its history or reusing files", async () => {
    const old = await prisma.matter.create({
      data: {
        title: "Original terminated contract",
        propertyAddress: "1420 Synthetic Replacement Road",
        side: "buyer",
        packageCode: "complete",
        stage: "terminated",
        agentId: agent.id,
        details: { originalHistory: "Preserve exactly" },
      },
    });
    matterIds.push(old.id);
    const oldDocument = await upload(
      agent,
      "old-executed-contract.pdf",
      "contract",
    );
    await prisma.document.update({
      where: { id: oldDocument.id },
      data: { matterId: old.id },
    });
    const before = await prisma.matter.findUniqueOrThrow({
      where: { id: old.id },
    });
    const beforeDocs = await prisma.document.findMany({
      where: { matterId: old.id },
    });
    const makeReplacement = async (patch: Record<string, unknown> = {}) => {
      const created = await prisma.intakeDraft.create({
        data: {
          userId: agent.id,
          payload: {
            ...payload([], {}),
            propertyAddress: " 1420   Synthetic Replacement Road ",
            replacesMatterId: old.id,
            referenceIntake: {
              version: 1,
              variant: "buyer-compliance",
              fields: {
                ...completedReference("buyer-compliance").fields,
                docsDotloop: true,
                transactionName: "New replacement contract",
              },
              uploads: {},
              fileNames: {},
            },
            ...patch,
          },
        },
      });
      draftIds.push(created.id);
      return created;
    };
    for (const patch of [
      {
        side: "seller",
        referenceIntake: {
          version: 1,
          variant: "seller-compliance",
          fields: {
            ...completedReference("seller-compliance").fields,
            contractLocation: "New loop",
          },
          uploads: {},
          fileNames: {},
        },
      },
      { propertyAddress: "Other property" },
    ]) {
      const invalid = await makeReplacement(patch);
      await expect(
        submitIntake(agent, invalid.id, {
          expectedRevision: 1,
          idempotencyKey: `replacement-${invalid.id}`,
        }),
      ).rejects.toMatchObject({ code: "INVALID_REPLACEMENT" });
    }
    const reused = await makeReplacement({ documentIds: [oldDocument.id] });
    await expect(
      submitIntake(agent, reused.id, {
        expectedRevision: 1,
        idempotencyKey: `replacement-${reused.id}`,
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_ALREADY_ASSIGNED" });
    const fresh = await makeReplacement({ propertyAddress: "" });
    const result = await submitIntake(agent, fresh.id, {
      expectedRevision: 1,
      idempotencyKey: `replacement-${fresh.id}`,
    });
    matterIds.push(result.matter.id);
    expect(result.matter.id).not.toBe(old.id);
    expect(result.matter).toMatchObject({
      stage: "pending_review",
      propertyAddress: "",
      details: { replacesMatterId: old.id, fileReview: { status: "pending" } },
    });
    expect(result.submission.snapshot).toMatchObject({
      replacesMatterId: old.id,
    });
    expect(
      await prisma.matter.findUniqueOrThrow({ where: { id: old.id } }),
    ).toEqual(before);
    expect(
      await prisma.document.findMany({ where: { matterId: old.id } }),
    ).toEqual(beforeDocs);
    const outsiderDraft = await prisma.intakeDraft.create({
      data: {
        userId: outsider.id,
        payload: {
          ...payload([], {}),
          replacesMatterId: old.id,
          referenceIntake: {
            version: 1,
            variant: "buyer-compliance",
            fields: {
              ...completedReference("buyer-compliance").fields,
              contractLocation: "Other loop",
            },
            uploads: {},
            fileNames: {},
          },
        },
      },
    });
    draftIds.push(outsiderDraft.id);
    await expect(
      submitIntake(outsider, outsiderDraft.id, {
        expectedRevision: 1,
        idempotencyKey: `replacement-${outsiderDraft.id}`,
      }),
    ).rejects.toMatchObject({ status: 404 });
    const active = await prisma.matter.create({
      data: {
        title: "Active source",
        propertyAddress: "1420 Synthetic Replacement Road",
        side: "buyer",
        packageCode: "complete",
        agentId: agent.id,
      },
    });
    matterIds.push(active.id);
    const activeDraft = await makeReplacement({ replacesMatterId: active.id });
    await expect(
      submitIntake(agent, activeDraft.id, {
        expectedRevision: 1,
        idempotencyKey: `replacement-${activeDraft.id}`,
      }),
    ).rejects.toMatchObject({ code: "REPLACEMENT_REQUIRES_TERMINATED" });
  });

  it.each([
    "buyer",
    "seller",
    "buyer-compliance",
    "seller-compliance",
  ] as const)(
    "saves partial %s drafts and creates one pending-review receipt only after all active answers are complete",
    async (variant) => {
      const reference = completedReference(variant);
      const compliance = variant.endsWith("-compliance");
      const contract =
        !compliance || variant === "seller-compliance"
          ? await upload(agent, `complete-${variant}.pdf`, "contract")
          : null;
      if (contract) {
        reference.uploads.contractDocs = [contract.id];
        reference.fileNames[contract.id] = contract.name;
      }
      // Deliberately retained invalid hidden values must survive the final snapshot.
      reference.fields.co_email = "inactive invalid co-op email";
      reference.fields.t_email = "inactive invalid title email";
      reference.fields.l_email = "inactive invalid lender email";
      reference.fields.c1_email = "inactive invalid additional email";
      reference.fields.hoaDate = "inactive invalid date";
      const body = {
        ...payload(contract ? [contract.id] : [], {}),
        side: variant.startsWith("seller") ? "seller" : "buyer",
        packageCode: compliance ? "complete" : "essentials",
        propertyAddress: "1420 Synthetic Lane, Columbus, OH 43215",
        clients: [
          {
            name: "Synthetic Client",
            email: "synthetic-client@example.test",
            phone: "555-0100",
          },
        ],
        title: {
          choice: variant.startsWith("seller") ? "mls" : "listing_agent",
        },
        broker: { pre1978: false, ownChecklist: false },
        referenceIntake: reference,
      };
      const created = await prisma.intakeDraft.create({
        data: {
          userId: agent.id,
          payload: {
            ...body,
            referenceIntake: {
              ...reference,
              fields: { service: reference.fields.service },
            },
          },
        },
      });
      draftIds.push(created.id);
      const invalidPartial = {
        ...body,
        referenceIntake: {
          ...reference,
          fields: {
            service: reference.fields.service,
            b1_email: "partly typed invalid email",
          },
        },
      };
      const savedPartial = await saveIntakeDraft(agent, created.id, {
        expectedRevision: 1,
        payload: invalidPartial,
      });
      expect(savedPartial.payload).toEqual(invalidPartial);
      const incomplete = await saveIntakeDraft(agent, created.id, {
        expectedRevision: savedPartial.revision,
        payload: {
          ...body,
          referenceIntake: {
            ...reference,
            fields: { service: reference.fields.service },
          },
        },
      });
      await expect(
        submitIntake(agent, created.id, {
          expectedRevision: incomplete.revision,
          idempotencyKey: `complete-${created.id}`,
        }),
      ).rejects.toMatchObject({
        code:
          compliance && !contract ? "CONTRACT_REQUIRED" : "INTAKE_INCOMPLETE",
        status: 422,
      });
      expect(
        await prisma.intakeSubmission.count({ where: { draftId: created.id } }),
      ).toBe(0);
      const complete = await saveIntakeDraft(agent, created.id, {
        expectedRevision: incomplete.revision,
        payload: body,
      });
      const input = {
        expectedRevision: complete.revision,
        idempotencyKey: `complete-${created.id}`,
      };
      const result = await submitIntake(agent, created.id, input);
      matterIds.push(result.matter.id);
      expect(result.matter).toMatchObject({
        stage: "pending_review",
        details: {
          fileReview: { status: "pending" },
          referenceIntake: reference,
        },
      });
      expect(result.submission.snapshot).toMatchObject({
        referenceIntake: reference,
      });
      expect((await submitIntake(agent, created.id, input)).submission.id).toBe(
        result.submission.id,
      );
    },
  );
});
