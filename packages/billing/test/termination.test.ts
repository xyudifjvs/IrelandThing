import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import { applyStripeEvent, createCheckout } from "../src/service";
import { resumeAccountPayment } from "../src/account";
import { registerMatterChangeHook, updateMatter } from "@weatherly/matters";
import {
  queueTerminatedServiceCheckouts,
  expireTerminatedServiceCheckout,
} from "../src/termination";

const run = randomUUID();
const matterIds: string[] = [];
const eventIds: string[] = [];
const actor: Principal = {
  id: `termination-${run}`,
  name: "Synthetic Ireland",
  email: `termination-${run}@example.test`,
  role: "coordinator",
  sessionId: run,
};
const protectedStatuses = [
  "paid",
  "refunded",
  "partially_refunded",
  "disputed",
];
async function fixture(
  options: {
    stage?: string;
    beforeClosing?: boolean;
    status?: string;
    session?: boolean;
    kind?: string;
    environment?: string;
  } = {},
) {
  const matter = await prisma.matter.create({
    data: {
      title: "Synthetic termination",
      propertyAddress: "42 Synthetic Contract Road",
      side: "buyer",
      packageCode: "essentials",
      stage: options.stage || "terminated",
      details: {
        termination: { beforeClosing: options.beforeClosing ?? true },
      },
    },
  });
  matterIds.push(matter.id);
  const order = await prisma.paymentOrder.create({
    data: {
      matterId: matter.id,
      createdById: actor.id,
      idempotencyKey: `termination-order-${randomUUID()}`,
      amountCents: 42500,
      currency: "USD",
      kind: options.kind || "service",
      status: options.status || "pending",
      stripeSessionId:
        options.session === false ? null : `cs_synthetic_${randomUUID()}`,
      snapshot: {
        code: "essentials",
        name: "Contract to Close",
        priceCents: 42500,
        revision: 1,
        currency: "USD",
      },
      details:
        options.environment === "unknown"
          ? {}
          : { paymentEnvironment: options.environment || "test" },
    },
  });
  return { matter, order };
}
const queue = (matterId: string) =>
  prisma.$transaction((tx) =>
    queueTerminatedServiceCheckouts(tx, actor, matterId),
  );
function session(
  order: { id: string; stripeSessionId: string | null },
  patch: Partial<Stripe.Checkout.Session> = {},
): Stripe.Checkout.Session {
  return {
    id: order.stripeSessionId!,
    object: "checkout.session",
    client_reference_id: order.id,
    metadata: { paymentOrderId: order.id },
    status: "open",
    payment_status: "unpaid",
    amount_total: 42500,
    currency: "usd",
    livemode: false,
    url: "https://checkout.stripe.com/synthetic-not-real",
    ...patch,
  } as Stripe.Checkout.Session;
}
function providerFor(order: { id: string; stripeSessionId: string | null }) {
  const retrieve = vi.fn(async () => session(order));
  const expire = vi.fn(async () =>
    session(order, { status: "expired", url: null }),
  );
  const refunds = vi.fn();
  const provider = vi.fn(
    async () =>
      ({
        checkout: { sessions: { retrieve, expire } },
        refunds: { create: refunds },
      }) as unknown as Stripe,
  );
  return { provider, retrieve, expire, refunds };
}
async function retained(id: string) {
  return prisma.paymentOrder.findUniqueOrThrow({ where: { id } });
}

afterAll(async () => {
  const orders = await prisma.paymentOrder.findMany({
    where: { matterId: { in: matterIds } },
    select: { id: true },
  });
  if (orders.length)
    await prisma.outboxJob.deleteMany({
      where: {
        OR: orders.map((order) => ({
          idempotencyKey: {
            startsWith: `billing-expire-checkout:${order.id}:`,
          },
        })),
      },
    });
  await prisma.webhookReceipt.deleteMany({
    where: { eventId: { in: eventIds } },
  });
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { matterId: { in: matterIds } },
        { actorId: actor.id },
        { entityId: { in: eventIds } },
      ],
    },
  });
  await prisma.paymentOrder.deleteMany({
    where: { matterId: { in: matterIds } },
  });
  await prisma.matter.deleteMany({ where: { id: { in: matterIds } } });
  await prisma.$disconnect();
});

describe("pre-closing termination checkout expiration", () => {
  it("records the real lifecycle decision atomically with checkout invalidation and retains it after archival", async () => {
    const { matter, order } = await fixture({
      stage: "under_contract",
      beforeClosing: false,
    });
    registerMatterChangeHook(async (tx, actor, id) => {
      await queueTerminatedServiceCheckouts(tx, actor, id);
    });
    try {
      const terminated = await updateMatter(actor, matter.id, {
        expectedRevision: matter.revision,
        stage: "terminated",
      });
      const recorded = (terminated.details as Record<string, unknown>)
        .termination;
      expect(recorded).toMatchObject({
        beforeClosing: true,
        fromStage: "under_contract",
        byId: actor.id,
      });
      expect((await retained(order.id)).status).toBe("void_pending");
      const archived = await updateMatter(actor, matter.id, {
        expectedRevision: terminated.revision,
        stage: "archived",
        details: { preservedNote: "Synthetic note" },
      });
      expect((archived.details as Record<string, unknown>).termination).toEqual(
        recorded,
      );
      await expect(
        updateMatter(actor, matter.id, {
          expectedRevision: terminated.revision,
          details: { termination: { beforeClosing: false } },
        }),
      ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
      expect(
        (await prisma.matter.findUniqueOrThrow({ where: { id: matter.id } }))
          .details,
      ).toEqual(archived.details);
      expect(
        await prisma.outboxJob.count({
          where: {
            idempotencyKey: {
              startsWith: `billing-expire-checkout:${order.id}:`,
            },
          },
        }),
      ).toBe(1);

      const closed = await fixture({ stage: "closed", beforeClosing: false });
      const archivedClosed = await updateMatter(actor, closed.matter.id, {
        expectedRevision: closed.matter.revision,
        stage: "archived",
      });
      expect(
        (archivedClosed.details as Record<string, unknown>).termination,
      ).toEqual({ beforeClosing: false });
      expect(await retained(closed.order.id)).toEqual(closed.order);
      expect(
        await prisma.outboxJob.count({
          where: {
            idempotencyKey: {
              startsWith: `billing-expire-checkout:${closed.order.id}:`,
            },
          },
        }),
      ).toBe(0);
    } finally {
      registerMatterChangeHook(undefined);
    }
  });

  it("queues once only for explicit pre-closing termination and cancels no-session requests locally", async () => {
    for (const options of [
      { stage: "under_contract" },
      { beforeClosing: false },
    ]) {
      const { matter, order } = await fixture(options);
      await queue(matter.id);
      expect(await retained(order.id)).toEqual(order);
    }
    const { matter, order } = await fixture();
    await queue(matter.id);
    await queue(matter.id);
    expect(await retained(order.id)).toMatchObject({
      status: "void_pending",
      amountCents: 42500,
      snapshot: order.snapshot,
    });
    const jobs = await prisma.outboxJob.findMany({
      where: {
        idempotencyKey: { startsWith: `billing-expire-checkout:${order.id}:` },
      },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toEqual({ paymentOrderId: order.id });
    const noSession = await fixture({ status: "creating", session: false });
    await queue(noSession.matter.id);
    expect(await retained(noSession.order.id)).toMatchObject({
      status: "cancelled",
      details: { terminationVoid: { state: "no_session_saved" } },
    });
    expect(
      await prisma.outboxJob.count({
        where: {
          idempotencyKey: {
            startsWith: `billing-expire-checkout:${noSession.order.id}:`,
          },
        },
      }),
    ).toBe(0);
  });

  it("preserves all paid/refund/dispute and gift history without voiding or refunding it", async () => {
    for (const status of protectedStatuses) {
      const { matter, order } = await fixture({ status });
      await queue(matter.id);
      expect(await retained(order.id)).toEqual(order);
    }
    const gift = await fixture({ kind: "gift" });
    await queue(gift.matter.id);
    expect(await retained(gift.order.id)).toEqual(gift.order);
  });

  it("expires a matched open provider checkout and retries idempotently without changing the approved price/snapshot", async () => {
    const { matter, order } = await fixture();
    await queue(matter.id);
    const provider = providerFor(order);
    expect(
      await expireTerminatedServiceCheckout(
        { paymentOrderId: order.id },
        provider.provider,
      ),
    ).toEqual({ expired: true, requiresReconciliation: false });
    expect(provider.expire).toHaveBeenCalledWith(
      order.stripeSessionId,
      {},
      {
        idempotencyKey: `weatherly-terminate:${order.id}:${order.stripeSessionId}`,
      },
    );
    expect(await retained(order.id)).toMatchObject({
      status: "cancelled",
      amountCents: order.amountCents,
      snapshot: order.snapshot,
      details: { terminationVoid: { state: "expired" } },
    });
    expect(
      await expireTerminatedServiceCheckout(
        { paymentOrderId: order.id },
        provider.provider,
      ),
    ).toEqual({ expired: true });
    expect(provider.expire).toHaveBeenCalledTimes(1);
    expect(provider.refunds).not.toHaveBeenCalled();
    await expect(
      expireTerminatedServiceCheckout(
        { paymentOrderId: order.id, sessionId: "foreign" },
        provider.provider,
      ),
    ).rejects.toBeDefined();
  });

  it("fails closed for mismatched session bindings or payment modes and performs no expiration", async () => {
    for (const patch of [
      { id: "different" },
      { amount_total: 1 },
      { currency: "eur" },
      { livemode: true },
      { metadata: { paymentOrderId: "other-order" } },
    ]) {
      const { matter, order } = await fixture();
      await queue(matter.id);
      const provider = providerFor(order);
      provider.retrieve.mockResolvedValue(session(order, patch));
      expect(
        await expireTerminatedServiceCheckout(
          { paymentOrderId: order.id },
          provider.provider,
        ),
      ).toMatchObject({ requiresReconciliation: true });
      expect((await retained(order.id)).status).toBe("requires_reconciliation");
      expect(provider.expire).not.toHaveBeenCalled();
      expect(provider.refunds).not.toHaveBeenCalled();
    }
    const unknown = await fixture({ environment: "unknown" });
    await queue(unknown.matter.id);
    const provider = providerFor(unknown.order);
    await expect(
      expireTerminatedServiceCheckout(
        { paymentOrderId: unknown.order.id },
        provider.provider,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_ENVIRONMENT_UNKNOWN" });
    expect(provider.provider).not.toHaveBeenCalled();
  });

  it("marks completed/paid provider races for reconciliation and never invents a refund", async () => {
    const completed = await fixture();
    await queue(completed.matter.id);
    const provider = providerFor(completed.order);
    provider.retrieve.mockResolvedValue(
      session(completed.order, { status: "complete", payment_status: "paid" }),
    );
    expect(
      await expireTerminatedServiceCheckout(
        { paymentOrderId: completed.order.id },
        provider.provider,
      ),
    ).toMatchObject({ requiresReconciliation: true });
    expect(await retained(completed.order.id)).toMatchObject({
      status: "requires_reconciliation",
      snapshot: completed.order.snapshot,
    });
    expect(provider.expire).not.toHaveBeenCalled();
    const raced = await fixture();
    await queue(raced.matter.id);
    const racing = providerFor(raced.order);
    racing.expire.mockImplementation(async () => {
      const eventId = `evt_termination_${randomUUID()}`;
      eventIds.push(eventId);
      await applyStripeEvent({
        id: eventId,
        type: "checkout.session.completed",
        livemode: false,
        data: {
          object: session(raced.order, {
            status: "complete",
            payment_status: "paid",
            payment_intent: "pi_synthetic_race",
          }),
        },
      } as Stripe.Event);
      return session(raced.order, { status: "expired", url: null });
    });
    expect(
      await expireTerminatedServiceCheckout(
        { paymentOrderId: raced.order.id },
        racing.provider,
      ),
    ).toMatchObject({ requiresReconciliation: true, expired: false });
    expect(await retained(raced.order.id)).toMatchObject({
      status: "paid",
      amountCents: 42500,
      snapshot: raced.order.snapshot,
      details: { requiresReconciliation: true },
    });
    expect(racing.refunds).not.toHaveBeenCalled();
  });

  it("re-reads provider errors instead of claiming expiration and uses the same key on retry", async () => {
    const { matter, order } = await fixture();
    await queue(matter.id);
    const provider = providerFor(order);
    provider.expire.mockRejectedValueOnce(
      new Error("synthetic temporary provider failure"),
    );
    await expect(
      expireTerminatedServiceCheckout(
        { paymentOrderId: order.id },
        provider.provider,
      ),
    ).rejects.toMatchObject({
      code: "CHECKOUT_EXPIRATION_FAILED",
      status: 503,
    });
    expect((await retained(order.id)).status).toBe("void_pending");
    expect(
      await expireTerminatedServiceCheckout(
        { paymentOrderId: order.id },
        provider.provider,
      ),
    ).toMatchObject({ expired: true });
    expect(provider.expire.mock.calls[0]).toEqual(
      provider.expire.mock.calls[1],
    );
    const already = await fixture();
    await queue(already.matter.id);
    const prior = providerFor(already.order);
    prior.retrieve.mockResolvedValue(
      session(already.order, { status: "expired", url: null }),
    );
    expect(
      await expireTerminatedServiceCheckout(
        { paymentOrderId: already.order.id },
        prior.provider,
      ),
    ).toMatchObject({ expired: true });
    expect(prior.expire).not.toHaveBeenCalled();
  });

  it("withholds a late-created Stripe URL when termination arrives during provider creation, then queues expiration", async () => {
    const matter = await prisma.matter.create({
      data: {
        title: "Synthetic creation race",
        stage: "closing",
        propertyAddress: "42 Synthetic Race Way",
        side: "buyer",
        packageCode: "essentials",
      },
    });
    matterIds.push(matter.id);
    let issuedOrderId = "";
    let externalSession = "";
    const create = vi.fn(
      async (request: Stripe.Checkout.SessionCreateParams) => {
        issuedOrderId = request.client_reference_id!;
        externalSession = `cs_synthetic_${randomUUID()}`;
        await prisma.matter.update({
          where: { id: matter.id },
          data: {
            stage: "terminated",
            details: { termination: { beforeClosing: true } },
          },
        });
        await queue(matter.id);
        expect((await retained(issuedOrderId)).status).toBe("cancelled");
        return session({ id: issuedOrderId, stripeSessionId: externalSession });
      },
    );
    const provider = async () =>
      ({ checkout: { sessions: { create } } }) as unknown as Stripe;
    await expect(
      createCheckout(
        actor,
        { matterId: matter.id, kind: "service", idempotencyKey: randomUUID() },
        provider,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_CLOSED" });
    const issued = await retained(issuedOrderId);
    expect(issued).toMatchObject({
      status: "void_pending",
      stripeSessionId: externalSession,
      amountCents: 42500,
    });
    expect(
      await prisma.outboxJob.count({
        where: {
          idempotencyKey: {
            startsWith: `billing-expire-checkout:${issued.id}:`,
          },
        },
      }),
    ).toBe(1);
    const expiration = providerFor(issued);
    expect(
      await expireTerminatedServiceCheckout(
        { paymentOrderId: issued.id },
        expiration.provider,
      ),
    ).toMatchObject({ expired: true });
    expect(create).toHaveBeenCalledTimes(1);
    expect(expiration.refunds).not.toHaveBeenCalled();
  });

  it("withholds an existing checkout URL if termination occurs during the provider read", async () => {
    const { matter, order } = await fixture({
      stage: "under_contract",
      beforeClosing: false,
    });
    const retrieve = vi.fn(async () => {
      await prisma.matter.update({
        where: { id: matter.id },
        data: {
          stage: "terminated",
          details: { termination: { beforeClosing: true } },
        },
      });
      await queue(matter.id);
      return session(order);
    });
    const provider = async () =>
      ({ checkout: { sessions: { retrieve } } }) as unknown as Stripe;
    await expect(
      createCheckout(
        actor,
        { matterId: matter.id, kind: "service", idempotencyKey: randomUUID() },
        provider,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_CLOSED" });
    expect((await retained(order.id)).status).toBe("void_pending");
    expect(
      await prisma.outboxJob.count({
        where: {
          idempotencyKey: {
            startsWith: `billing-expire-checkout:${order.id}:`,
          },
        },
      }),
    ).toBe(1);
  });

  it("retains pre-closing termination denial after archival even if an old request still reads pending", async () => {
    const { matter, order } = await fixture({ stage: "archived" });
    const provider = providerFor(order);
    await expect(
      resumeAccountPayment(actor, order.id, provider.provider),
    ).rejects.toMatchObject({ code: "SERVICE_NOT_DUE_TERMINATED" });
    await expect(
      createCheckout(
        actor,
        { matterId: matter.id, kind: "service", idempotencyKey: randomUUID() },
        provider.provider,
      ),
    ).rejects.toMatchObject({ code: "SERVICE_NOT_DUE_TERMINATED" });
    expect(provider.retrieve).not.toHaveBeenCalled();
    expect(provider.expire).not.toHaveBeenCalled();
    expect(await retained(order.id)).toEqual(order);
  });
});
