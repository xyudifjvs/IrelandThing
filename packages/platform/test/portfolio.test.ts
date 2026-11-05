import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, Prisma } from "@weatherly/db";
import { portfolioStatus } from "../src/operations";
import type { Principal } from "../src/index";
const actor: Principal = {
  id: `portfolio-${randomUUID()}`,
  name: "Synthetic portfolio reviewer",
  email: "portfolio@example.test",
  role: "coordinator",
  sessionId: randomUUID(),
};
afterAll(async () => {
  await prisma.$disconnect();
});
describe("portfolio counts across every stored transaction", () => {
  it("counts beyond a 200-row page, includes exact attention states, and preserves closed unpaid service requests while excluding terminated/paid/gift orders", async () => {
    await prisma.$transaction(
      async (tx) => {
        const before = await portfolioStatus(
            actor,
            new Date("2026-11-05T01:00:00Z"),
            tx,
          ),
          prefix = `portfolio-${randomUUID()}-`;
        const ids = Array.from({ length: 205 }, (_, i) => prefix + i);
        await tx.matter.createMany({
          data: ids.map((id) => ({
            id,
            title: "Synthetic pending review",
            propertyAddress: "Synthetic address",
            side: "buyer",
            packageCode: "essentials",
            stage: "pending_review",
          })),
        });
        const rows = [
          { id: prefix + "active", stage: "under_contract", details: {} },
          {
            id: prefix + "legacy-pending",
            stage: "under_contract",
            details: { fileReview: { status: "pending" } },
          },
          { id: prefix + "closed", stage: "closed", details: {} },
          { id: prefix + "terminated", stage: "terminated", details: {} },
          { id: prefix + "archived", stage: "archived", details: {} },
        ];
        await tx.matter.createMany({
          data: rows.map((row) => ({
            ...row,
            title: "Synthetic count scope",
            propertyAddress: "Synthetic address",
            side: "buyer",
            packageCode: "complete",
          })),
        });
        await tx.task.createMany({
          data: [
            { status: "pending", matterId: rows[0].id },
            { status: "received", matterId: ids[0] },
            { status: "completed", matterId: rows[0].id },
            { status: "signed", matterId: rows[0].id },
            { status: "not_applicable", matterId: rows[0].id },
            { status: "pending", matterId: rows[2].id },
            { status: "pending", matterId: rows[3].id },
          ].map((row) => ({
            ...row,
            title: prefix + "Unresolved date",
            kind: "unresolved_date",
          })),
        });
        const draftStatuses = [
          "draft",
          "draft",
          "queued",
          "sending",
          "failed",
          "delivery_unknown",
          "sent",
          "cancelled",
        ];
        await tx.emailDraft.createMany({
          data: draftStatuses.map((status, i) => ({
            id: prefix + "draft" + i,
            matterId: rows[0].id,
            createdById: actor.id,
            to: [],
            subject: "Synthetic portfolio email",
            body: "Synthetic",
            status,
          })),
        });
        await tx.emailThread.createMany({
          data: ["unassigned", "review_required", "assigned"].map(
            (status, i) => ({
              id: prefix + "thread" + i,
              ownerId: actor.id,
              providerThreadId: prefix + i,
              subject: "Synthetic portfolio inbox",
              status,
            }),
          ),
        });
        await tx.outboxJob.createMany({
          data: [
            { topic: "gmail.send", state: "failed" },
            { topic: "gmail.sync", state: "failed" },
            { topic: "gmail.send", state: "pending" },
          ].map((row, i) => ({
            ...row,
            id: prefix + "job" + i,
            payload: {},
            idempotencyKey: prefix + "job" + i,
          })),
        });
        const payments = [
          { matterId: rows[0].id, kind: "service", status: "creating" },
          { matterId: rows[2].id, kind: "service", status: "pending" },
          { matterId: rows[0].id, kind: "service", status: "failed" },
          { matterId: rows[3].id, kind: "service", status: "pending" },
          { matterId: rows[0].id, kind: "service", status: "paid" },
          { matterId: rows[0].id, kind: "service", status: "expired" },
          { matterId: rows[0].id, kind: "service", status: "refunded" },
          { matterId: rows[0].id, kind: "gift", status: "pending" },
        ];
        await tx.paymentOrder.createMany({
          data: payments.map((row, i) => ({
            ...row,
            id: prefix + "pay" + i,
            createdById: actor.id,
            idempotencyKey: prefix + "pay" + i,
            amountCents: 42500,
            currency: "USD",
            snapshot: {},
          })),
        });
        const after = await portfolioStatus(
          actor,
          new Date("2026-11-05T01:00:00Z"),
          tx,
        );
        expect(after.transactions.total - before.transactions.total).toBe(210);
        expect(
          after.transactions.pendingReview - before.transactions.pendingReview,
        ).toBe(206);
        expect(after.transactions.active - before.transactions.active).toBe(1);
        expect(after.tasks.unresolvedDates - before.tasks.unresolvedDates).toBe(
          2,
        );
        for (const [key, delta] of Object.entries({
          draft: 2,
          queued: 2,
          failed: 1,
          deliveryUnknown: 1,
          inboxReview: 2,
          failedSendJobs: 1,
        }))
          expect(
            after.email[key as keyof typeof after.email] -
              before.email[key as keyof typeof before.email],
          ).toBe(delta);
        expect(
          after.servicePayments.unpaidOrders -
            before.servicePayments.unpaidOrders,
        ).toBe(3);
        await tx.paymentOrder.deleteMany({
          where: { id: { startsWith: prefix } },
        });
        await tx.emailDraft.deleteMany({
          where: { id: { startsWith: prefix } },
        });
        await tx.emailThread.deleteMany({
          where: { id: { startsWith: prefix } },
        });
        await tx.outboxJob.deleteMany({
          where: { id: { startsWith: prefix } },
        });
        await tx.matter.deleteMany({ where: { id: { startsWith: prefix } } });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 30000,
      },
    );
  });
  it("denies agents and clients before exposing payment or other portfolio counts", async () => {
    for (const role of ["agent", "client"] as const)
      await expect(portfolioStatus({ ...actor, role })).rejects.toMatchObject({
        status: 403,
        code: "FORBIDDEN",
      });
  });
});
