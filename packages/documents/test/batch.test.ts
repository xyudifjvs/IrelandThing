import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { ZodError } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@weatherly/db";
import { HttpError, sanitizeError, type Principal } from "@weatherly/platform";
import { createOnboardingRouter } from "@weatherly/onboarding";
import { queryStoredRecords } from "../../assistant/src/records";
import {
  createDocumentsRouter,
  createObjectStore,
  type ObjectStore,
} from "../src/index";

// Vitest's shared config rejects every database except a disposable local *_test
// database. These tests use no provider integrations and remove only their UUIDs.
const runId = randomUUID();
const actors = ["coordinator", "agent", "agent", "client"].map(
  (role, index): Principal => ({
    id: `batch-review-${runId}-${index}`,
    email: `batch-review-${runId}-${index}@example.test`,
    name: `Batch review ${role}`,
    role: role as Principal["role"],
    sessionId: `batch-review-${runId}`,
  }),
);
const [coordinator, agent, outsider, client] = actors;
let objectDirectory = "";
let store: ObjectStore;
let matterId = "";
let otherMatterId = "";

function pdf(text: string) {
  const stream = `BT /F1 12 Tf 70 700 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const start = Buffer.byteLength(source);
  source +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((v) => `${String(v).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(source);
}

function app(objectStore = store) {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.principal = actors.find((a) => a.id === req.get("x-review-actor"));
    next();
  });
  server.use("/documents", createDocumentsRouter(objectStore));
  server.use("/onboarding", createOnboardingRouter());
  server.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof ZodError) {
        res.status(422).json({
          error: {
            code: "VALIDATION_ERROR",
            message: error.issues.map((i) => i.message).join("; "),
          },
        });
        return;
      }
      if (!(error instanceof HttpError)) console.error(error);
      res
        .status(error instanceof HttpError ? error.status : 500)
        .json(sanitizeError(error));
    },
  );
  return server;
}

function upload(
  server: ReturnType<typeof app>,
  actor: Principal,
  filename: string,
  bytes: Buffer,
  fields: Record<string, string> = {},
  url = "/documents",
) {
  let req = request(server).post(url).set("x-review-actor", actor.id);
  for (const [name, value] of Object.entries(fields))
    req = req.field(name, value);
  return req.attach("file", bytes, {
    filename,
    contentType: "application/pdf",
  });
}

beforeAll(async () => {
  if (process.env.S3_BUCKET)
    throw new Error(
      "Batch review must never call a configured external object store",
    );
  objectDirectory = await mkdtemp(join(tmpdir(), "weatherly-batch-review-"));
  process.env.OBJECT_STORAGE_DIR = objectDirectory;
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
  const matter = await prisma.matter.create({
    data: {
      title: `Batch review ${runId}`,
      propertyAddress: `Synthetic batch review ${runId}`,
      packageCode: "essentials",
      side: "buyer",
      agentId: agent.id,
    },
  });
  matterId = matter.id;
  const otherMatter = await prisma.matter.create({
    data: {
      title: `Other batch review ${runId}`,
      propertyAddress: `Other synthetic batch review ${runId}`,
      packageCode: "essentials",
      side: "buyer",
      agentId: outsider.id,
    },
  });
  otherMatterId = otherMatter.id;
  await prisma.matterParticipant.create({
    data: { matterId, userId: client.id, role: "client" },
  });
});

afterAll(async () => {
  await prisma.agreement.deleteMany({
    where: { userId: { in: actors.map((a) => a.id) } },
  });
  await prisma.document.deleteMany({
    where: { createdById: { in: actors.map((a) => a.id) } },
  });
  await prisma.matter.deleteMany({
    where: { id: { in: [matterId, otherMatterId].filter(Boolean) } },
  });
  await prisma.auditEvent.deleteMany({
    where: { actorId: { in: actors.map((a) => a.id) } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: actors.map((a) => a.id) } },
  });
  await prisma.$disconnect();
  if (objectDirectory)
    await rm(objectDirectory, { recursive: true, force: true });
});

describe("independent batch upload backend checks", () => {
  it("returns an actionable retry message for an unexpected storage failure without saving records", async () => {
    const requestId = randomUUID();
    const failingStore: ObjectStore = {
      ...store,
      async put() {
        throw new Error("Synthetic private provider response");
      },
    };
    const response = await upload(
      app(failingStore),
      agent,
      "retry-storage.pdf",
      pdf("Retry storage"),
      {
        visibility: "agent",
        uploadRequestId: requestId,
      },
    );
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("STORAGE_UNAVAILABLE");
    expect(response.body.error.message).toMatch(/retry/i);
    expect(response.text).not.toContain("private provider response");
    expect(
      await prisma.documentVersion.count({
        where: { uploadRequestId: requestId },
      }),
    ).toBe(0);
    const retried = await upload(
      app(),
      agent,
      "retry-storage.pdf",
      pdf("Retry storage"),
      {
        visibility: "agent",
        uploadRequestId: requestId,
      },
    );
    expect(retried.status, retried.text).toBe(201);
  });

  it("keeps successful files after a mixed validation/storage failure and retries only the failed file", async () => {
    const firstBytes = pdf("Successful first file");
    const secondBytes = pdf("Retryable second file");
    let transientFailure = true;
    const wrappedStore: ObjectStore = {
      ...store,
      async put(key, bytes, mime) {
        if (bytes.equals(secondBytes) && transientFailure) {
          transientFailure = false;
          throw new HttpError(
            503,
            "STORAGE_UNAVAILABLE",
            "Storage is temporarily unavailable. Retry this file.",
          );
        }
        await store.put(key, bytes, mime);
      },
    };
    const server = app(wrappedStore);
    const firstToken = randomUUID();
    const secondToken = randomUUID();
    const common = { matterId, visibility: "agent", category: "other" };
    const first = await upload(
      server,
      agent,
      "first-contract.pdf",
      firstBytes,
      { ...common, uploadRequestId: firstToken },
    );
    expect(first.status, first.text).toBe(201);
    const rejected = await upload(
      server,
      agent,
      "forged.pdf",
      Buffer.from("not PDF"),
      common,
    );
    expect(rejected.status, rejected.text).toBe(415);
    const failure = await upload(
      server,
      agent,
      "second-contract.pdf",
      secondBytes,
      { ...common, uploadRequestId: secondToken },
    );
    expect(failure.status, failure.text).toBe(503);
    const afterFailure = await request(server)
      .get(`/documents?matterId=${matterId}`)
      .set("x-review-actor", agent.id);
    expect(
      afterFailure.body.filter((d: { id: string }) => d.id === first.body.id),
    ).toHaveLength(1);
    expect(
      afterFailure.body.some(
        (d: { name: string }) => d.name === "second-contract.pdf",
      ),
    ).toBe(false);
    const retry = await upload(
      server,
      agent,
      "second-contract.pdf",
      secondBytes,
      { ...common, uploadRequestId: secondToken },
    );
    expect(retry.status, retry.text).toBe(201);
    expect(retry.body.id).not.toBe(first.body.id);
    const listed = await request(server)
      .get(`/documents?matterId=${matterId}`)
      .set("x-review-actor", agent.id);
    expect(listed.body.map((d: { id: string }) => d.id)).toEqual(
      expect.arrayContaining([first.body.id, retry.body.id]),
    );
    for (const [document, original] of [
      [first.body, firstBytes],
      [retry.body, secondBytes],
    ] as const) {
      const persisted = await prisma.document.findUniqueOrThrow({
        where: { id: document.id },
        include: { versions: true },
      });
      expect(persisted.matterId).toBe(matterId);
      expect(persisted.createdById).toBe(agent.id);
      expect(persisted.versions).toHaveLength(1);
      expect(persisted.versions[0].checksum).toBe(
        createHash("sha256").update(original).digest("hex"),
      );
      expect(await store.get(persisted.versions[0].objectKey)).toEqual(
        original,
      );
      expect(document.versions[0]).not.toHaveProperty("objectKey");
      const audit = await prisma.auditEvent.findMany({
        where: { entityId: document.id, action: "document.uploaded" },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].actorId).toBe(agent.id);
      expect(audit[0].matterId).toBe(matterId);
    }
    const mcpProjection = await queryStoredRecords(agent, {
      kind: "documents",
      matterId,
      limit: 100,
    });
    expect(JSON.stringify(mcpProjection)).toContain(first.body.id);
    expect(JSON.stringify(mcpProjection)).toContain(retry.body.id);
    expect(JSON.stringify(mcpProjection)).not.toContain("objectKey");
  });

  it("preserves original Unicode filenames and serves the exact original bytes after a fresh router", async () => {
    const name = "Éva O’Connor – closing 日本語.pdf";
    const bytes = pdf("Original file bytes");
    const result = await upload(app(), agent, name, bytes, { matterId });
    expect(result.status, result.text).toBe(201);
    expect(result.body.name).toBe(name);
    const download = await request(app(createObjectStore()))
      .get(`/documents/${result.body.id}/download`)
      .set("x-review-actor", agent.id);
    expect(download.status).toBe(200);
    expect(download.body).toEqual(bytes);
    expect(download.headers["content-disposition"]).toContain(
      encodeURIComponent(name),
    );
    expect(download.headers["cache-control"]).toBe("private, no-store");
    const boundaryName = `${"a".repeat(251)}.pdf`;
    const boundary = await upload(app(), agent, boundaryName, bytes, {
      matterId,
    });
    expect(boundary.status, boundary.text).toBe(201);
    expect(boundary.body.name).toBe(boundaryName);
    expect(boundary.body.versions[0].originalName).toBe(boundaryName);
  });

  it("replays lost create responses without duplicates and rejects token reuse with changed bytes or matter", async () => {
    const server = app();
    const token = randomUUID();
    const bytes = pdf("Same saved request");
    const fields = {
      matterId,
      visibility: "agent",
      category: "other",
      uploadRequestId: token,
    };
    const [first, replay] = await Promise.all([
      upload(server, agent, "idempotent.pdf", bytes, fields),
      upload(server, agent, "idempotent.pdf", bytes, fields),
    ]);
    expect(first.status, first.text).toBe(201);
    expect(replay.status, replay.text).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(
      await prisma.documentVersion.count({
        where: { documentId: first.body.id },
      }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { entityId: first.body.id, action: "document.uploaded" },
      }),
    ).toBe(1);
    const mismatch = await upload(
      server,
      agent,
      "idempotent.pdf",
      pdf("Changed bytes"),
      fields,
    );
    expect(mismatch.status, mismatch.text).toBe(409);
    const moved = await upload(server, coordinator, "idempotent.pdf", bytes, {
      ...fields,
      matterId: otherMatterId,
    });
    // Tokens are actor-scoped: another authorized actor may use the same token.
    expect(moved.status, moved.text).toBe(201);
    const changedMatter = await upload(
      server,
      coordinator,
      "idempotent.pdf",
      bytes,
      fields,
    );
    expect(changedMatter.status, changedMatter.text).toBe(409);
    const changedName = await upload(
      server,
      agent,
      "different-name.pdf",
      bytes,
      fields,
    );
    expect(changedName.status, changedName.text).toBe(409);
    const changedScope = await upload(server, agent, "idempotent.pdf", bytes, {
      ...fields,
      category: "contract",
    });
    expect(changedScope.status, changedScope.text).toBe(409);
  });

  it("denies anonymous/client/other-agent uploads and preserves sharing approval", async () => {
    const server = app();
    const bytes = pdf("Authorization review");
    expect(
      (
        await request(server)
          .post("/documents")
          .attach("file", bytes, "anonymous.pdf")
      ).status,
    ).toBe(401);
    expect(
      (await upload(server, client, "client.pdf", bytes, { matterId })).status,
    ).toBe(403);
    expect(
      (await upload(server, outsider, "other.pdf", bytes, { matterId })).status,
    ).toBe(404);
    expect(
      (
        await upload(server, agent, "forged-share.pdf", bytes, {
          matterId,
          visibility: "client",
        })
      ).status,
    ).toBe(403);
    const saved = await upload(server, coordinator, "private.pdf", bytes, {
      matterId,
      visibility: "coordinator",
    });
    expect(saved.status, saved.text).toBe(201);
    for (const actor of [agent, client, outsider]) {
      expect(
        (
          await request(server)
            .get(`/documents/${saved.body.id}`)
            .set("x-review-actor", actor.id)
        ).status,
      ).toBe(404);
      expect(
        (
          await request(server)
            .get(`/documents/${saved.body.id}/download`)
            .set("x-review-actor", actor.id)
        ).status,
      ).toBe(404);
    }
    await request(server)
      .patch(`/documents/${saved.body.id}`)
      .set("x-review-actor", coordinator.id)
      .send({ expectedRevision: saved.body.revision, visibility: "client" })
      .expect(200);
    expect(
      (
        await request(server)
          .get(`/documents/${saved.body.id}/download`)
          .set("x-review-actor", client.id)
      ).status,
    ).toBe(200);
    await prisma.matterParticipant.updateMany({
      where: { matterId, userId: client.id },
      data: { revokedAt: new Date() },
    });
    expect(
      (
        await request(server)
          .get(`/documents/${saved.body.id}/download`)
          .set("x-review-actor", client.id)
      ).status,
    ).toBe(404);
  });

  it("bounds each request and rejects invalid or extra files with actionable errors", async () => {
    const server = app();
    const bytes = pdf("Validation review");
    for (const [name, data, expected] of [
      ["empty.pdf", Buffer.alloc(0), 413],
      ["legacy.doc", Buffer.from("legacy"), 415],
      ["script.pdf", Buffer.from("not PDF"), 415],
      ["huge.pdf", Buffer.alloc(20 * 1024 * 1024 + 1, 65), 413],
    ] as const) {
      const result = await upload(server, agent, name, data, { matterId });
      expect(result.status, `${name}: ${result.text}`).toBe(expected);
      expect(result.body.error.message).not.toBe(
        "This action could not be completed. Please try again.",
      );
    }
    const extra = await request(server)
      .post("/documents")
      .set("x-review-actor", agent.id)
      .field("matterId", matterId)
      .attach("file", bytes, "one.pdf")
      .attach("file", bytes, "two.pdf");
    expect(extra.status, extra.text).toBe(422);
    expect(extra.body.error.message).toMatch(/file|document|one/i);
    for (const contentType of [
      "multipart/form-data",
      "multipart/form-data; boundary=unfinished",
    ]) {
      const incomplete = await request(server)
        .post("/documents")
        .set("x-review-actor", agent.id)
        .set("Content-Type", contentType)
        .send("--unfinished\r\n");
      expect(incomplete.status, incomplete.text).toBe(422);
      expect(incomplete.body.error.code).toBe("INCOMPLETE_UPLOAD");
      expect(incomplete.body.error.message).toMatch(/retry/i);
    }
    expect(
      await prisma.document.count({
        where: {
          createdById: agent.id,
          name: {
            in: [
              "empty.pdf",
              "legacy.doc",
              "script.pdf",
              "huge.pdf",
              "one.pdf",
              "two.pdf",
            ],
          },
        },
      }),
    ).toBe(0);
  });

  it("keeps immutable version history and safely rejects extra replacements or token-context changes", async () => {
    const server = app();
    const original = pdf("Original immutable version");
    const updated = pdf("Updated immutable version");
    const doc = await upload(server, agent, "version-history.pdf", original, {
      matterId,
    });
    expect(doc.status, doc.text).toBe(201);
    const url = `/documents/${doc.body.id}/versions`;
    const token = randomUUID();
    const fields = {
      visibility: "agent",
      category: "contract",
      uploadRequestId: token,
    };
    const version = await upload(
      server,
      agent,
      "amendment-v2.pdf",
      updated,
      fields,
      url,
    );
    expect(version.status, version.text).toBe(201);
    const replay = await upload(
      server,
      agent,
      "amendment-v2.pdf",
      updated,
      fields,
      url,
    );
    expect(replay.status, replay.text).toBe(201);
    expect(replay.body.versions[0].id).toBe(version.body.versions[0].id);
    expect(version.body.versions[0].originalName).toBe("amendment-v2.pdf");
    const extra = await request(server)
      .post(url)
      .set("x-review-actor", agent.id)
      .attach("file", updated, "a.pdf")
      .attach("file", updated, "b.pdf");
    expect(extra.status, extra.text).toBe(422);
    expect(
      await prisma.documentVersion.count({
        where: { documentId: doc.body.id },
      }),
    ).toBe(2);
    const oldBytes = await request(server)
      .get(
        `/documents/${doc.body.id}/download?versionId=${doc.body.versions[0].id}`,
      )
      .set("x-review-actor", agent.id);
    expect(oldBytes.body).toEqual(original);
    expect(oldBytes.headers["content-disposition"]).toContain(
      "version-history.pdf",
    );
    const latest = await request(server)
      .get(`/documents/${doc.body.id}/download`)
      .set("x-review-actor", agent.id);
    expect(latest.body).toEqual(updated);
    expect(latest.headers["content-disposition"]).toContain("amendment-v2.pdf");
    const wrongEndpoint = await upload(
      server,
      agent,
      "amendment-v2.pdf",
      updated,
      fields,
    );
    expect(wrongEndpoint.status, wrongEndpoint.text).toBe(409);
    await prisma.document.update({
      where: { id: doc.body.id },
      data: { visibility: "client", revision: { increment: 1 } },
    });
    const blocked = await upload(
      server,
      agent,
      "version-history.pdf",
      updated,
      { visibility: "agent" },
      url,
    );
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("SHARED_VERSION_REQUIRES_REVIEW");
    expect(
      await prisma.documentVersion.count({
        where: { documentId: doc.body.id },
      }),
    ).toBe(2);
  });

  it("persists an explicit primary signed agreement plus supporting files and rejects unsafe evidence", async () => {
    const server = app();
    const fields = { category: "service_agreement", visibility: "coordinator" };
    const primary = await upload(
      server,
      coordinator,
      "signed-primary.pdf",
      pdf("Primary signed agreement"),
      fields,
    );
    const support = await upload(
      server,
      coordinator,
      "supporting-schedule.pdf",
      pdf("Supporting agreement schedule"),
      fields,
    );
    expect(primary.status, primary.text).toBe(201);
    expect(support.status, support.text).toBe(201);
    const input = {
      userId: agent.id,
      version: "review-v1",
      status: "received",
      documentId: primary.body.id,
      supportingDocumentIds: [support.body.id],
      agreementRequestId: randomUUID(),
    };
    const missingPrimary = await request(server)
      .post("/onboarding/agreements")
      .set("x-review-actor", coordinator.id)
      .send({ ...input, documentId: undefined });
    expect(missingPrimary.status, missingPrimary.text).toBe(422);
    const forbidden = await request(server)
      .post("/onboarding/agreements")
      .set("x-review-actor", agent.id)
      .send(input);
    expect(forbidden.status).toBe(403);
    const [linked, replayed] = await Promise.all(
      [0, 1].map(() =>
        request(server)
          .post("/onboarding/agreements")
          .set("x-review-actor", coordinator.id)
          .send(input),
      ),
    );
    expect(linked.status, linked.text).toBe(201);
    expect(replayed.status, replayed.text).toBe(201);
    expect(replayed.body.id).toBe(linked.body.id);
    expect(
      await prisma.auditEvent.count({
        where: { entityId: linked.body.id, action: "agreement.created" },
      }),
    ).toBe(1);
    const changedApproval = await request(server)
      .post("/onboarding/agreements")
      .set("x-review-actor", coordinator.id)
      .send({ ...input, status: "approved" });
    expect(changedApproval.status, changedApproval.text).toBe(409);
    const changedFiles = await request(server)
      .post("/onboarding/agreements")
      .set("x-review-actor", coordinator.id)
      .send({ ...input, supportingDocumentIds: [] });
    expect(changedFiles.status, changedFiles.text).toBe(409);
    const persisted = await prisma.agreement.findUniqueOrThrow({
      where: { id: linked.body.id },
    });
    expect(persisted.documentId).toBe(primary.body.id);
    expect(
      (persisted as unknown as { supportingDocumentIds: string[] })
        .supportingDocumentIds,
    ).toEqual([support.body.id]);
    for (const doc of [primary, support]) {
      const stored = await prisma.document.findUniqueOrThrow({
        where: { id: doc.body.id },
      });
      expect(stored.matterId).toBeNull();
      expect(stored.visibility).toBe("coordinator");
      expect(stored.category).toBe("service_agreement");
      expect(
        (
          await request(server)
            .get(`/documents/${doc.body.id}`)
            .set("x-review-actor", agent.id)
        ).status,
      ).toBe(404);
    }
    const unsafe = await upload(
      server,
      coordinator,
      "shared-evidence.pdf",
      pdf("Unsafe shared evidence"),
      { ...fields, visibility: "client", matterId },
    );
    expect(unsafe.status, unsafe.text).toBe(201);
    const unsafeLink = await request(server)
      .post("/onboarding/agreements")
      .set("x-review-actor", coordinator.id)
      .send({ ...input, documentId: unsafe.body.id });
    expect(unsafeLink.status, unsafeLink.text).toBe(422);
    const unsafeSupport = await request(server)
      .post("/onboarding/agreements")
      .set("x-review-actor", coordinator.id)
      .send({ ...input, supportingDocumentIds: [unsafe.body.id] });
    expect(unsafeSupport.status, unsafeSupport.text).toBe(422);
    const projections = await queryStoredRecords(coordinator, {
      kind: "agreements",
      limit: 100,
    });
    expect(JSON.stringify(projections)).toContain(primary.body.id);
    expect(JSON.stringify(projections)).toContain(support.body.id);
  });

  it("does not leave storage objects behind when a duplicate upload is replayed", async () => {
    const server = app();
    const token = randomUUID();
    const bytes = pdf("Storage cleanup replay");
    const fields = { matterId, uploadRequestId: token };
    const filesBefore = await readdir(objectDirectory, { recursive: true });
    const first = await upload(
      server,
      agent,
      "storage-cleanup.pdf",
      bytes,
      fields,
    );
    const repeated = await upload(
      server,
      agent,
      "storage-cleanup.pdf",
      bytes,
      fields,
    );
    expect(first.status, first.text).toBe(201);
    expect(repeated.status, repeated.text).toBe(201);
    expect(first.body.id).toBe(repeated.body.id);
    const filesAfter = await readdir(objectDirectory, { recursive: true });
    const newObjectFiles = filesAfter.filter(
      (f) => !filesBefore.includes(f) && f.split(/[\\/]/).length === 3,
    );
    expect(newObjectFiles).toHaveLength(1);
  });
});
