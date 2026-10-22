import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import {
  listAccountTransactions,
  listAccountPayments,
  resumeAccountPayment,
} from "../src/account";
import { applyStripeEvent, createCheckout } from "../src/service";
import { refundPayment, reconcilePayment } from "../src/operations";

const prefix = `account-build-${randomUUID()}`;
const actor = (
  suffix: string,
  role: Principal["role"] = "agent",
): Principal => ({
  id: `${prefix}-${suffix}`,
  role,
  email: `${suffix}@example.invalid`,
  name: suffix,
  sessionId: prefix,
});
const agent = actor("agent"),
  other = actor("other"),
  participant = actor("participant"),
  client = actor("client", "client"),
  coordinator = actor("coordinator", "coordinator");
const stages = [
  "listing",
  "under_contract",
  "closing",
  "closed",
  "terminated",
  "archived",
];
const matterId = `${prefix}-000`;
const order = (suffix: string, extra: Record<string, unknown> = {}) => ({
  id: `${prefix}-payment-${suffix}`,
  matterId,
  createdById: coordinator.id,
  idempotencyKey: `${prefix}-payment-${suffix}`,
  kind: "service",
  amountCents: 47500,
  currency: "USD",
  status: "paid",
  snapshot: { name: "Complete", privateNote: "Never return this" },
  details: { paymentEnvironment: "test" },
  ...extra,
});
const eventIds: string[] = [];
beforeAll(async () => {
  vi.stubEnv("STRIPE_MODE", "test");
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  for (const user of [agent, other, participant, client, coordinator])
    await prisma.user.create({
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  await prisma.matter.createMany({
    data: Array.from({ length: 223 }, (_, i) => ({
      id: `${prefix}-${String(i).padStart(3, "0")}`,
      agentId: agent.id,
      title: `Retained transaction ${i}`,
      propertyAddress: `${i} Bay Street`,
      side: i % 2 ? "seller" : "buyer",
      packageCode: "complete",
      stage: stages[i % stages.length],
      details: { privateNote: "Coordinator only" },
      createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, i)),
    })),
  });
  await prisma.matter.create({
    data: {
      id: `${prefix}-foreign`,
      agentId: other.id,
      title: "Hidden transaction",
      propertyAddress: "Secret",
      side: "buyer",
      packageCode: "complete",
      stage: "archived",
    },
  });
  await prisma.matterParticipant.create({
    data: { matterId, userId: participant.id, role: "agent" },
  });
  await prisma.paymentOrder.createMany({
    data: [
      ...Array.from({ length: 205 }, (_, i) =>
        order(`bulk-${String(i).padStart(3, "0")}`),
      ),
      order("pending", {
        status: "pending",
        stripeSessionId: `${prefix}-pending-session`,
        details: { paymentEnvironment: "test", checkoutRedirect: "success" },
      }),
      order("partial", {
        status: "partially_refunded",
        details: { paymentEnvironment: "test", refundedCents: 1500 },
      }),
      order("unknown-partial", { status: "partially_refunded", details: {} }),
      order("refunded", {
        status: "refunded",
        details: { paymentEnvironment: "test", refundedCents: 47500 },
      }),
      order("disputed", {
        status: "disputed",
        details: { paymentEnvironment: "test" },
      }),
      order("live-eur", {
        currency: "EUR",
        details: { paymentEnvironment: "live" },
      }),
      order("unknown", { details: {} }),
      order("foreign", { matterId: `${prefix}-foreign` }),
    ],
  });
});
afterAll(async () => {
  await prisma.webhookReceipt.deleteMany({
    where: { eventId: { in: eventIds } },
  });
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [{ actorId: { startsWith: prefix } }, { entityId: { in: eventIds } }],
    },
  });
  await prisma.paymentOrder.deleteMany({
    where: { matterId: { startsWith: prefix } },
  });
  await prisma.matter.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
  vi.unstubAllEnvs();
});

describe("account retained history", () => {
  it("walks beyond 200 transactions once with complete lifecycle counts and sanitized rows", async () => {
    const ids = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await listAccountTransactions(agent, { limit: 47, cursor });
      expect(page.total).toBe(223);
      expect(page.summary.total).toBe(223);
      expect(Object.keys(page.summary.stages).sort()).toEqual(
        [...stages].sort(),
      );
      for (const row of page.items) {
        expect(ids.has(row.id)).toBe(false);
        ids.add(row.id);
        expect(row).not.toHaveProperty("details");
        expect(row).not.toHaveProperty("agentId");
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids.size).toBe(223);
    const page = await listAccountTransactions(agent, {
      stage: "archived",
      side: "seller",
      q: "BAY",
    });
    expect(page.total).toBe(37);
    expect(page.summary.total).toBe(223);
    expect(
      page.items.every(
        (row) => row.stage === "archived" && row.side === "seller",
      ),
    ).toBe(true);
  });
  it("denies clients and foreign cursors and re-evaluates participant revocation", async () => {
    await expect(listAccountTransactions(client)).rejects.toMatchObject({
      status: 403,
    });
    await expect(listAccountPayments(client)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      listAccountTransactions(agent, { cursor: `${prefix}-foreign` }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      listAccountPayments(agent, { cursor: `${prefix}-payment-foreign` }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await listAccountTransactions(participant)).total).toBe(1);
    expect((await listAccountPayments(participant)).total).toBe(212);
    await prisma.matterParticipant.update({
      where: { matterId_userId: { matterId, userId: participant.id } },
      data: { revokedAt: new Date() },
    });
    expect((await listAccountTransactions(participant)).total).toBe(0);
    expect((await listAccountPayments(participant)).total).toBe(0);
  });
  it("paginates all payments and separates currency/environment with verified refund semantics", async () => {
    const ids = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await listAccountPayments(agent, { cursor, limit: 31 });
      expect(page.total).toBe(212);
      for (const row of page.items) {
        expect(ids.has(row.id)).toBe(false);
        ids.add(row.id);
        expect(row).not.toHaveProperty("details");
        expect(row).not.toHaveProperty("snapshot");
        expect(row).not.toHaveProperty("stripeSessionId");
        expect(row.checkoutAvailable).toBe(false);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids.size).toBe(212);
    const page = await listAccountPayments(agent, {
      environment: "test",
      status: "pending",
      q: "Bay",
    });
    expect(page.total).toBe(1);
    expect(page.items[0].status).toBe("pending");
    expect(page.provider.configured).toBe(false);
    const sums = page.summary.currencies;
    expect(
      sums.find((row) => row.environment === "test" && row.currency === "USD"),
    ).toMatchObject({
      paidCents: 205 * 47500 + 46000,
      pendingCents: 47500,
      refundedCents: 49000,
      disputedCents: 47500,
    });
    expect(sums.find((row) => row.environment === "unknown")).toMatchObject({
      paidCents: 47500,
      unknownRefundCount: 1,
    });
    expect(sums.find((row) => row.environment === "live")).toMatchObject({
      currency: "EUR",
      paidCents: 47500,
    });
  });
  it("resumes only a saved matching open checkout, without writing paid from its redirect", async () => {
    const id = `${prefix}-payment-pending`;
    const provider = vi.fn(
      async () =>
        ({
          checkout: {
            sessions: {
              retrieve: async () => ({
                id: `${prefix}-pending-session`,
                metadata: { paymentOrderId: id },
                livemode: false,
                amount_total: 47500,
                currency: "usd",
                status: "open",
                url: "https://checkout.stripe.com/c/pay/synthetic",
              }),
            },
          },
        }) as unknown as Stripe,
    );
    await expect(
      resumeAccountPayment(other, id, provider),
    ).rejects.toMatchObject({ status: 404 });
    expect(provider).not.toHaveBeenCalled();
    expect((await resumeAccountPayment(agent, id, provider)).url).toBe(
      "https://checkout.stripe.com/c/pay/synthetic",
    );
    expect(
      (await prisma.paymentOrder.findUniqueOrThrow({ where: { id } })).status,
    ).toBe("pending");
    await expect(
      resumeAccountPayment(agent, `${prefix}-payment-unknown`, provider),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("persists provenance from verified events and rejects cross-mode writes", async () => {
    const id = `${prefix}-payment-pending`;
    const eventId = `${prefix}-event`;
    eventIds.push(eventId);
    await applyStripeEvent({
      id: eventId,
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: `${prefix}-pending-session`,
          metadata: { paymentOrderId: id },
          amount_total: 47500,
          currency: "usd",
          payment_status: "paid",
          payment_intent: `${prefix}-intent`,
        },
      },
    } as unknown as Stripe.Event);
    expect(
      (await prisma.paymentOrder.findUniqueOrThrow({ where: { id } })).details,
    ).toMatchObject({ paymentEnvironment: "test" });
    const badId = `${prefix}-bad-event`;
    eventIds.push(badId);
    await expect(
      applyStripeEvent({
        id: badId,
        type: "checkout.session.completed",
        livemode: false,
        data: {
          object: {
            id: `${prefix}-live-session`,
            metadata: { paymentOrderId: `${prefix}-payment-live-eur` },
            amount_total: 47500,
            currency: "eur",
            payment_status: "paid",
          },
        },
      } as unknown as Stripe.Event),
    ).rejects.toMatchObject({ code: "PAYMENT_ENVIRONMENT_MISMATCH" });
    expect(
      await prisma.webhookReceipt.count({ where: { eventId: badId } }),
    ).toBe(0);
  });
  it("saves the environment before the checkout request leaves PostgreSQL", async () => {
    const id = `${prefix}-checkout-matter`;
    await prisma.matter.create({
      data: {
        id,
        agentId: agent.id,
        title: "New request",
        propertyAddress: "New street",
        side: "buyer",
        packageCode: "complete",
      },
    });
    await prisma.giftOrder.create({
      data: {
        id,
        matterId: id,
        status: "quoted",
        selection: {
          approvedQuote: {
            description: "Build test gift",
            amountCents: 5000,
            currency: "USD",
            policy: "A verified synthetic gift policy.",
          },
        },
      },
    });
    const create = vi.fn(
      async (input: { metadata: { paymentOrderId: string } }) => {
        expect(
          (
            await prisma.paymentOrder.findUniqueOrThrow({
              where: { id: input.metadata.paymentOrderId },
            })
          ).details,
        ).toMatchObject({ paymentEnvironment: "test" });
        throw new Error("Synthetic provider failure");
      },
    );
    const provider = async () =>
      ({ checkout: { sessions: { create } } }) as unknown as Stripe;
    await expect(
      createCheckout(
        coordinator,
        {
          matterId: id,
          kind: "gift",
          giftOrderId: id,
          idempotencyKey: `${prefix}-request`,
        },
        provider,
      ),
    ).rejects.toThrow("Synthetic provider failure");
    expect(create).toHaveBeenCalledTimes(1);
    await prisma.giftOrder.delete({ where: { id } });
    await prisma.paymentOrder.deleteMany({ where: { matterId: id } });
  });
  it("never dispatches refunds for unknown or conflicting environments", async () => {
    const provider = vi.fn(async () => ({}) as Stripe);
    const input = {
      amountCents: 100,
      reason: "Synthetic refund",
      idempotencyKey: "synthetic-refund",
      confirmed: true,
    };
    await expect(
      refundPayment(coordinator, `${prefix}-payment-unknown`, input, provider),
    ).rejects.toMatchObject({ code: "PAYMENT_ENVIRONMENT_UNKNOWN" });
    await expect(
      refundPayment(coordinator, `${prefix}-payment-live-eur`, input, provider),
    ).rejects.toMatchObject({ code: "PAYMENT_ENVIRONMENT_MISMATCH" });
    await prisma.paymentOrder.update({
      where: { id: `${prefix}-payment-live-eur` },
      data: { stripeSessionId: `${prefix}-live-session` },
    });
    await expect(
      reconcilePayment(coordinator, `${prefix}-payment-live-eur`, provider),
    ).rejects.toMatchObject({ code: "PAYMENT_ENVIRONMENT_MISMATCH" });
    expect(provider).not.toHaveBeenCalled();
  });
});
