import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import { createCheckout, listCatalog } from "../src/service";

const runId = randomUUID();
const matters: string[] = [];
const actor: Principal = {
  id: `catalog-${runId}`,
  name: "Synthetic catalog coordinator",
  email: `catalog-${runId}@example.test`,
  role: "coordinator",
  sessionId: runId,
};
const create = vi.fn(async () => ({
  id: `cs_synthetic_${randomUUID()}`,
  status: "open",
  url: "https://checkout.stripe.com/synthetic",
}));
const provider = async () =>
  ({ checkout: { sessions: { create } } }) as unknown as Stripe;

async function matter(packageCode: string) {
  const saved = await prisma.matter.create({
    data: {
      title: "Synthetic catalog request",
      propertyAddress: "1 Synthetic Catalog Road",
      packageCode,
      side: packageCode === "full_listing" ? "seller" : "buyer",
    },
  });
  matters.push(saved.id);
  return saved;
}

afterAll(async () => {
  await prisma.paymentOrder.deleteMany({
    where: { matterId: { in: matters } },
  });
  await prisma.auditEvent.deleteMany({ where: { actorId: actor.id } });
  await prisma.matter.deleteMany({ where: { id: { in: matters } } });
  await prisma.$disconnect();
});

describe("Ireland's approved future service catalog", () => {
  it("prices new requests at $425/$515 and keeps the exact server snapshot", async () => {
    const catalog = await listCatalog();
    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "essentials",
          name: "Contract to Close",
          priceCents: 42500,
          approved: true,
        }),
        expect.objectContaining({
          code: "complete",
          name: "Contract to Close + Compliance",
          priceCents: 51500,
          approved: true,
        }),
        expect.objectContaining({ code: "full_listing", approved: false }),
      ]),
    );
    for (const [code, price, name] of [
      ["essentials", 42500, "Contract to Close"],
      ["complete", 51500, "Contract to Close + Compliance"],
    ] as const) {
      const saved = await matter(code);
      const result = await createCheckout(
        actor,
        { matterId: saved.id, kind: "service", idempotencyKey: randomUUID() },
        provider,
      );
      const order = await prisma.paymentOrder.findUniqueOrThrow({
        where: { id: result.id },
      });
      expect(order.amountCents).toBe(price);
      expect(order.snapshot).toMatchObject({
        code,
        name,
        priceCents: price,
        currency: "USD",
      });
    }
  });

  it("retains historical prices/orders while rejecting a new Full Listing request", async () => {
    for (const [code, price] of [
      ["essentials", 37500],
      ["complete", 47500],
      ["full_listing", 62500],
    ] as const) {
      const saved = await matter(code);
      const historical = await prisma.paymentOrder.create({
        data: {
          matterId: saved.id,
          createdById: actor.id,
          idempotencyKey: `historical-${saved.id}`,
          amountCents: price,
          kind: "service",
          currency: "USD",
          status: "paid",
          snapshot: {
            code,
            name: "Historical approved service",
            revision: 1,
            priceCents: price,
            currency: "USD",
          },
          details: { paymentEnvironment: "test" },
        },
      });
      const calls = create.mock.calls.length;
      const replay = await createCheckout(
        actor,
        {
          matterId: saved.id,
          kind: "service",
          catalogRevision: 1,
          idempotencyKey: randomUUID(),
        },
        provider,
      );
      expect(replay).toMatchObject({
        id: historical.id,
        status: "paid",
        url: null,
      });
      expect(
        await prisma.paymentOrder.findUniqueOrThrow({
          where: { id: historical.id },
        }),
      ).toEqual(historical);
      expect(create.mock.calls.length).toBe(calls);
    }
    const unavailable = await matter("full_listing");
    const calls = create.mock.calls.length;
    await expect(
      createCheckout(
        actor,
        {
          matterId: unavailable.id,
          kind: "service",
          idempotencyKey: randomUUID(),
        },
        provider,
      ),
    ).rejects.toMatchObject({ status: 409, code: "SERVICE_COMING_SOON" });
    expect(
      await prisma.paymentOrder.count({ where: { matterId: unavailable.id } }),
    ).toBe(0);
    expect(create.mock.calls.length).toBe(calls);
  });
});
