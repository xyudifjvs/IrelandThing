import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { prisma, type Prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import {
  changeFileLifecycle,
  deleteFile,
} from "../../matters/src/commands/file-actions";
import { listAccountPayments, resumeAccountPayment } from "../src/account";
import {
  applyStripeEvent,
  createCheckout,
  listPayments,
  recordIntakeGift,
} from "../src/service";
import {
  expireTerminatedServiceCheckout,
  queueDeletedFileCheckouts,
  queueTerminatedServiceCheckouts,
} from "../src/termination";

const run = randomUUID();
function principal(role: Principal["role"]): Principal {
  const id = `${role}-billing-business-${run}`;
  return {
    id,
    name: `Synthetic ${role}`,
    email: `${id}@example.test`,
    role,
    sessionId: run,
  };
}
const owner = principal("coordinator");
const agent = principal("agent");
const matterIds: string[] = [];
const receiptIds: string[] = [];
const eventIds: string[] = [];

beforeAll(async () => {
  vi.stubEnv("STRIPE_MODE", "test");
  await prisma.user.createMany({
    data: [owner, agent].map(({ id, name, email, role }) => ({
      id,
      name,
      email,
      role,
    })),
  });
  await prisma.rosterAgent.create({
    data: { name: agent.name, business: "hto", userId: agent.id },
  });
});

afterAll(async () => {
  const orders = await prisma.paymentOrder.findMany({
    where: { matterId: { in: matterIds } },
    select: { id: true },
  });
  for (const order of orders) {
    await prisma.outboxJob.deleteMany({
      where: {
        idempotencyKey: { startsWith: `billing-expire-checkout:${order.id}:` },
      },
    });
  }
  await prisma.webhookReceipt.deleteMany({
    where: { eventId: { in: eventIds } },
  });
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [{ matterId: { in: matterIds } }, { entityId: { in: eventIds } }],
    },
  });
  await prisma.giftOrder.deleteMany({ where: { matterId: { in: matterIds } } });
  await prisma.paymentOrder.deleteMany({
    where: { matterId: { in: matterIds } },
  });
  await prisma.intakeSubmission.deleteMany({
    where: { id: { in: receiptIds } },
  });
  await prisma.matter.deleteMany({ where: { id: { in: matterIds } } });
  await prisma.rosterAgent.deleteMany({ where: { userId: agent.id } });
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, agent.id] } } });
  vi.unstubAllEnvs();
});

async function file(business: "weatherly" | "hto") {
  const result = await prisma.matter.create({
    data: {
      title: "Synthetic closing payment",
      propertyAddress: "98 Synthetic Road",
      side: "buyer",
      // Even a forged legacy package cannot make an HTO file chargeable.
      packageCode: "essentials",
      business,
      stage: "under_contract",
      checklistVersion: 1,
      agentId: agent.id,
    },
  });
  matterIds.push(result.id);
  return result;
}

async function oldOrder(
  matterId: string,
  overrides: Partial<Prisma.PaymentOrderUncheckedCreateInput> = {},
) {
  return prisma.paymentOrder.create({
    data: {
      matterId,
      createdById: owner.id,
      idempotencyKey: randomUUID(),
      amountCents: 37500,
      status: "pending",
      snapshot: { name: "Historical approved price" },
      details: { paymentEnvironment: "test" },
      stripeSessionId: `cs_synthetic_${randomUUID()}`,
      ...overrides,
    },
  });
}
type Order = Awaited<ReturnType<typeof oldOrder>>;
function session(
  order: Pick<Order, "id" | "amountCents" | "currency" | "stripeSessionId">,
  overrides: Partial<Stripe.Checkout.Session> = {},
) {
  return {
    id: order.stripeSessionId!,
    metadata: { paymentOrderId: order.id },
    livemode: false,
    amount_total: order.amountCents,
    currency: order.currency.toLowerCase(),
    status: "open",
    payment_status: "unpaid",
    url: "https://checkout.stripe.com/synthetic",
    ...overrides,
  } as Stripe.Checkout.Session;
}

function checkoutProvider(order?: Order) {
  const create = vi.fn(async (input: Stripe.Checkout.SessionCreateParams) => {
    const id = input.client_reference_id!;
    const saved = await prisma.paymentOrder.findUniqueOrThrow({
      where: { id },
    });
    return session({
      ...saved,
      stripeSessionId: `cs_synthetic_${randomUUID()}`,
    });
  });
  const retrieve = vi.fn(async () => session(order!));
  const expire = vi.fn(async () =>
    session(order!, { status: "expired", url: null }),
  );
  const provider = vi.fn(
    async () =>
      ({
        checkout: { sessions: { create, retrieve, expire } },
      }) as unknown as Stripe,
  );
  return { create, retrieve, expire, provider };
}

function checkoutEvent(type: string, checkout: Stripe.Checkout.Session) {
  const id = `billing-business-${randomUUID()}`;
  eventIds.push(id);
  return {
    id,
    type,
    livemode: false,
    data: { object: checkout },
  } as Stripe.Event;
}

const coordinatorRequest = (
  matterId: string,
  idempotencyKey = randomUUID(),
) => ({
  matterId,
  kind: "service",
  idempotencyKey,
  closingPaymentConfirmed: true,
});

describe("file-business and closing payment boundaries", () => {
  it("rejects HTO service creation and old links before Stripe while retaining separate gifts", async () => {
    const hto = await file("hto");
    const { provider } = checkoutProvider();
    await expect(
      createCheckout(owner, coordinatorRequest(hto.id), provider),
    ).rejects.toMatchObject({ code: "SERVICE_FEE_EXEMPT" });
    expect(
      await prisma.paymentOrder.count({ where: { matterId: hto.id } }),
    ).toBe(0);

    const historical = await oldOrder(hto.id);
    const giftOrder = await oldOrder(hto.id, {
      kind: "gift",
      amountCents: 1900,
    });
    await expect(
      createCheckout(owner, coordinatorRequest(hto.id), provider),
    ).rejects.toMatchObject({ code: "SERVICE_FEE_EXEMPT" });
    await expect(
      resumeAccountPayment(agent, historical.id, provider),
    ).rejects.toMatchObject({ code: "SERVICE_FEE_EXEMPT" });
    expect(provider).not.toHaveBeenCalled();

    expect((await listPayments(agent, hto.id)).map(({ id }) => id)).toEqual([
      giftOrder.id,
    ]);
    expect(
      (await listAccountPayments(agent)).items.map(({ id }) => id),
    ).toContain(giftOrder.id);
    expect(
      (await listAccountPayments(agent)).items.map(({ id }) => id),
    ).not.toContain(historical.id);
    expect((await listPayments(owner, hto.id)).map(({ id }) => id)).toContain(
      historical.id,
    );

    const giftCheckout = checkoutProvider(giftOrder);
    await expect(
      resumeAccountPayment(agent, giftOrder.id, giftCheckout.provider),
    ).resolves.toMatchObject({
      id: giftOrder.id,
      status: "pending",
      url: "https://checkout.stripe.com/synthetic",
    });
  });

  it("requires explicit closing confirmation on a canonical Weatherly file assigned to an HTO agent", async () => {
    const weatherly = await file("weatherly");
    const { provider, create } = checkoutProvider();
    const request = coordinatorRequest(weatherly.id);
    const { closingPaymentConfirmed: _, ...legacyRequest } = request;
    await expect(
      createCheckout(owner, legacyRequest, provider),
    ).rejects.toMatchObject({ code: "SERVICE_NOT_DUE" });
    expect(create).not.toHaveBeenCalled();
    const issued = await createCheckout(owner, request, provider);
    const payment = await prisma.paymentOrder.findUniqueOrThrow({
      where: { id: issued.id },
    });
    expect(payment).toMatchObject({
      amountCents: 42500,
      details: {
        closingPaymentConfirmed: true,
        matterStageAtRequest: "under_contract",
      },
      snapshot: { code: "essentials", dueAtClosing: true },
    });
    expect(
      (await prisma.matter.findUniqueOrThrow({ where: { id: weatherly.id } }))
        .stage,
    ).toBe("under_contract");
    expect(
      (await listPayments(agent, weatherly.id)).map(({ id }) => id),
    ).toEqual([payment.id]);
  });

  it("keeps cancellation and expiry active after reopening and permits a fresh explicit request only after expiry", async () => {
    const weatherly = await file("weatherly");
    const priorKey = randomUUID();
    const prior = await oldOrder(weatherly.id, {
      idempotencyKey: `service:${weatherly.id}:${priorKey}`,
    });
    const effects = {
      async onTransition(
        tx: Prisma.TransactionClient,
        actor: Principal,
        change: { matterId: string },
      ) {
        await queueTerminatedServiceCheckouts(tx, actor, change.matterId);
      },
    };
    const terminated = await changeFileLifecycle(
      owner,
      weatherly.id,
      {
        action: "terminate",
        expectedRevision: weatherly.revision,
      },
      effects,
    );
    await changeFileLifecycle(
      owner,
      weatherly.id,
      {
        action: "reopen",
        expectedRevision: terminated.revision,
      },
      effects,
    );
    const fake = checkoutProvider(prior);
    await expect(
      resumeAccountPayment(agent, prior.id, fake.provider),
    ).rejects.toMatchObject({ code: "PAYMENT_NOT_PAYABLE" });
    await expect(
      createCheckout(owner, coordinatorRequest(weatherly.id), fake.provider),
    ).rejects.toMatchObject({ code: "PAYMENT_CLOSED" });
    expect(fake.create).not.toHaveBeenCalled();
    await expect(
      expireTerminatedServiceCheckout(
        { paymentOrderId: prior.id },
        fake.provider,
      ),
    ).resolves.toMatchObject({ expired: true });
    await expect(
      createCheckout(
        owner,
        coordinatorRequest(weatherly.id, priorKey),
        fake.provider,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_CLOSED" });
    expect(fake.create).not.toHaveBeenCalled();
    const next = await createCheckout(
      owner,
      coordinatorRequest(weatherly.id),
      fake.provider,
    );
    expect(next.id).not.toBe(prior.id);
    await expect(
      createCheckout(
        owner,
        coordinatorRequest(weatherly.id, priorKey),
        fake.provider,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_CLOSED" });
    expect(
      (await prisma.paymentOrder.findUniqueOrThrow({ where: { id: prior.id } }))
        .status,
    ).toBe("cancelled");
  });

  it("records and expires a checkout created by Stripe after file deletion, preserving history", async () => {
    const weatherly = await file("weatherly");
    const gift = await oldOrder(weatherly.id, {
      kind: "gift",
      amountCents: 1900,
    });
    const fake = checkoutProvider();
    fake.create.mockImplementationOnce(async (input) => {
      const id = input.client_reference_id!;
      const order = await prisma.paymentOrder.findUniqueOrThrow({
        where: { id },
      });
      await deleteFile(
        owner,
        weatherly.id,
        {
          expectedRevision: weatherly.revision,
          confirmation: "DELETE",
        },
        {
          async beforeDelete(tx, actor, event) {
            await queueDeletedFileCheckouts(tx, actor, event.matterId);
          },
        },
      );
      return session({
        ...order,
        stripeSessionId: `cs_synthetic_${randomUUID()}`,
      });
    });
    await expect(
      createCheckout(owner, coordinatorRequest(weatherly.id), fake.provider),
    ).rejects.toMatchObject({ code: "PAYMENT_CLOSED" });
    const service = await prisma.paymentOrder.findFirstOrThrow({
      where: { matterId: weatherly.id, kind: "service" },
    });
    expect(service).toMatchObject({
      status: "void_pending",
      details: {
        terminationVoid: { trigger: "file_deleted", state: "pending" },
      },
    });
    for (const order of [service, gift]) {
      const adapter = checkoutProvider(order);
      await expect(
        expireTerminatedServiceCheckout(
          { paymentOrderId: order.id },
          adapter.provider,
        ),
      ).resolves.toMatchObject({ expired: true });
      expect(adapter.expire).toHaveBeenCalledOnce();
    }
    expect((await listPayments(owner)).map(({ id }) => id)).toEqual(
      expect.arrayContaining([service.id, gift.id]),
    );
    expect(
      (await listAccountPayments(agent)).items.map(({ id }) => id),
    ).not.toContain(service.id);
  });

  it("keeps verified late HTO settlements for reconciliation and ignores forged or out-of-order events", async () => {
    const hto = await file("hto");
    const historical = await oldOrder(hto.id);
    const notIssued = await oldOrder(hto.id, { stripeSessionId: null });
    const fabricated = checkoutEvent(
      "checkout.session.completed",
      session(
        {
          ...notIssued,
          stripeSessionId: `cs_synthetic_${randomUUID()}`,
        },
        { payment_status: "paid" },
      ),
    );
    await expect(applyStripeEvent(fabricated)).rejects.toMatchObject({
      code: "PAYMENT_MISMATCH",
    });

    const paid = checkoutEvent(
      "checkout.session.completed",
      session(historical, { payment_status: "paid" }),
    );
    await Promise.all([applyStripeEvent(paid), applyStripeEvent(paid)]);
    await applyStripeEvent(
      checkoutEvent(
        "checkout.session.expired",
        session(historical, { status: "expired" }),
      ),
    );
    expect(
      await prisma.webhookReceipt.count({ where: { eventId: paid.id } }),
    ).toBe(1);
    expect(
      await prisma.paymentOrder.findUniqueOrThrow({
        where: { id: historical.id },
      }),
    ).toMatchObject({
      status: "paid",
      amountCents: historical.amountCents,
      snapshot: historical.snapshot,
      details: {
        requiresReconciliation: true,
        terminationVoid: {
          trigger: "hto_exempt",
          state: "requires_reconciliation",
        },
      },
    });
  });

  it("keeps intake gift creation idempotent and skips a deleted intake receipt", async () => {
    const hto = await file("hto");
    async function receipt(deletedAt?: Date) {
      const value = await prisma.intakeSubmission.create({
        data: {
          draftId: randomUUID(),
          idempotencyKey: randomUUID(),
          userId: agent.id,
          matterId: hto.id,
          snapshot: { gift: { requested: true } },
          deletedAt,
        },
      });
      receiptIds.push(value.id);
      return value.id;
    }
    const kept = await receipt();
    const deleted = await receipt(new Date());
    await Promise.all([
      recordIntakeGift(hto.id, kept),
      recordIntakeGift(hto.id, kept),
    ]);
    await recordIntakeGift(hto.id, deleted);
    const gifts = await prisma.giftOrder.findMany({
      where: { matterId: hto.id },
    });
    expect(gifts.map(({ id }) => id)).toEqual([`intake-gift-${kept}`]);
  });
});
