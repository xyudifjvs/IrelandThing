import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { ZodError } from "zod";
import { prisma, type Prisma } from "@weatherly/db";
import {
  hashToken,
  HttpError,
  sanitizeError,
  type Principal,
} from "@weatherly/platform";
import { sessionMiddleware } from "../../packages/identity/src/index";
import { createBillingRouter } from "../../packages/billing/src/http";
import {
  listAccountPayments,
  listAccountTransactions,
  resumeAccountPayment,
} from "../../packages/billing/src/account";
import { createMcpRouter } from "../../packages/assistant/src/mcp";
import * as React from "react";
import { createElement, type ComponentType } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";
import * as icons from "lucide-react";
import * as weatherlyUi from "@weatherly/ui";
import * as dataModule from "../../apps/web/app/(workspace)/workspace/_components/data";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const ui = {
  responses: {} as Record<string, unknown>,
  paths: [] as string[],
  fallback: {
    data: null,
    loading: false,
    error: "",
    refresh: async () => {},
  } as Record<string, unknown>,
};
const dataAdapter = {
  ...dataModule,
  useData: (path: string) => {
    ui.paths.push(path);
    return ui.responses[path] || ui.fallback;
  },
  mutate: vi.fn(),
};
// The Next app intentionally preserves JSX in its nearest tsconfig. Compile
// the actual view source for Node without changing that application setting.
// Real React renders these views; only network data and stylesheet names differ.
function loadView(path: string, history?: unknown) {
  const compiled = ts.transpileModule(readFileSync(resolve(path), "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", compiled.outputText)((name: string) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "next/link") return { __esModule: true, default: Link };
    if (name === "lucide-react") return icons;
    if (name === "@weatherly/ui") return weatherlyUi;
    if (name.endsWith("/_components/data")) return dataAdapter;
    if (name === "./AccountHistory") return history;
    if (name.endsWith(".module.css"))
      return {
        __esModule: true,
        default: new Proxy({}, { get: (_target, key) => String(key) }),
      };
    throw new Error(`Unexpected account view dependency ${name}`);
  }, exports);
  return exports;
}
const historyViews = loadView(
  "apps/web/app/(account)/account/AccountHistory.tsx",
);
const PaymentHistory = historyViews.PaymentHistory as ComponentType<{
  coordinator: boolean;
}>;
const TransactionHistory = historyViews.TransactionHistory as ComponentType<{
  coordinator: boolean;
}>;
const AccountPage = loadView(
  "apps/web/app/(account)/account/page.tsx",
  historyViews,
).default as ComponentType;

// This independent suite deliberately exceeds the old 200-row list cap. Vitest's
// configuration refuses non-local databases and database names without _test.
const prefix = `account-check-${randomUUID()}`;
const stages = [
  "listing",
  "under_contract",
  "closing",
  "closed",
  "terminated",
  "archived",
] as const;
const actors = Object.fromEntries(
  ["owner", "agent", "other", "client", "empty", "revoked"].map((name) => [
    name,
    {
      id: `${prefix}-${name}`,
      name: `Synthetic ${name}`,
      email: `${prefix}-${name}@example.test`,
      role:
        name === "owner"
          ? "coordinator"
          : name === "client"
            ? "client"
            : "agent",
      sessionId: `${prefix}-session`,
    },
  ]),
) as Record<
  "owner" | "agent" | "other" | "client" | "empty" | "revoked",
  Principal
>;
const mid = (n: string | number) =>
  `${prefix}-matter-${String(n).padStart(3, "0")}`;
const pid = (n: string | number) =>
  `${prefix}-payment-${String(n).padStart(3, "0")}`;
const ownedIds = Array.from({ length: 211 }, (_, n) => mid(n));
const allowedIds = [...ownedIds, mid("delegated")];
const savedEnv = Object.fromEntries(
  [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_ACCOUNT_ID",
    "STRIPE_ACCOUNT_OWNER",
    "STRIPE_MODE",
    "MCP_ENABLED",
    "MCP_APPROVED_CLIENTS_JSON",
  ].map((k) => [k, process.env[k]]),
);

function errors(app: express.Express) {
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
        .json(
          error instanceof ZodError
            ? { error: { code: "INVALID_INPUT" } }
            : sanitizeError(error),
        );
    },
  );
}
function app() {
  const result = express();
  result.use(express.json());
  // Session authentication is substituted; persisted role, revocation and agent
  // agreement/override checks still run through the production middleware.
  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const actor = Object.values(actors).find(
          (a) => a.id === headers.get("synthetic-session"),
        );
        return actor
          ? { user: { id: actor.id }, session: { id: actor.sessionId } }
          : null;
      },
    },
  } as unknown as Parameters<typeof sessionMiddleware>[0];
  result.use("/api/v1", sessionMiddleware(auth));
  result.use("/api/v1/billing", createBillingRouter());
  errors(result);
  return result;
}
function get(path: string, actor = actors.agent) {
  return request(app())
    .get(`/api/v1/billing/account/${path}`)
    .set("synthetic-session", actor.id);
}
function payment(
  name: string | number,
  data: Partial<Prisma.PaymentOrderCreateManyInput> = {},
): Prisma.PaymentOrderCreateManyInput {
  return {
    id: pid(name),
    matterId: ownedIds[0],
    createdById: actors.owner.id,
    idempotencyKey: pid(name),
    amountCents: 100,
    currency: "USD",
    status: "pending",
    kind: "service",
    snapshot: { name: "Synthetic service", secret: "PRIVATE-SNAPSHOT" },
    details: {
      paymentEnvironment: "test",
      secret: "PRIVATE-PROVIDER",
      refundRequests: [{ reason: "PRIVATE-REFUND-REASON" }],
    },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...data,
  };
}
beforeAll(async () => {
  for (const name of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_ACCOUNT_ID",
    "STRIPE_ACCOUNT_OWNER",
  ])
    delete process.env[name];
  process.env.STRIPE_MODE = "test";
  await prisma.user.createMany({
    data: Object.values(actors).map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      role: a.role,
      twoFactorEnabled: true,
    })),
  });
  await prisma.auditEvent.createMany({
    data: Object.values(actors)
      .filter((a) => a.role === "agent")
      .map((a) => ({
        actorId: actors.owner.id,
        entityId: a.id,
        entityType: "User",
        action: "agent.access_override",
      })),
  });
  await prisma.auditEvent.create({
    data: {
      actorId: actors.owner.id,
      entityId: actors.revoked.id,
      entityType: "User",
      action: "identity.access_revoked",
    },
  });
  await prisma.matter.createMany({
    data: [
      ...ownedIds.map((id, n) => ({
        id,
        title: `Account synthetic ${String(n).padStart(3, "0")}`,
        propertyAddress: `${n} Synthetic History Lane`,
        side: n % 2 ? "seller" : "buyer",
        packageCode: "essentials",
        stage: stages[n % stages.length],
        agentId: actors.agent.id,
        details: { secret: "PRIVATE-INTAKE" },
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, Math.floor(n / 3))),
        updatedAt: new Date(Date.UTC(2026, 1, 1, 0, 0, 211 - n)),
      })),
      ...["delegated", "foreign", "revoked", "revoked-user"].map((n) => ({
        id: mid(n),
        title: `Synthetic ${n}`,
        propertyAddress: `Synthetic ${n} address`,
        side: "buyer",
        packageCode: "essentials",
        stage: "archived",
        agentId: n === "revoked-user" ? actors.revoked.id : actors.other.id,
        details: { secret: "PRIVATE-INTAKE" },
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      })),
    ],
  });
  await prisma.matterParticipant.createMany({
    data: [
      { matterId: mid("delegated"), userId: actors.agent.id, role: "agent" },
      {
        matterId: mid("revoked"),
        userId: actors.agent.id,
        role: "agent",
        revokedAt: new Date(),
      },
      { matterId: ownedIds[0], userId: actors.client.id, role: "client" },
    ],
  });
  await prisma.paymentOrder.createMany({
    data: [
      ...Array.from({ length: 205 }, (_, n) =>
        payment(n, n === 1 ? { stripeSessionId: `${pid(n)}-session` } : {}),
      ),
      payment("paid", { status: "paid", amountCents: 37500 }),
      payment("partial", {
        status: "partially_refunded",
        amountCents: 47500,
        details: { paymentEnvironment: "test", refundedCents: 1000 },
      }),
      payment("refunded", {
        status: "refunded",
        amountCents: 62500,
        details: { paymentEnvironment: "test", refundedCents: 62500 },
      }),
      payment("disputed", { status: "disputed", amountCents: 9000 }),
      payment("legacy-partial", {
        status: "partially_refunded",
        amountCents: 5000,
      }),
      payment("live-cad", {
        status: "paid",
        amountCents: 20000,
        currency: "CAD",
        details: { paymentEnvironment: "live" },
      }),
      payment("unknown", {
        status: "paid",
        amountCents: 3000,
        details: { private: "PRIVATE-PROVIDER" },
      }),
      payment("creating", { status: "creating", amountCents: 1200 }),
      payment("failed", { status: "failed", amountCents: 4444 }),
      payment("expired", { status: "expired", amountCents: 5555 }),
      payment("redirect", {
        amountCents: 47500,
        details: {
          paymentEnvironment: "test",
          checkoutSuccess: true,
          redirect: "success",
          payment_status: "paid",
        },
      }),
      payment("foreign", {
        matterId: mid("foreign"),
        status: "paid",
        amountCents: 99999999,
      }),
      payment("revoked", {
        matterId: mid("revoked"),
        status: "paid",
        amountCents: 88888888,
      }),
      payment("delegated", { matterId: mid("delegated") }),
    ],
  });
}, 30000);
afterAll(async () => {
  vi.restoreAllMocks();
  await prisma.assistantGrant.deleteMany({
    where: { userId: actors.owner.id },
  });
  await prisma.assistantClient.deleteMany({ where: { id: prefix } });
  await prisma.paymentOrder.deleteMany({
    where: { id: { startsWith: prefix } },
  });
  await prisma.matter.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.auditEvent.deleteMany({
    where: { actorId: { in: Object.values(actors).map((a) => a.id) } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: Object.values(actors).map((a) => a.id) } },
  });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("independent account transaction history", () => {
  it("walks every authorized transaction beyond the old 200 cap exactly once, including every retained stage", async () => {
    const expected = await prisma.matter.findMany({
      where: { id: { in: allowedIds } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, stage: true },
    });
    const found: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listAccountTransactions(actors.agent, {
        limit: 37,
        cursor,
      });
      expect(page.total).toBe(212);
      expect(page.summary.total).toBe(212);
      expect(page.items.length).toBeLessThanOrEqual(37);
      found.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor || undefined;
      expect(found.length).toBeLessThanOrEqual(212);
    } while (cursor);
    expect(found).toEqual(expected.map((r) => r.id));
    expect(new Set(found).size).toBe(212);
    const first = await listAccountTransactions(actors.agent, { limit: 1 });
    for (const stage of stages)
      expect(first.summary.stages[stage]).toBe(
        expected.filter((r) => r.stage === stage).length,
      );
  });
  it("filters the complete authorized history by case-insensitive address/title, stage and side without shrinking all-history totals", async () => {
    const page = await listAccountTransactions(actors.agent, {
      q: "SYNTHETIC HISTORY LANE",
      stage: "closed",
      side: "seller",
      limit: 100,
    });
    const expected = await prisma.matter.count({
      where: { id: { in: ownedIds }, stage: "closed", side: "seller" },
    });
    expect(page.total).toBe(expected);
    expect(page.items).toHaveLength(expected);
    expect(
      page.items.every((r) => r.stage === "closed" && r.side === "seller"),
    ).toBe(true);
    expect(page.summary.total).toBe(212);
    const title = await listAccountTransactions(actors.agent, {
      q: "ACCOUNT SYNTHETIC 210",
    });
    expect(title.items.map((r) => r.id)).toEqual([mid(210)]);
  });
  it("rejects foreign and revoked cursor anchors and immediately removes revoked participant access", async () => {
    for (const cursor of [mid("foreign"), mid("revoked"), mid("missing")])
      await expect(
        listAccountTransactions(actors.agent, { cursor }),
      ).rejects.toMatchObject({ status: 404 });
    await prisma.matterParticipant.update({
      where: {
        matterId_userId: {
          matterId: mid("delegated"),
          userId: actors.agent.id,
        },
      },
      data: { revokedAt: new Date() },
    });
    try {
      const page = await listAccountTransactions(actors.agent);
      expect(page.total).toBe(211);
      await expect(
        listAccountTransactions(actors.agent, { cursor: mid("delegated") }),
      ).rejects.toMatchObject({ status: 404 });
      expect((await listAccountPayments(actors.agent)).total).toBe(216);
    } finally {
      await prisma.matterParticipant.update({
        where: {
          matterId_userId: {
            matterId: mid("delegated"),
            userId: actors.agent.id,
          },
        },
        data: { revokedAt: null },
      });
    }
  });
  it("uses narrow projections, exposes honest empty results, and rejects invalid filters instead of accepting arbitrary statuses", async () => {
    const full = await listAccountTransactions(actors.agent);
    expect(JSON.stringify(full)).not.toMatch(
      /PRIVATE-|details|agentId|participants|tasks|notes/,
    );
    const empty = await listAccountTransactions(actors.empty);
    expect(empty).toMatchObject({
      items: [],
      total: 0,
      nextCursor: null,
      summary: { total: 0 },
    });
    expect(
      (
        await listAccountTransactions(actors.agent, {
          q: "no synthetic match exists",
        })
      ).items,
    ).toEqual([]);
    for (const query of [
      { limit: 101 },
      { limit: 0 },
      { stage: "cancelled" },
      { side: "both" },
    ])
      await expect(
        listAccountTransactions(actors.agent, query as never),
      ).rejects.toBeInstanceOf(ZodError);
  });
});

describe("independent persisted account payments", () => {
  it("walks all authorized payments beyond 200 exactly once with complete summary counts", async () => {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listAccountPayments(actors.agent, {
        limit: 29,
        cursor,
      });
      expect(page.total).toBe(217);
      expect(page.summary.total).toBe(217);
      ids.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor || undefined;
      expect(ids.length).toBeLessThanOrEqual(217);
    } while (cursor);
    expect(new Set(ids).size).toBe(217);
    expect(ids).not.toContain(pid("foreign"));
    expect(ids).not.toContain(pid("revoked"));
    const expected = await prisma.paymentOrder.findMany({
      where: { matterId: { in: allowedIds } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    expect(ids).toEqual(expected.map((r) => r.id));
  });
  it("keeps currencies and test/live/unknown evidence separate and never treats a redirect as paid", async () => {
    const result = await listAccountPayments(actors.agent, { limit: 100 });
    const usd = result.summary.currencies.find(
      (r) => r.environment === "test" && r.currency === "USD",
    )!;
    expect(usd).toMatchObject({
      paidCents: 84000,
      pendingCents: 69300,
      refundedCents: 63500,
      disputedCents: 9000,
      unknownRefundCount: 1,
    });
    expect(
      result.summary.currencies.find(
        (r) => r.environment === "live" && r.currency === "CAD",
      ),
    ).toMatchObject({ paidCents: 20000 });
    expect(
      result.summary.currencies.find(
        (r) => r.environment === "unknown" && r.currency === "USD",
      ),
    ).toMatchObject({ paidCents: 3000 });
    const redirect = await listAccountPayments(actors.agent, {
      q: "Synthetic History Lane",
      status: "pending",
      limit: 100,
    });
    expect(redirect.items.find((r) => r.id === pid("redirect"))?.status).toBe(
      "pending",
    );
    expect(result.provider).toMatchObject({
      configured: false,
      environment: "test",
    });
  });
  it("filters all payment rows while preserving complete, unfiltered summary totals and hides implementation/provider fields", async () => {
    const live = await listAccountPayments(actors.agent, {
      environment: "live",
      status: "paid",
      q: "SYNTHETIC",
      limit: 100,
    });
    expect(live.total).toBe(1);
    expect(live.items.map((r) => r.id)).toEqual([pid("live-cad")]);
    expect(live.summary.total).toBe(217);
    expect(JSON.stringify(live)).not.toMatch(
      /PRIVATE-|snapshot|stripeSessionId|stripePaymentIntentId|idempotencyKey|createdById|refundRequests/,
    );
    const none = await listAccountPayments(actors.empty);
    expect(none).toMatchObject({
      items: [],
      total: 0,
      nextCursor: null,
      summary: { total: 0, currencies: [] },
      provider: { configured: false },
    });
    for (const cursor of [pid("foreign"), pid("revoked"), pid("missing")])
      await expect(
        listAccountPayments(actors.agent, { cursor }),
      ).rejects.toMatchObject({ status: 404 });
  });
  it("denies checkout retrieval across permission boundaries and makes no provider call while unconfigured", async () => {
    const provider = vi.fn();
    for (const id of [pid("foreign"), pid("revoked")])
      await expect(
        resumeAccountPayment(actors.agent, id, provider),
      ).rejects.toMatchObject({ status: 404 });
    expect(provider).not.toHaveBeenCalled();
    await expect(
      resumeAccountPayment(actors.client, pid("paid"), provider),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      resumeAccountPayment(actors.agent, pid(1)),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("keeps unsettled refund reservations distinct and treats invalid legacy refund amounts as unknown", async () => {
    const temporary = [
      payment("reserved-check", {
        status: "paid",
        amountCents: 12000,
        details: {
          paymentEnvironment: "test",
          refundRequests: [
            { status: "reserved", amountCents: 2000, reason: "PRIVATE-REASON" },
            { status: "succeeded", amountCents: 1000, accounted: false },
            { status: "succeeded", amountCents: 1500, accounted: true },
            { status: "failed", amountCents: 9000 },
            { status: "canceled", amountCents: 9000 },
          ],
        },
      }),
      ...[-1, 999999, "1000"].map((value, n) =>
        payment(`invalid-refund-${n}`, {
          status: "partially_refunded",
          amountCents: 47500,
          details: { paymentEnvironment: "test", refundedCents: value },
        }),
      ),
    ];
    await prisma.paymentOrder.createMany({ data: temporary });
    try {
      const result = await listAccountPayments(actors.agent, {
        limit: 100,
        q: "reserved-check",
      });
      expect(result.items[0]).toMatchObject({
        status: "paid",
        refundedCents: 0,
        pendingRefundCents: 3000,
      });
      const usd = result.summary.currencies.find(
        (r) => r.environment === "test" && r.currency === "USD",
      )!;
      expect(usd).toMatchObject({
        paidCents: 96000,
        refundedCents: 63500,
        pendingRefundCents: 3000,
        unknownRefundCount: 4,
      });
      const invalid = await listAccountPayments(actors.agent, {
        q: "invalid-refund",
        limit: 100,
      });
      expect(invalid.items).toHaveLength(3);
      expect(invalid.items.every((r) => r.refundedCents === null)).toBe(true);
      expect(JSON.stringify(result)).not.toContain("PRIVATE-");
    } finally {
      await prisma.paymentOrder.deleteMany({
        where: { id: { in: temporary.map((r) => r.id!) } },
      });
    }
  });

  it("resumes only matching open provider checkouts, never creates an order, and rechecks races", async () => {
    const base = {
      id: `${pid(1)}-session`,
      metadata: { paymentOrderId: pid(1) },
      livemode: false,
      amount_total: 100,
      currency: "usd",
      status: "open",
      url: "https://checkout.stripe.com/c/pay/synthetic-only",
    };
    let evidence: typeof base = { ...base };
    const retrieve = vi.fn(async () => evidence);
    const provider = vi.fn(
      async () => ({ checkout: { sessions: { retrieve } } }) as never,
    );
    const before = await prisma.paymentOrder.count({
      where: { id: { startsWith: prefix } },
    });
    expect(
      await resumeAccountPayment(actors.agent, pid(1), provider),
    ).toMatchObject({ id: pid(1), status: "pending", url: base.url });
    expect(retrieve).toHaveBeenCalledWith(base.id);
    expect(
      await prisma.paymentOrder.count({
        where: { id: { startsWith: prefix } },
      }),
    ).toBe(before);
    expect(
      (await prisma.paymentOrder.findUniqueOrThrow({ where: { id: pid(1) } }))
        .status,
    ).toBe("pending");
    for (const change of [
      { id: "foreign-session" },
      { metadata: { paymentOrderId: pid("foreign") } },
      { livemode: true },
      { amount_total: 101 },
      { currency: "cad" },
      { status: "complete" },
      { url: "http://checkout.stripe.com/c/pay/unsafe" },
      { url: "https://checkout.stripe.com.evil.test/c/pay/unsafe" },
    ]) {
      evidence = { ...base, ...change };
      await expect(
        resumeAccountPayment(actors.agent, pid(1), provider),
      ).rejects.toMatchObject({ status: 409 });
    }
    evidence = { ...base };
    retrieve.mockImplementationOnce(async () => {
      await prisma.paymentOrder.update({
        where: { id: pid(1) },
        data: { status: "paid" },
      });
      return evidence;
    });
    try {
      await expect(
        resumeAccountPayment(actors.agent, pid(1), provider),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      await prisma.paymentOrder.update({
        where: { id: pid(1) },
        data: { status: "pending" },
      });
    }
    const delegated = payment("resume-delegated", {
      matterId: mid("delegated"),
      stripeSessionId: `${pid("resume-delegated")}-session`,
    });
    await prisma.paymentOrder.create({ data: delegated });
    retrieve.mockImplementationOnce(async () => {
      await prisma.matterParticipant.update({
        where: {
          matterId_userId: {
            matterId: mid("delegated"),
            userId: actors.agent.id,
          },
        },
        data: { revokedAt: new Date() },
      });
      return {
        ...base,
        id: delegated.stripeSessionId!,
        metadata: { paymentOrderId: delegated.id! },
      };
    });
    try {
      await expect(
        resumeAccountPayment(actors.agent, delegated.id!, provider),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      await prisma.matterParticipant.update({
        where: {
          matterId_userId: {
            matterId: mid("delegated"),
            userId: actors.agent.id,
          },
        },
        data: { revokedAt: null },
      });
      await prisma.paymentOrder.delete({ where: { id: delegated.id } });
    }
  });
});

describe("independent account HTTP and MCP boundaries", () => {
  it("requires sessions, current access, agreement eligibility and a financial role", async () => {
    for (const path of ["transactions", "payments"]) {
      await request(app()).get(`/api/v1/billing/account/${path}`).expect(401);
      await get(path, actors.client).expect(403);
      await get(path, actors.revoked).expect(403);
      const ok = await get(path).query({ limit: 100 }).expect(200);
      expect(ok.body.total).toBe(path === "transactions" ? 212 : 217);
      expect(JSON.stringify(ok.body)).not.toMatch(/PRIVATE-|99999999|88888888/);
    }
    await prisma.auditEvent.deleteMany({
      where: { entityId: actors.empty.id, action: "agent.access_override" },
    });
    await get("transactions", actors.empty).expect(403);
  });
  it("returns validation errors and sanitized failures, preserving empty and provider-unconfigured responses", async () => {
    await get("transactions").query({ limit: 101 }).expect(422);
    await get("payments").query({ environment: "production" }).expect(422);
    await get("payments").query({ status: "checkout-success" }).expect(422);
    const empty = await get("transactions")
      .query({ q: "no match anywhere" })
      .expect(200);
    expect(empty.body).toMatchObject({ items: [], total: 0 });
    const fail = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("PRIVATE-DATABASE-CREDENTIAL"));
    try {
      const response = await get("transactions").expect(500);
      expect(response.body.error.code).toBe("INTERNAL_ERROR");
      expect(JSON.stringify(response.body)).not.toContain("PRIVATE-");
    } finally {
      fail.mockRestore();
    }
  });
  it("makes read-only account history available through authenticated MCP, then rejects revoked and disabled access", async () => {
    const token = `${prefix}-mcp-token`;
    const evidence = `${prefix}: isolated synthetic acceptance fixture; no real provider approval`;
    const redirectUris = ["https://synthetic-account.example.test/callback"];
    process.env.MCP_ENABLED = "true";
    process.env.MCP_APPROVED_CLIENTS_JSON = JSON.stringify([
      { id: prefix, redirectUris, evidenceHash: hashToken(evidence) },
    ]);
    await prisma.assistantClient.create({
      data: {
        id: prefix,
        name: "Synthetic account checker",
        approved: true,
        complianceEvidence: evidence,
        approvedById: actors.owner.id,
        redirectUris,
      },
    });
    const grant = await prisma.assistantGrant.create({
      data: {
        userId: actors.owner.id,
        name: "Synthetic account read",
        tokenHash: hashToken(token),
        scopes: ["weatherly:read"],
        approvedClient: true,
        complianceEvidence: evidence,
        clientId: prefix,
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const server = express();
    server.use(express.json());
    server.use("/api/mcp", createMcpRouter());
    errors(server);
    const call = (name: string, bearer = token) =>
      request(server)
        .post("/api/mcp")
        .set("Authorization", `Bearer ${bearer}`)
        .set("Accept", "application/json, text/event-stream")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: { q: "Synthetic", limit: 100 } },
        });
    for (const name of ["list_account_transactions", "list_account_payments"]) {
      const response = await call(name).expect(200);
      expect(response.body.result.isError).not.toBe(true);
      const data = JSON.parse(response.body.result.content[0].text);
      expect(data.total).toBeGreaterThan(200);
      expect(data.nextCursor).toBeTruthy();
      expect(JSON.stringify(data)).not.toMatch(
        /PRIVATE-|snapshot|idempotencyKey/,
      );
    }
    await call("list_account_payments", "invalid-synthetic-token").expect(401);
    await prisma.assistantGrant.update({
      where: { id: grant.id },
      data: { revokedAt: new Date() },
    });
    await call("list_account_payments").expect(401);
    process.env.MCP_ENABLED = "false";
    await call("list_account_payments").expect(503);
  });
});

describe("independent account view states", () => {
  function state(data: unknown = null, loading = false, error = "") {
    ui.paths = [];
    ui.responses = {};
    ui.fallback = { data, loading, error, refresh: async () => {} };
  }
  it("announces loading and errors and offers clear recovery and honest empty states", () => {
    state(null, true);
    const loading = renderToStaticMarkup(
      createElement(TransactionHistory, { coordinator: false }),
    );
    expect(loading).toContain('role="status"');
    expect(loading).toContain("Loading your transaction history");
    state(null, false, "Synthetic connection failure");
    const failure = renderToStaticMarkup(
      createElement(PaymentHistory, { coordinator: false }),
    );
    expect(failure).toContain('role="alert"');
    expect(failure).toContain("Synthetic connection failure");
    expect(failure).toContain("Try again");
    state({
      items: [],
      total: 0,
      nextCursor: null,
      summary: { total: 0, stages: {} },
    });
    expect(
      renderToStaticMarkup(
        createElement(TransactionHistory, { coordinator: false }),
      ),
    ).toContain("No transactions yet");
    state({
      items: [],
      total: 0,
      nextCursor: null,
      summary: { total: 0, statuses: {}, currencies: [] },
      provider: { configured: false, environment: "test" },
    });
    const emptyPayments = renderToStaticMarkup(
      createElement(PaymentHistory, { coordinator: false }),
    );
    expect(emptyPayments).toContain("No payment records yet");
    expect(emptyPayments).toContain("Online payments are not available yet");
    expect(emptyPayments).not.toContain("Continue payment");
  });
  it("renders accessible table headers, complete-history counts, permitted detail links and explicit currency/mode labels", () => {
    state({
      items: [
        {
          id: "synthetic-matter",
          title: "Synthetic archived transaction",
          propertyAddress: "1 Synthetic Lane",
          side: "seller",
          stage: "archived",
          packageCode: "essentials",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-02T00:00:00Z",
        },
      ],
      total: 1,
      nextCursor: null,
      summary: { total: 212, stages: { closed: 35, archived: 36 } },
    });
    const transactions = renderToStaticMarkup(
      createElement(TransactionHistory, { coordinator: false }),
    );
    expect(transactions).toContain("<caption");
    expect(transactions).toContain('scope="col"');
    expect(transactions).toContain(
      'href="/portal/transactions/synthetic-matter"',
    );
    expect(transactions).toContain(
      'aria-label="Transaction history pagination"',
    );
    expect(transactions).toContain("212");
    state({
      items: [
        {
          id: "synthetic-payment",
          matterId: "synthetic-matter",
          matterTitle: "Synthetic",
          propertyAddress: "1 Synthetic Lane",
          kind: "service",
          description: "Synthetic service",
          amountCents: 20000,
          currency: "CAD",
          status: "paid",
          environment: "live",
          refundedCents: 0,
          pendingRefundCents: 0,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-02T00:00:00Z",
          checkoutAvailable: false,
        },
      ],
      total: 1,
      nextCursor: null,
      summary: {
        total: 217,
        statuses: { paid: 1 },
        currencies: [
          {
            environment: "live",
            currency: "CAD",
            paidCents: 20000,
            pendingCents: 0,
            refundedCents: 0,
            pendingRefundCents: 0,
            disputedCents: 0,
            unknownRefundCount: 0,
          },
        ],
      },
      provider: { configured: false, environment: "test" },
    });
    const payments = renderToStaticMarkup(
      createElement(PaymentHistory, { coordinator: false }),
    );
    expect(payments).toContain("CAD");
    expect(payments).toContain("200.00");
    expect(payments).toContain("Live payments");
    expect(payments).toContain("Payment recorded");
    expect(payments).not.toContain("Continue payment");
  });
  it("retains client profile/security while making no history or billing request", () => {
    state();
    ui.responses = {
      "/api/v1/session": {
        data: {
          user: {
            id: "synthetic-client",
            role: "client",
            name: "Synthetic client",
          },
        },
        loading: false,
        error: "",
        refresh: async () => {},
      },
      "/api/v1/profile": {
        data: {
          name: "Synthetic client",
          email: "synthetic-client@example.test",
        },
        loading: false,
        error: "",
        refresh: async () => {},
      },
    };
    const output = renderToStaticMarkup(createElement(AccountPage));
    expect(output).toContain("Your profile");
    expect(output).toContain("Account security");
    expect(output).not.toContain("All transactions");
    expect(output).not.toContain("Payment history");
    expect(
      ui.paths.some(
        (path) => path.includes("billing") || path.includes("transactions"),
      ),
    ).toBe(false);
  });
});
