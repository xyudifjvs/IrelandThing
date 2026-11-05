import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import { createCheckout, listCatalog } from "../src/service";
import { resumeAccountPayment } from "../src/account";
import { createMatter, updateMatter } from "@weatherly/matters";

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
      stage: "closing",
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
        dueAtClosing: true,
      });
      expect(order.details).toMatchObject({
        dueAtClosing: true,
        requestInitiatedBy: "coordinator",
        requestedById: actor.id,
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

  it("uses the approved transaction price snapshot and rejects a different package", async () => {
    const saved = await matter("complete");
    const approved = {
      code: "complete",
      name: "Previously approved Compliance",
      revision: 1,
      priceCents: 47500,
      currency: "USD",
    };
    await prisma.matter.update({
      where: { id: saved.id },
      data: { details: { serviceSnapshot: approved } },
    });
    expect(
      await prisma.paymentOrder.count({ where: { matterId: saved.id } }),
    ).toBe(0);
    const result = await createCheckout(
      actor,
      { matterId: saved.id, kind: "service", idempotencyKey: randomUUID() },
      provider,
    );
    const order = await prisma.paymentOrder.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(order.amountCents).toBe(47500);
    expect(order.snapshot).toEqual({
      ...approved,
      dueAtClosing: true,
      noFeeIfTerminatedBeforeClosing: true,
    });
    const mismatched = await matter("essentials");
    await prisma.matter.update({
      where: { id: mismatched.id },
      data: { details: { serviceSnapshot: approved } },
    });
    const calls = create.mock.calls.length;
    await expect(
      createCheckout(
        actor,
        {
          matterId: mismatched.id,
          kind: "service",
          idempotencyKey: randomUUID(),
        },
        provider,
      ),
    ).rejects.toMatchObject({ code: "SERVICE_PACKAGE_MISMATCH", status: 409 });
    expect(
      await prisma.paymentOrder.count({ where: { matterId: mismatched.id } }),
    ).toBe(0);
    expect(create.mock.calls.length).toBe(calls);
  });

  it("allows only Ireland to release a new order and never accepts client-selected amounts/packages", async () => {
    const saved = await matter("essentials");
    const calls = create.mock.calls.length;
    await expect(
      createCheckout(
        { ...actor, role: "agent" },
        { matterId: saved.id, kind: "service", idempotencyKey: randomUUID() },
        provider,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      createCheckout(
        actor,
        {
          matterId: saved.id,
          kind: "service",
          idempotencyKey: randomUUID(),
          amountCents: 1,
          packageCode: "complete",
        },
        provider,
      ),
    ).rejects.toBeDefined();
    expect(
      await prisma.paymentOrder.count({ where: { matterId: saved.id } }),
    ).toBe(0);
    expect(create.mock.calls.length).toBe(calls);
  });

  it("blocks new and previously issued unpaid service checkout after termination without changing payment/refund history", async () => {
    const saved = await matter("essentials");
    const issued = await createCheckout(
      actor,
      { matterId: saved.id, kind: "service", idempotencyKey: randomUUID() },
      provider,
    );
    const before = await prisma.paymentOrder.findUniqueOrThrow({
      where: { id: issued.id },
    });
    expect(before.snapshot).toMatchObject({
      dueAtClosing: true,
      noFeeIfTerminatedBeforeClosing: true,
    });
    await prisma.matter.update({
      where: { id: saved.id },
      data: { stage: "terminated" },
    });
    const calls = create.mock.calls.length;
    await expect(
      createCheckout(
        actor,
        { matterId: saved.id, kind: "service", idempotencyKey: randomUUID() },
        provider,
      ),
    ).rejects.toMatchObject({ code: "SERVICE_NOT_DUE_TERMINATED" });
    await expect(
      resumeAccountPayment(actor, issued.id, provider),
    ).rejects.toMatchObject({ code: "SERVICE_NOT_DUE_TERMINATED" });
    expect(create.mock.calls.length).toBe(calls);
    expect(
      await prisma.paymentOrder.findUniqueOrThrow({ where: { id: issued.id } }),
    ).toEqual(before);
    const unpaid = await matter("complete");
    await prisma.matter.update({
      where: { id: unpaid.id },
      data: { stage: "terminated" },
    });
    await expect(
      createCheckout(
        actor,
        { matterId: unpaid.id, kind: "service", idempotencyKey: randomUUID() },
        provider,
      ),
    ).rejects.toMatchObject({ code: "SERVICE_NOT_DUE_TERMINATED" });
    expect(
      await prisma.paymentOrder.count({ where: { matterId: unpaid.id } }),
    ).toBe(0);
    await prisma.paymentOrder.update({
      where: { id: issued.id },
      data: { status: "paid" },
    });
    const paid = await prisma.paymentOrder.findUniqueOrThrow({
      where: { id: issued.id },
    });
    expect(
      await createCheckout(
        actor,
        { matterId: saved.id, kind: "service", idempotencyKey: randomUUID() },
        provider,
      ),
    ).toMatchObject({ id: paid.id, status: "paid", url: null });
    expect(
      await prisma.paymentOrder.findUniqueOrThrow({ where: { id: paid.id } }),
    ).toEqual(paid);
  });

  it("issues new service checkout only for a confirmed file in closing/closed, while retaining historical requests", async () => {
    for (const state of [
      {
        stage: "pending_review",
        details: { fileReview: { status: "pending" } },
      },
      { stage: "under_contract", details: {} },
      { stage: "closing", details: { fileReview: { status: "pending" } } },
    ]) {
      const saved = await matter("essentials");
      await prisma.matter.update({ where: { id: saved.id }, data: state });
      const calls = create.mock.calls.length;
      await expect(
        createCheckout(
          actor,
          { matterId: saved.id, kind: "service", idempotencyKey: randomUUID() },
          provider,
        ),
      ).rejects.toMatchObject({ code: "SERVICE_NOT_DUE", status: 409 });
      expect(
        await prisma.paymentOrder.count({ where: { matterId: saved.id } }),
      ).toBe(0);
      expect(create.mock.calls.length).toBe(calls);
    }
    const closed = await matter("complete");
    await prisma.matter.update({
      where: { id: closed.id },
      data: {
        stage: "closed",
        details: { fileReview: { status: "confirmed" } },
      },
    });
    const issued = await createCheckout(
      actor,
      { matterId: closed.id, kind: "service", idempotencyKey: randomUUID() },
      provider,
    );
    expect(
      (
        await prisma.paymentOrder.findUniqueOrThrow({
          where: { id: issued.id },
        })
      ).amountCents,
    ).toBe(51500);
  });

  it("coordinator-created files snapshot the actual approved catalog and ignore supplied pricing", async () => {
    for (const [code, price, name] of [
      ["essentials", 42500, "Contract to Close"],
      ["complete", 51500, "Contract to Close + Compliance"],
    ] as const) {
      const created = await createMatter(actor, {
        title: "Synthetic coordinator pricing",
        propertyAddress: "42 Approved Catalog Road",
        side: "buyer",
        packageCode: code,
        details: {
          note: "Preserve this legitimate detail",
          serviceSnapshot: {
            code,
            name: "Forged caller price",
            priceCents: 1,
            currency: "USD",
            revision: 1,
          },
        },
      });
      matters.push(created.id);
      expect(created.details).toMatchObject({
        note: "Preserve this legitimate detail",
        serviceSnapshot: {
          code,
          name,
          priceCents: price,
          currency: "USD",
          dueAtClosing: true,
          noFeeIfTerminatedBeforeClosing: true,
        },
      });
    }
  });

  it("ordinary detail edits preserve approved service snapshots and cannot inject legacy pricing", async () => {
    const created = await createMatter(actor, {
      title: "Synthetic immutable approved price",
      propertyAddress: "42 Snapshot Guard Road",
      side: "buyer",
      packageCode: "essentials",
    });
    matters.push(created.id);
    const snapshot = (created.details as { serviceSnapshot: unknown })
      .serviceSnapshot;
    const forged = {
      code: "essentials",
      name: "Forged later price",
      priceCents: 1,
      currency: "USD",
      revision: 1,
    };
    const changed = await updateMatter(actor, created.id, {
      expectedRevision: created.revision,
      details: { note: "Legitimate edit", serviceSnapshot: forged },
    });
    expect(changed.details).toMatchObject({
      note: "Legitimate edit",
      serviceSnapshot: snapshot,
    });
    expect(
      (changed.details as { serviceSnapshot: unknown }).serviceSnapshot,
    ).toEqual(snapshot);
    const legacy = await matter("essentials");
    const updated = await updateMatter(actor, legacy.id, {
      expectedRevision: legacy.revision,
      details: { note: "Legacy notes stay editable", serviceSnapshot: forged },
    });
    expect(updated.details).not.toHaveProperty("serviceSnapshot");
    const order = await createCheckout(
      actor,
      { matterId: legacy.id, kind: "service", idempotencyKey: randomUUID() },
      provider,
    );
    expect(
      await prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.id } }),
    ).toMatchObject({
      amountCents: 42500,
      snapshot: {
        code: "essentials",
        name: "Contract to Close",
        priceCents: 42500,
      },
    });
  });
});
