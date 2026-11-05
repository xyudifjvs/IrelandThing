import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { prisma } from "@weatherly/db";
import { hashToken, type Principal } from "@weatherly/platform";
import {
  confirmFile,
  getFileReview,
  updateDeadline,
  createChecklistShare,
  getPublicChecklist,
  getMatter,
  listMatters,
  updateMatter,
} from "../src/index";
const suffix = randomUUID(),
  ids: string[] = [];
const actors = Object.fromEntries(
  ["coordinator", "agent", "client"].map((role) => [
    role,
    {
      id: `file-${role}-${suffix}`,
      name: role,
      email: `file-${role}-${suffix}@example.test`,
      role,
      sessionId: suffix,
    },
  ]),
) as Record<string, Principal>;
beforeAll(async () => {
  await prisma.user.createMany({
    data: Object.values(actors).map(({ id, name, email, role }) => ({
      id,
      name,
      email,
      role,
    })),
  });
});
afterAll(async () => {
  await prisma.aIProposal.deleteMany({ where: { matterId: { in: ids } } });
  await prisma.matter.deleteMany({ where: { id: { in: ids } } });
  await prisma.auditEvent.deleteMany({
    where: { actorId: { in: Object.values(actors).map((a) => a.id) } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: Object.values(actors).map((a) => a.id) } },
  });
  await prisma.$disconnect();
});
async function pending() {
  const matter = await prisma.matter.create({
    data: {
      title: "Synthetic pending receipt",
      propertyAddress: "42 Pending Review",
      side: "buyer",
      packageCode: "essentials",
      stage: "pending_review",
      agentId: actors.agent.id,
      details: { fileReview: { status: "pending" } },
      participants: { create: [{ userId: actors.client.id, role: "client" }] },
      tasks: {
        create: [
          {
            title: "Internal review task",
            visibility: "client",
            dueDate: "2026-11-10",
          },
        ],
      },
      deadlines: {
        create: [{ label: "Closing", status: "confirmed", date: "2026-11-20" }],
      },
    },
  });
  ids.push(matter.id);
  return matter;
}
describe("Ireland confirms the initial file before activating its timeline", () => {
  it("keeps pending receipts visible only to their agent with no timeline, and blocks links until confirmation", async () => {
    const matter = await pending();
    const agent = await getMatter(actors.agent, matter.id);
    expect(agent).toMatchObject({
      stage: "pending_review",
      tasks: [],
      deadlines: [],
    });
    expect(
      (await listMatters(actors.agent)).find((m) => m.id === matter.id),
    ).toMatchObject({ tasks: [], deadlines: [] });
    await expect(getMatter(actors.client, matter.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(
      (await listMatters(actors.client)).some((m) => m.id === matter.id),
    ).toBe(false);
    for (const actor of [actors.coordinator, actors.agent])
      await expect(
        createChecklistShare(actor, matter.id),
      ).rejects.toMatchObject({ code: "FILE_REVIEW_REQUIRED" });
    for (const actor of [actors.agent, actors.client])
      await expect(
        confirmFile(actor, matter.id, { expectedRevision: matter.revision }),
      ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateMatter(actors.coordinator, matter.id, {
        expectedRevision: matter.revision,
        stage: "under_contract",
      }),
    ).rejects.toMatchObject({ code: "FILE_REVIEW_REQUIRED" });
    const token = randomBytes(32).toString("base64url");
    await prisma.checklistShare.create({
      data: {
        matterId: matter.id,
        issuedById: actors.coordinator.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    await expect(getPublicChecklist(token)).rejects.toMatchObject({
      code: "CHECKLIST_UNAVAILABLE",
    });
    await expect(
      confirmFile(actors.coordinator, matter.id, {
        expectedRevision: matter.revision + 1,
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const confirmed = await confirmFile(actors.coordinator, matter.id, {
      expectedRevision: matter.revision,
    });
    expect(confirmed).toMatchObject({
      stage: "under_contract",
      details: {
        fileReview: {
          status: "confirmed",
          reviewedById: actors.coordinator.id,
        },
      },
    });
    expect(confirmed.tasks.length).toBeGreaterThan(1);
    expect((await getMatter(actors.agent, matter.id)).deadlines[0].date).toBe(
      "2026-11-20",
    );
    expect((await getPublicChecklist(token)).deadlines[0].date).toBe(
      "2026-11-20",
    );
  });
  it("blocks unresolved source conflicts and unreviewed date proposals without partially confirming the file", async () => {
    const matter = await pending();
    await prisma.matter.update({
      where: { id: matter.id },
      data: {
        details: {
          fileReview: { status: "pending" },
          sourceConflicts: [
            { key: "fact:property_address", proposalId: "synthetic" },
          ],
        },
      },
    });
    await expect(
      confirmFile(actors.coordinator, matter.id, {
        expectedRevision: matter.revision,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONFLICT_REVIEW_REQUIRED" });
    await prisma.matter.update({
      where: { id: matter.id },
      data: {
        details: { fileReview: { status: "pending" }, sourceConflicts: [] },
      },
    });
    const proposal = await prisma.aIProposal.create({
      data: {
        matterId: matter.id,
        kind: "contract",
        status: "queued",
        result: {},
        sourceRefs: [],
        sourceRevision: matter.revision,
        requestedById: actors.coordinator.id,
      },
    });
    await expect(
      confirmFile(actors.coordinator, matter.id, {
        expectedRevision: matter.revision,
      }),
    ).rejects.toMatchObject({ code: "DATE_REVIEW_PROCESSING" });
    await prisma.aIProposal.update({
      where: { id: proposal.id },
      data: {
        status: "pending",
        result: { deadlines: [{ label: "Closing", date: "2026-11-20" }] },
      },
    });
    await expect(
      confirmFile(actors.coordinator, matter.id, {
        expectedRevision: matter.revision,
      }),
    ).rejects.toMatchObject({ code: "DATE_REVIEW_REQUIRED" });
    expect(
      (await prisma.matter.findUniqueOrThrow({ where: { id: matter.id } }))
        .stage,
    ).toBe("pending_review");
    const state = await getFileReview(actors.coordinator, matter.id);
    expect(state.acknowledgements).toEqual([
      { proposalId: proposal.id, label: "Closing" },
    ]);
    const confirmed = await confirmFile(actors.coordinator, matter.id, {
      expectedRevision: state.expectedRevision,
      acknowledgedUnresolved: state.acknowledgements.map((item) => ({
        ...item,
        reason: "Ireland will confirm the closing date after clarification",
      })),
    });
    expect(confirmed.details).toMatchObject({
      fileReview: {
        status: "confirmed",
        unresolvedDates: [expect.objectContaining({ label: "Closing" })],
      },
    });
    const unresolved = confirmed.deadlines.find((d) => d.label === "Closing")!;
    expect(unresolved).toMatchObject({ date: null, status: "unknown" });
    expect(
      confirmed.tasks.find((t) => t.kind === "unresolved_date"),
    ).toMatchObject({ status: "pending", visibility: "coordinator" });
    expect((await getMatter(actors.agent, matter.id)).deadlines).toEqual([]);
    await updateDeadline(actors.coordinator, matter.id, unresolved.id, {
      expectedRevision: unresolved.revision,
      date: "2026-11-22",
      status: "confirmed",
    });
    expect(
      (
        await prisma.task.findFirstOrThrow({
          where: { matterId: matter.id, kind: "unresolved_date" },
        })
      ).status,
    ).toBe("completed");
    expect(
      (await prisma.matter.findUniqueOrThrow({ where: { id: matter.id } }))
        .details,
    ).toMatchObject({ fileReview: { unresolvedDates: [] } });
  });
  it("requires an explicit unresolved disposition for applicable null-date proposal findings", async () => {
    const matter = await pending();
    const closing = await prisma.deadline.findFirstOrThrow({
      where: { matterId: matter.id, label: "Closing" },
    });
    await prisma.deadline.update({
      where: { id: closing.id },
      data: { status: "unknown", date: null },
    });
    const finding = {
      label: "Loan application",
      date: null,
      uncertainty: "Needs Ireland review",
      sourceQuote: "Loan application deadline must be confirmed.",
    };
    const proposal = await prisma.aIProposal.create({
      data: {
        matterId: matter.id,
        kind: "contract",
        status: "pending",
        sourceRefs: [],
        sourceRevision: matter.revision,
        requestedById: actors.coordinator.id,
        result: { deadlines: [finding] },
      },
    });
    const state = await getFileReview(actors.coordinator, matter.id);
    expect(state.acknowledgements).toEqual(
      expect.arrayContaining([
        { deadlineId: closing.id, label: "Closing" },
        { proposalId: proposal.id, label: "Loan application" },
      ]),
    );
    await expect(
      confirmFile(actors.coordinator, matter.id, {
        expectedRevision: state.expectedRevision,
        acknowledgedUnresolved: [
          {
            deadlineId: closing.id,
            label: "Closing",
            reason: "Awaiting confirmation",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "DATE_REVIEW_REQUIRED" });
    expect(
      (await prisma.matter.findUniqueOrThrow({ where: { id: matter.id } }))
        .stage,
    ).toBe("pending_review");
    expect(
      await prisma.deadline.count({
        where: { matterId: matter.id, label: "Loan application" },
      }),
    ).toBe(0);
    const confirmed = await confirmFile(actors.coordinator, matter.id, {
      expectedRevision: state.expectedRevision,
      acknowledgedUnresolved: state.acknowledgements.map((item) => ({
        ...item,
        reason:
          "Ireland will obtain the missing date from the contract source.",
      })),
    });
    const loan = confirmed.deadlines.find(
      (date) => date.label === "Loan application",
    )!;
    expect(loan).toMatchObject({ date: null, status: "unknown" });
    expect(
      confirmed.tasks.find(
        (task) =>
          task.kind === "unresolved_date" &&
          (task.details as { deadlineId?: string }).deadlineId === loan.id,
      ),
    ).toMatchObject({
      status: "pending",
      visibility: "coordinator",
      dueDate: null,
      details: {
        sourceProposalId: proposal.id,
        reason:
          "Ireland will obtain the missing date from the contract source.",
      },
    });
    expect(
      await prisma.aIProposal.findUniqueOrThrow({ where: { id: proposal.id } }),
    ).toMatchObject({
      status: "acknowledged_unresolved",
      result: { deadlines: [finding] },
    });
    expect((await getMatter(actors.agent, matter.id)).deadlines).toEqual([]);
  });
});
