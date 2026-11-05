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
        referenceIntake: {
          version: 1,
          variant: "buyer-compliance",
          fields: {
            contractLocation:
              "Dotloop: synthetic loop / executed contract folder",
          },
          uploads: {},
          fileNames: {},
        },
      },
    });
    input.expectedRevision = saved.revision;
    const result = await submitIntake(agent, created.id, input);
    matterIds.push(result.matter.id);
    expect(result.matter.title).toBe("Untitled transaction");
    expect(result.matter.propertyAddress).toBe("");
    expect(result.matter.agentId).toBe(agent.id);
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
    const clientView = await getMatter(
      { ...outsider, role: "client" },
      result.matter.id,
    );
    expect(clientView).not.toHaveProperty("details");
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
});
