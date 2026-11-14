import { beforeEach, expect, it, vi } from "vitest";
import type { Principal } from "@weatherly/platform";

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
  communicationTemplate: { findUnique: vi.fn(), create: vi.fn() },
}));
vi.mock("@weatherly/db", () => ({ prisma: db }));
vi.mock("@weatherly/matters", () => ({
  requireMatter: vi.fn(async () => ({
    id: "matter",
    side: "buyer",
    packageCode: "essentials",
    checklistVersion: 1,
  })),
  audit: vi.fn(),
  revision: { parse: (value: unknown) => value },
}));
vi.mock("../src/merge-fields", () => ({
  mergeFields: vi.fn(async () => [
    { key: "propertyAddress", value: "1 Saved Lane" },
  ]),
}));
vi.mock("../src/email-work", () => ({ ensureTemplateWork: vi.fn() }));

import {
  customMergeFieldInput,
  listCustomMergeFields,
  saveCustomMergeField,
} from "../src/custom-merge-fields";
import { renderInDb } from "../src/templates";
import { validateMerge } from "../src/policy";

const actor: Principal = {
  id: "owner",
  role: "coordinator",
  name: "Ireland",
  email: "synthetic@example.test",
  sessionId: "session",
};
const field = {
  key: "custom_instructions",
  label: "Instructions",
  defaultValue: "Bring your ID.",
  revision: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (run) => run(db));
  db.$queryRaw.mockResolvedValue([field]);
  db.communicationTemplate.findUnique.mockResolvedValue({
    id: "template",
    active: true,
    side: "buyer",
    revision: 1,
    subject: "Closing at {{propertyAddress}}",
    body: "{{custom_instructions}}",
  });
});

it("reserves a custom namespace and rejects malformed or oversized definitions", () => {
  for (const key of [
    "propertyAddress",
    "custom_",
    "custom_Upper",
    "custom_bad-key",
    "__proto__",
  ])
    expect(
      customMergeFieldInput.safeParse({ label: field.label, key }).success,
    ).toBe(false);
  expect(
    customMergeFieldInput.safeParse({
      key: field.key,
      label: field.label,
      defaultValue: "x".repeat(2001),
    }).success,
  ).toBe(false);
  expect(
    customMergeFieldInput.parse({ key: field.key, label: " Instructions " })
      .label,
  ).toBe("Instructions");
});

it("requires coordinator access before reading or saving custom fields", async () => {
  for (const role of ["agent", "client"] as const) {
    await expect(
      listCustomMergeFields({ ...actor, role }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      saveCustomMergeField(
        { ...actor, role },
        { key: field.key, label: field.label },
      ),
    ).rejects.toMatchObject({ status: 403 });
  }
  expect(db.$queryRaw).not.toHaveBeenCalled();
});

it("does not overwrite duplicate keys or stale field edits", async () => {
  db.$queryRaw.mockResolvedValue([]);
  await expect(
    saveCustomMergeField(actor, { key: field.key, label: field.label }),
  ).rejects.toMatchObject({ code: "MERGE_FIELD_EXISTS" });
  await expect(
    saveCustomMergeField(
      actor,
      { label: field.label, expectedRevision: 1 },
      field.key,
    ),
  ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
});

it("fills saved defaults, allows per-email custom values, and protects transaction facts", async () => {
  const defaultRender = await renderInDb(
    actor,
    "template",
    { matterId: "matter" },
    db as never,
  );
  expect(defaultRender.body).toBe("Bring your ID.");
  const override = await renderInDb(
    actor,
    "template",
    {
      matterId: "matter",
      values: {
        custom_instructions: "Bring two IDs.",
        propertyAddress: "Wrong address",
      },
    },
    db as never,
  );
  expect(override.body).toBe("Bring two IDs.");
  expect(override.subject).toBe("Closing at 1 Saved Lane");
  const cleared = await renderInDb(
    actor,
    "template",
    { matterId: "matter", values: { custom_instructions: "" } },
    db as never,
  );
  expect(cleared.missingBodyFields).toContain(field.key);
});

it("rejects unknown custom tokens and reports missing custom values for review", async () => {
  expect(() => validateMerge("{{custom_not_saved}}")).toThrow();
  expect(() =>
    validateMerge("{{custom_instructions}}", new Set([field.key])),
  ).not.toThrow();
  db.$queryRaw.mockResolvedValue([{ ...field, defaultValue: "" }]);
  const rendered = await renderInDb(
    actor,
    "template",
    { matterId: "matter" },
    db as never,
  );
  expect(rendered.body).toBe("");
  expect(rendered.missingFields).toContain(field.key);
});
