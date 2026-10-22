import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { ZodError } from "zod";
import { prisma } from "@weatherly/db";
import {
  HttpError,
  hashToken,
  sanitizeError,
  type Principal,
} from "@weatherly/platform";
import {
  addTask,
  addDeadline,
  createChecklistShare,
  getChecklistShare,
  revokeChecklistShare,
  getPublicChecklist,
  createMattersRouter,
  createPublicChecklistRouter,
  checklistPrivacyHeaders,
  getMatter,
  listMatters,
  updateTask,
  deleteTask,
  updateDeadline,
  updateMatter,
  reorderTasks,
  createMatter,
} from "../src/index";

const run = randomUUID();
const actors = Object.fromEntries(
  ["owner", "agent", "participant", "other", "client"].map((name) => [
    name,
    {
      id: `share-${name}-${run}`,
      name,
      email: `${name}-${run}@example.test`,
      role:
        name === "owner"
          ? "coordinator"
          : name === "client"
            ? "client"
            : "agent",
      sessionId: `synthetic-${run}`,
    },
  ]),
) as Record<string, Principal>;
const matterIds: string[] = [];
const tokenFrom = (share: { url: string }) => new URL(share.url).hash.slice(1);

async function fixture() {
  const matter = await prisma.matter.create({
    data: {
      title: "Synthetic client checklist",
      propertyAddress: "123 Synthetic Lane",
      side: "buyer",
      packageCode: "essentials",
      agentId: actors.agent.id,
      details: {
        contacts: [{ email: "private-client@example.test" }],
        notes: "SECRET_MATTER_DETAILS",
      },
      participants: {
        create: [
          { userId: actors.participant.id, role: "agent" },
          { userId: actors.client.id, role: "client" },
        ],
      },
      tasks: {
        create: [
          {
            title: "SECRET_COORDINATOR_TASK",
            visibility: "coordinator",
            position: 0,
            details: { body: "secret" },
          },
          {
            title: "First shared item",
            visibility: "client",
            position: 1,
            details: { body: "SECRET_TASK_DETAILS" },
          },
          { title: "SECRET_AGENT_TASK", visibility: "agent", position: 2 },
          {
            title: "Second shared item",
            visibility: "client",
            kind: "custom",
            position: 3,
            dueDate: "2026-11-01",
          },
        ],
      },
      notes: {
        create: {
          authorId: actors.owner.id,
          body: "SECRET_NOTE",
          visibility: "client",
        },
      },
      documents: {
        create: {
          name: "SECRET_DOCUMENT",
          mimeType: "application/pdf",
          createdById: actors.owner.id,
          visibility: "client",
        },
      },
      deadlines: {
        create: [
          {
            label: "Closing",
            date: "2026-12-01",
            status: "confirmed",
            sourceDocumentId: "SECRET_SOURCE",
            details: { body: "SECRET_DEADLINE_DETAILS" },
          },
          { label: "SECRET_PROPOSAL", date: "2026-11-20", status: "proposed" },
          { label: "Unknown date", status: "unknown" },
        ],
      },
    },
    include: {
      tasks: { orderBy: { position: "asc" } },
      deadlines: true,
      participants: true,
    },
  });
  matterIds.push(matter.id);
  return matter;
}

const app = express();
app.use(express.json());
app.use(
  "/api/public/checklist",
  checklistPrivacyHeaders,
  createPublicChecklistRouter(),
);
app.use(
  "/api/v1/matters",
  (req, _res, next) => {
    req.principal = actors[req.get("x-synthetic-actor") || ""];
    next();
  },
  createMattersRouter(),
);
app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND" } }));
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res
      .status(
        error instanceof HttpError
          ? error.status
          : error instanceof ZodError
            ? 422
            : 500,
      )
      .json(sanitizeError(error));
  },
);

beforeAll(async () => {
  await prisma.user.createMany({
    data: Object.values(actors).map(({ id, name, email, role }) => ({
      id,
      name,
      email,
      role,
      twoFactorEnabled: role === "coordinator",
    })),
  });
  await prisma.auditEvent.createMany({
    data: Object.values(actors)
      .filter((actor) => actor.role === "agent")
      .map((actor) => ({
        actorId: actors.owner.id,
        entityType: "User",
        entityId: actor.id,
        action: "agent.access_override",
        details: {},
      })),
  });
});
afterAll(async () => {
  await prisma.matter.deleteMany({ where: { id: { in: matterIds } } });
  await prisma.auditEvent.deleteMany({
    where: { actorId: { in: Object.values(actors).map((actor) => actor.id) } },
  });
  await prisma.agreement.deleteMany({
    where: { userId: { in: Object.values(actors).map((actor) => actor.id) } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: Object.values(actors).map((actor) => actor.id) } },
  });
  await prisma.$disconnect();
});

describe("canonical client checklist sharing", () => {
  it("returns a fragment-only 256-bit secret once and persists no bearer material in metadata/audit", async () => {
    const matter = await fixture();
    const share = await createChecklistShare(actors.owner, matter.id);
    const token = tokenFrom(share);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(new URL(share.url).pathname).toBe("/checklist");
    expect(new URL(share.url).search).toBe("");
    const stored = await prisma.checklistShare.findUniqueOrThrow({
      where: { matterId: matter.id },
    });
    expect(stored.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    const metadata = await getChecklistShare(actors.agent, matter.id);
    expect(metadata.active).toBe(true);
    expect(Object.keys(metadata).sort()).toEqual([
      "active",
      "createdAt",
      "expiresAt",
      "id",
    ]);
    const audits = await prisma.auditEvent.findMany({
      where: { matterId: matter.id },
    });
    expect(audits.some((a) => a.action === "checklist_share.rotated")).toBe(
      true,
    );
    expect(JSON.stringify({ metadata, audits })).not.toContain(token);
    expect(JSON.stringify({ metadata, audits })).not.toContain(
      stored.tokenHash,
    );
  });

  it("allows only coordinator and current matter agents to manage links", async () => {
    const matter = await fixture();
    await expect(
      createChecklistShare(actors.other, matter.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createChecklistShare(actors.client, matter.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      getChecklistShare(actors.client, matter.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      revokeChecklistShare(actors.other, matter.id),
    ).rejects.toMatchObject({ status: 404 });
    const share = await createChecklistShare(actors.participant, matter.id);
    expect((await getPublicChecklist(tokenFrom(share))).matter.id).toBe(
      matter.id,
    );
    const membership = matter.participants.find(
      (p) => p.userId === actors.participant.id,
    )!;
    await prisma.matterParticipant.update({
      where: { id: membership.id },
      data: { revokedAt: new Date() },
    });
    await expect(
      getChecklistShare(actors.participant, matter.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(getPublicChecklist(tokenFrom(share))).rejects.toMatchObject({
      status: 404,
      code: "CHECKLIST_UNAVAILABLE",
    });
    expect((await getChecklistShare(actors.owner, matter.id)).active).toBe(
      false,
    );
  });

  it("projects only the intended matter, current client tasks and confirmed dated deadlines", async () => {
    const matter = await fixture();
    const other = await fixture();
    const share = await createChecklistShare(actors.owner, matter.id);
    const result = await getPublicChecklist(tokenFrom(share));
    expect(Object.keys(result).sort()).toEqual([
      "deadlines",
      "matter",
      "tasks",
    ]);
    expect(Object.keys(result.matter).sort()).toEqual([
      "id",
      "propertyAddress",
      "stage",
      "title",
    ]);
    expect(result.tasks.map((task) => task.title)).toEqual([
      "First shared item",
      "Second shared item",
    ]);
    // Canonical positions are 1 and 3 with private steps interleaved.
    // Public positions must not disclose those hidden steps.
    expect(result.tasks.map((task) => task.position)).toEqual([0, 1]);
    expect(
      (await getMatter(actors.client, matter.id)).tasks.map(
        (task) => task.position,
      ),
    ).toEqual([0, 1]);
    expect(
      (await getMatter(actors.agent, matter.id)).tasks.map(
        (task) => task.position,
      ),
    ).toEqual([0, 1, 2]);
    expect(
      (await listMatters(actors.client))
        .find((row) => row.id === matter.id)!
        .tasks.map((task) => task.position),
    ).toEqual([0, 1]);
    expect(
      (await listMatters(actors.agent))
        .find((row) => row.id === matter.id)!
        .tasks.map((task) => task.position),
    ).toEqual([0, 1, 2]);
    for (const task of result.tasks)
      expect(Object.keys(task).sort()).toEqual([
        "dueDate",
        "id",
        "position",
        "status",
        "title",
      ]);
    expect(result.deadlines.map((deadline) => deadline.label)).toEqual([
      "Closing",
    ]);
    expect(Object.keys(result.deadlines[0]).sort()).toEqual([
      "date",
      "id",
      "label",
    ]);
    expect(JSON.stringify(result)).not.toContain("SECRET_");
    expect(JSON.stringify(result)).not.toContain("private-client");
    expect(JSON.stringify(result)).not.toContain(other.id);
  });

  it("reflects canonical additions, completions, dates, removals and visibility withdrawals on subsequent reads", async () => {
    const matter = await fixture();
    const token = tokenFrom(
      await createChecklistShare(actors.owner, matter.id),
    );
    const initialRevision = matter.revision;
    const task = await addTask(actors.owner, matter.id, {
      title: "New shared work",
      visibility: "client",
    });
    expect(task.position).toBe(4);
    expect((await getPublicChecklist(token)).tasks.at(-1)?.id).toBe(task.id);
    const updated = await updateTask(actors.owner, matter.id, task.id, {
      expectedRevision: task.revision,
      status: "completed",
      dueDate: "2026-11-05",
    });
    if (!updated || !("revision" in updated))
      throw new Error("Task update must return the saved task");
    expect((await getPublicChecklist(token)).tasks.at(-1)).toMatchObject({
      status: "completed",
      dueDate: "2026-11-05",
    });
    const hidden = await updateTask(actors.owner, matter.id, task.id, {
      expectedRevision: updated!.revision,
      visibility: "coordinator",
    });
    if (!hidden || !("revision" in hidden))
      throw new Error("Task update must return the saved task");
    expect(
      (await getPublicChecklist(token)).tasks.some((t) => t.id === task.id),
    ).toBe(false);
    await deleteTask(actors.owner, matter.id, task.id, {
      expectedRevision: hidden!.revision,
    });
    const deadline = await addDeadline(actors.owner, matter.id, {
      label: "Walkthrough",
      status: "confirmed",
      date: "2026-11-30",
    });
    expect(
      (await getPublicChecklist(token)).deadlines.some(
        (d) => d.id === deadline.id,
      ),
    ).toBe(true);
    await updateDeadline(actors.owner, matter.id, deadline.id, {
      expectedRevision: deadline.revision,
      status: "proposed",
      date: "2026-11-29",
    });
    expect(
      (await getPublicChecklist(token)).deadlines.some(
        (d) => d.id === deadline.id,
      ),
    ).toBe(false);
    const current = await getMatter(actors.owner, matter.id);
    expect(current.revision).toBeGreaterThan(initialRevision);
    await updateMatter(actors.owner, matter.id, {
      expectedRevision: current.revision,
      stage: "closing",
      title: "Updated checklist",
    });
    expect((await getPublicChecklist(token)).matter).toMatchObject({
      title: "Updated checklist",
      stage: "closing",
    });
  });

  it("atomically rotates a single canonical share, revokes idempotently, and enforces expiry", async () => {
    const matter = await fixture();
    const first = tokenFrom(
      await createChecklistShare(actors.owner, matter.id),
    );
    const second = tokenFrom(
      await createChecklistShare(actors.agent, matter.id),
    );
    expect(second).not.toBe(first);
    await expect(getPublicChecklist(first)).rejects.toMatchObject({
      status: 404,
    });
    expect((await getPublicChecklist(second)).matter.id).toBe(matter.id);
    expect(
      await prisma.checklistShare.count({ where: { matterId: matter.id } }),
    ).toBe(1);
    await revokeChecklistShare(actors.owner, matter.id);
    await revokeChecklistShare(actors.owner, matter.id);
    await expect(getPublicChecklist(second)).rejects.toMatchObject({
      status: 404,
    });
    const expired = tokenFrom(
      await createChecklistShare(actors.owner, matter.id),
    );
    await prisma.checklistShare.update({
      where: { matterId: matter.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await expect(getPublicChecklist(expired)).rejects.toMatchObject({
      status: 404,
    });
    expect((await getChecklistShare(actors.owner, matter.id)).active).toBe(
      false,
    );
    await expect(
      createChecklistShare(actors.owner, matter.id, {
        expiresAt: new Date(Date.now() - 10000).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("serializes simultaneous rotations and leaves only the final token usable", async () => {
    const matter = await fixture();
    const shares = await Promise.all([
      createChecklistShare(actors.owner, matter.id),
      createChecklistShare(actors.agent, matter.id),
    ]);
    expect(shares[0].id).not.toBe(shares[1].id);
    const results = await Promise.allSettled(
      shares.map((share) => getPublicChecklist(tokenFrom(share))),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await prisma.checklistShare.count({ where: { matterId: matter.id } }),
    ).toBe(1);
  });

  it("withdraws links when the issuer is reassigned, downgraded or account-revoked", async () => {
    const matter = await fixture();
    const agentToken = tokenFrom(
      await createChecklistShare(actors.agent, matter.id),
    );
    await prisma.matter.update({
      where: { id: matter.id },
      data: { agentId: actors.other.id },
    });
    await expect(getPublicChecklist(agentToken)).rejects.toMatchObject({
      status: 404,
    });
    const token = tokenFrom(
      await createChecklistShare(actors.owner, matter.id),
    );
    try {
      await prisma.user.update({
        where: { id: actors.owner.id },
        data: { role: "client" },
      });
      await expect(getPublicChecklist(token)).rejects.toMatchObject({
        status: 404,
      });
    } finally {
      await prisma.user.update({
        where: { id: actors.owner.id },
        data: { role: "coordinator" },
      });
    }
    const event = await prisma.auditEvent.create({
      data: {
        actorId: actors.owner.id,
        action: "identity.access_revoked",
        entityType: "User",
        entityId: actors.owner.id,
        details: {},
      },
    });
    try {
      await expect(getPublicChecklist(token)).rejects.toMatchObject({
        status: 404,
      });
      expect((await getChecklistShare(actors.other, matter.id)).active).toBe(
        false,
      );
    } finally {
      await prisma.auditEvent.delete({ where: { id: event.id } });
    }
  });

  it("rechecks agent agreement/override and coordinator MFA gates outside local development", async () => {
    const matter = await fixture();
    const token = tokenFrom(
      await createChecklistShare(actors.agent, matter.id),
    );
    try {
      vi.stubEnv("APP_ENV", "staging");
      vi.stubEnv("NODE_ENV", "test");
      await prisma.auditEvent.deleteMany({
        where: { entityId: actors.agent.id, action: "agent.access_override" },
      });
      await expect(getPublicChecklist(token)).rejects.toMatchObject({
        status: 404,
      });
      expect((await getChecklistShare(actors.owner, matter.id)).active).toBe(
        false,
      );
      const agreement = await prisma.agreement.create({
        data: {
          userId: actors.agent.id,
          version: "synthetic",
          status: "approved",
        },
      });
      await expect(getPublicChecklist(token)).rejects.toMatchObject({
        status: 404,
      });
      await prisma.agreement.update({
        where: { id: agreement.id },
        data: { documentId: "synthetic-signed-agreement" },
      });
      expect((await getPublicChecklist(token)).matter.id).toBe(matter.id);
      await prisma.agreement.update({
        where: { id: agreement.id },
        data: { status: "revoked" },
      });
      await expect(getPublicChecklist(token)).rejects.toMatchObject({
        status: 404,
      });
      const override = await prisma.auditEvent.create({
        data: {
          actorId: actors.owner.id,
          entityType: "User",
          entityId: actors.agent.id,
          action: "agent.access_override",
          details: {},
        },
      });
      expect((await getPublicChecklist(token)).matter.id).toBe(matter.id);
      await prisma.auditEvent.delete({ where: { id: override.id } });
      vi.stubEnv("APP_ENV", "local");
      expect((await getPublicChecklist(token)).matter.id).toBe(matter.id);
      vi.stubEnv("NODE_ENV", "production");
      await expect(getPublicChecklist(token)).rejects.toMatchObject({
        status: 404,
      });
      const ownerToken = tokenFrom(
        await createChecklistShare(actors.owner, matter.id),
      );
      await prisma.user.update({
        where: { id: actors.owner.id },
        data: { twoFactorEnabled: false },
      });
      await expect(getPublicChecklist(ownerToken)).rejects.toMatchObject({
        status: 404,
      });
    } finally {
      vi.unstubAllEnvs();
      await prisma.user.update({
        where: { id: actors.owner.id },
        data: { twoFactorEnabled: true },
      });
      await prisma.auditEvent.create({
        data: {
          actorId: actors.owner.id,
          entityType: "User",
          entityId: actors.agent.id,
          action: "agent.access_override",
          details: {},
        },
      });
    }
  });

  it("keeps canonical order across coordinator, agent, authenticated client and public projections", async () => {
    const matter = await fixture();
    const token = tokenFrom(
      await createChecklistShare(actors.owner, matter.id),
    );
    const reversed = matter.tasks.map((task) => task.id).reverse();
    const changed = await reorderTasks(actors.owner, matter.id, {
      expectedRevision: matter.revision,
      taskIds: reversed,
    });
    expect(changed.revision).toBe(matter.revision + 1);
    expect(
      (await getMatter(actors.owner, matter.id)).tasks.map((t) => t.id),
    ).toEqual(reversed);
    const sharedIds = matter.tasks
      .filter((task) => task.visibility === "client")
      .map((task) => task.id)
      .reverse();
    expect((await getPublicChecklist(token)).tasks.map((t) => t.id)).toEqual(
      sharedIds,
    );
    expect(
      (await getMatter(actors.client, matter.id)).tasks.map((t) => t.id),
    ).toEqual(sharedIds);
    expect(
      (await listMatters(actors.client))
        .find((m) => m.id === matter.id)!
        .tasks.map((t) => t.id),
    ).toEqual(sharedIds);
    expect(
      (await getMatter(actors.agent, matter.id)).tasks.map((t) => t.id),
    ).toEqual(
      reversed.filter(
        (id) =>
          matter.tasks.find((t) => t.id === id)?.visibility !== "coordinator",
      ),
    );
    await expect(
      reorderTasks(actors.owner, matter.id, {
        expectedRevision: matter.revision,
        taskIds: reversed,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      reorderTasks(actors.owner, matter.id, {
        expectedRevision: changed.revision,
        taskIds: reversed.slice(1),
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      reorderTasks(actors.owner, matter.id, {
        expectedRevision: changed.revision,
        taskIds: [...reversed.slice(1), "other-matter-task"],
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      reorderTasks(actors.agent, matter.id, {
        expectedRevision: changed.revision,
        taskIds: reversed,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("moves PATCH position transactionally and invalidates stale sibling revisions", async () => {
    const matter = await fixture();
    const last = matter.tasks.at(-1)!;
    await updateTask(actors.owner, matter.id, last.id, {
      expectedRevision: last.revision,
      position: 0,
    });
    const updated = await getMatter(actors.owner, matter.id);
    expect(updated.tasks.map((task) => task.id)).toEqual([
      last.id,
      ...matter.tasks.slice(0, -1).map((task) => task.id),
    ]);
    expect(updated.tasks.map((task) => task.position)).toEqual([0, 1, 2, 3]);
    await expect(
      updateTask(actors.owner, matter.id, matter.tasks[0].id, {
        expectedRevision: matter.tasks[0].revision,
        status: "completed",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("backfills newly created workflow order and appends tasks after it", async () => {
    const matter = await createMatter(actors.owner, {
      title: "Synthetic initial order",
      propertyAddress: "456 Synthetic Lane",
      side: "buyer",
      packageCode: "essentials",
    });
    matterIds.push(matter.id);
    const ordered = await getMatter(actors.owner, matter.id);
    expect(ordered.tasks.map((task) => task.position)).toEqual(
      ordered.tasks.map((_, i) => i),
    );
    const added = await addTask(actors.owner, matter.id, {
      title: "Last item",
    });
    expect(added.position).toBe(ordered.tasks.length);
  });

  it("serves a read-only Bearer endpoint with generic failures and privacy headers on success/errors", async () => {
    const matter = await fixture();
    const share = await request(app)
      .post(`/api/v1/matters/${matter.id}/checklist-share`)
      .set("x-synthetic-actor", "agent")
      .send({});
    expect(share.status).toBe(201);
    const token = tokenFrom(share.body);
    const ok = await request(app)
      .get("/api/public/checklist")
      .set("Authorization", `Bearer ${token}`);
    const bad = await request(app)
      .get("/api/public/checklist")
      .set("Authorization", `Bearer ${"x".repeat(43)}`);
    const missing = await request(app).get("/api/public/checklist");
    const forbidden = await request(app)
      .get(`/api/v1/matters/${matter.id}/checklist-share`)
      .set("x-synthetic-actor", "client");
    expect(ok.status).toBe(200);
    expect(bad.status).toBe(404);
    expect(bad.body).toEqual(missing.body);
    expect(forbidden.status).toBe(403);
    for (const response of [share, ok, bad, missing, forbidden]) {
      expect(response.headers["cache-control"]).toContain("no-store");
      expect(response.headers["x-robots-tag"]).toContain("noindex");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
    }
    for (const verb of ["post", "patch", "delete"] as const)
      expect(
        (
          await request(app)
            [verb]("/api/public/checklist")
            .set("Authorization", `Bearer ${token}`)
            .send({ status: "completed" })
        ).status,
      ).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/api/v1/matters/${matter.id}/tasks/${matter.tasks[1].id}`)
          .set("Authorization", `Bearer ${token}`)
          .send({ expectedRevision: 1, status: "completed" })
      ).status,
    ).toBe(401);
    expect(
      (await request(app).get(`/api/public/checklist?token=${token}`)).status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/public/checklist/${token}`)).status,
    ).toBe(404);
    expect((await getPublicChecklist(token)).tasks[0].status).toBe("pending");
  });
});
