import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import { applyReviewedFacts } from "@weatherly/matters";
import {
  processReview,
  approveReview,
  resolveReviewConflicts,
  rejectReview,
} from "../src/service";
import { timingFindings, timingRule } from "../src/findings";
import type { generateStructured } from "../src/gateway";
const suffix = randomUUID(),
  matterIds: string[] = [];
const owner: Principal = {
  id: "conflict-owner-" + suffix,
  name: "Synthetic reviewer",
  email: suffix + "@example.test",
  role: "coordinator",
  sessionId: suffix,
};
const ruleQuote = "Inspection is due five calendar days after Effective date.";
const anchorQuote = "Effective date is November 1, 2026.";
const text =
  "Buyer is Contract Buyer. Property is 22 Contract Rd. Price is $500,000. Closing is November 30, 2026. Amendment says closing is December 5, 2026. " +
  anchorQuote +
  " " +
  ruleQuote;
const rule = timingRule.parse({
  label: "Inspection",
  anchorLabel: "Effective date",
  offsetDays: 5,
  dayType: "calendar",
  sourceQuote: ruleQuote,
  page: 1,
  anchorDate: "2026-11-01",
  anchorSourceQuote: anchorQuote,
  anchorPage: 1,
  confidence: "high",
  uncertainty: "",
});
const fake: typeof generateStructured = async <T>(
  input: Parameters<typeof generateStructured<T>>[0],
) => ({
  data: input.schema.parse({
    summary: "Conflicting source evidence for Ireland",
    facts: [
      {
        field: "buyer_name",
        value: "Contract Buyer",
        sourceQuote: "Buyer is Contract Buyer.",
        page: 1,
        confidence: "high",
      },
      {
        field: "property_address",
        value: "22 Contract Rd",
        sourceQuote: "Property is 22 Contract Rd.",
        page: 1,
        confidence: "high",
      },
      {
        field: "purchase_price",
        value: "$500,000",
        sourceQuote: "Price is $500,000.",
        page: 1,
        confidence: "high",
      },
    ],
    deadlines: [
      {
        label: "Closing",
        date: "2026-11-30",
        sourceQuote: "Closing is November 30, 2026.",
        page: 1,
        confidence: "high",
        uncertainty: "",
      },
      {
        label: "Closing",
        date: "2026-12-05",
        sourceQuote: "Amendment says closing is December 5, 2026.",
        page: 1,
        confidence: "high",
        uncertainty: "",
      },
    ],
    timingRules: [rule],
    warnings: [],
  }),
  model: "synthetic/contract-model",
  provider: "synthetic-provider",
  usage: { promptTokens: 1, completionTokens: 1, costUsd: null },
});
beforeAll(async () => {
  await prisma.user.create({
    data: {
      id: owner.id,
      name: owner.name,
      email: owner.email,
      role: "coordinator",
    },
  });
  process.env.OPENROUTER_API_KEY = "synthetic-never-used";
  process.env.OPENROUTER_MODEL = "synthetic/contract-model";
  process.env.OPENROUTER_APPROVED_PROVIDERS = "synthetic-provider";
  process.env.OPENROUTER_ZDR_APPROVED = "true";
  process.env.OPENROUTER_ACCOUNT_PRIVACY_VERIFIED = "true";
});
afterAll(async () => {
  await prisma.aIProposal.deleteMany({
    where: { matterId: { in: matterIds } },
  });
  await prisma.matter.deleteMany({ where: { id: { in: matterIds } } });
  await prisma.auditEvent.deleteMany({ where: { actorId: owner.id } });
  await prisma.user.delete({ where: { id: owner.id } });
  await prisma.$disconnect();
});
describe("quoted timing rules and explicit source conflict decisions", () => {
  it("calculates only explicitly quoted contract counts and anchors, never standard offsets or guessed calendars", () => {
    expect(timingFindings([rule], text, "doc", "version")[0]).toMatchObject({
      proposedDate: "2026-11-06",
      requiresApproval: true,
      sourceQuote: ruleQuote,
      anchorSourceQuote: anchorQuote,
    });
    for (const patch of [
      { offsetDays: 9 },
      { anchorDate: "2026-11-02" },
      { dayType: "unclear" as const },
      { dayType: "business" as const, businessCalendarQuote: "" },
      { sourceQuote: "Inspection is due after Effective date." },
    ])
      expect(
        timingFindings(
          [{ ...rule, ...patch }],
          text + " Inspection is due after Effective date.",
          "doc",
          "version",
        )[0].proposedDate,
      ).toBeNull();
  });
  it("calculates business days only when the quoted definition matches the implemented weekend exclusion", () => {
    const sourceQuote =
      "Inspection is due one business day after Effective date.";
    const anchorSourceQuote = "Effective date is November 6, 2026.";
    for (const [definition, expected] of [
      ["Business days exclude Saturday and Sunday.", "2026-11-09"],
      ["Business days mean Monday through Friday.", "2026-11-09"],
      ["Business days include Saturday but exclude Sunday.", null],
      ["Business days do not exclude Saturday and Sunday.", null],
      ["Business days exclude Saturday.", null],
      ["Business days exclude Friday, Saturday and Sunday.", null],
      ["Business days exclude Saturday and Sunday and federal holidays.", null],
    ] as const) {
      const finding = timingFindings(
        [
          {
            ...rule,
            offsetDays: 1,
            dayType: "business",
            sourceQuote,
            anchorDate: "2026-11-06",
            anchorSourceQuote,
            businessCalendarQuote: definition,
          },
        ],
        [sourceQuote, anchorSourceQuote, definition].join(" "),
        "doc",
        "version",
      )[0];
      expect(finding.proposedDate, definition).toBe(expected);
      expect(finding.businessCalendarQuote).toBe(definition);
      expect(finding.requiresApproval).toBe(true);
    }
  });
  it("flags contract/intake names, property and price plus conflicting dates; blocks silent application and saves explicit corrections with evidence history", async () => {
    const matter = await prisma.matter.create({
      data: {
        title: "Synthetic conflict",
        propertyAddress: "11 Intake Ln",
        side: "buyer",
        packageCode: "complete",
        details: {
          clients: [{ name: "Intake Buyer" }],
          purchasePrice: "450000",
          confirmedFacts: { financing: "cash" },
        },
      },
    });
    matterIds.push(matter.id);
    const document = await prisma.document.create({
      data: {
        matterId: matter.id,
        name: "synthetic-contract.pdf",
        mimeType: "application/pdf",
        visibility: "coordinator",
        createdById: owner.id,
        versions: {
          create: {
            version: 1,
            objectKey: "synthetic-source",
            checksum: "a".repeat(64),
            size: text.length,
            extractedText: text,
            pages: [{ page: 1, text }],
            processingStatus: "complete",
          },
        },
      },
      include: { versions: true },
    });
    const proposal = await prisma.aIProposal.create({
      data: {
        matterId: matter.id,
        kind: "contract",
        status: "queued",
        result: {},
        sourceRefs: [
          {
            documentId: document.id,
            versionId: document.versions[0].id,
            checksum: document.versions[0].checksum,
          },
        ],
        sourceRevision: matter.revision,
        requestedById: owner.id,
      },
    });
    await processReview(proposal.id, { generate: fake });
    const pending = await prisma.aIProposal.findUniqueOrThrow({
      where: { id: proposal.id },
    });
    const result = pending.result as {
      conflicts: { key: string }[];
      timingRules: { proposedDate: string }[];
    };
    expect(result.conflicts.map((c) => c.key).sort()).toEqual([
      "deadline:closing",
      "fact:buyer_name",
      "fact:property_address",
      "fact:purchase_price",
    ]);
    expect(result.timingRules[0].proposedDate).toBe("2026-11-06");
    const stored = await prisma.matter.findUniqueOrThrow({
      where: { id: matter.id },
    });
    expect(stored.details).toMatchObject({
      sourceConflicts: expect.arrayContaining([
        expect.objectContaining({
          key: "fact:buyer_name",
          proposalId: proposal.id,
        }),
      ]),
      confirmedFacts: { financing: "cash" },
    });
    expect(stored.propertyAddress).toBe("11 Intake Ln");
    const changes = {
      deadlines: [
        {
          label: "Closing",
          date: "2026-12-05",
          sourceDocumentId: document.id,
          sourceQuote: "Amendment says closing is December 5, 2026.",
        },
      ],
    };
    await expect(
      approveReview(owner, proposal.id, {
        revision: pending.sourceRevision,
        changes,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONFLICT_REVIEW_REQUIRED" });
    await expect(
      rejectReview(owner, proposal.id, "Generic rejection"),
    ).rejects.toMatchObject({ code: "SOURCE_CONFLICT_REVIEW_REQUIRED" });
    await expect(
      applyReviewedFacts(owner, matter.id, {
        expectedRevision: stored.revision,
        facts: { buyer_name: "Silent choice" },
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONFLICT_REVIEW_REQUIRED" });
    const resolutions = [
      {
        key: "deadline:closing",
        value: "2026-12-05",
        reason: "Ireland reviewed the signed amendment",
      },
      {
        key: "fact:buyer_name",
        value: "Contract Buyer",
        reason: "Corrected against signed contract",
      },
      {
        key: "fact:property_address",
        value: "22 Contract Rd",
        reason: "Corrected against signed contract",
      },
      {
        key: "fact:purchase_price",
        value: "$500,000",
        reason: "Corrected against signed contract",
      },
    ];
    const approved = await approveReview(owner, proposal.id, {
      revision: pending.sourceRevision,
      changes: {
        ...changes,
        conflictResolutions: resolutions,
        facts: [
          {
            field: "inspection_period",
            value: "five calendar days",
            sourceDocumentId: document.id,
            sourceQuote: ruleQuote,
          },
        ],
      },
    });
    expect(approved.status).toBe("approved");
    expect(approved.result).toMatchObject({ conflictResolutions: resolutions });
    expect(
      (await prisma.matter.findUniqueOrThrow({ where: { id: matter.id } }))
        .details,
    ).toMatchObject({
      sourceConflicts: [],
      confirmedFacts: {
        buyer_name: "Contract Buyer",
        property_address: "22 Contract Rd",
        purchase_price: "$500,000",
        financing: "cash",
        inspection_period: "five calendar days",
      },
    });
    expect(
      await prisma.deadline.findFirst({
        where: { matterId: matter.id, label: "Closing" },
      }),
    ).toMatchObject({ date: "2026-12-05", status: "confirmed" });
    await expect(
      approveReview({ ...owner, role: "agent" }, proposal.id, {
        revision: pending.sourceRevision,
        changes,
      }),
    ).rejects.toMatchObject({ status: 403 });
    const current = await prisma.matter.findUniqueOrThrow({
      where: { id: matter.id },
    });
    const stale = await prisma.aIProposal.create({
      data: {
        matterId: matter.id,
        kind: "contract",
        status: "queued",
        result: {},
        sourceRefs: [
          {
            documentId: document.id,
            versionId: document.versions[0].id,
            checksum: document.versions[0].checksum,
          },
        ],
        sourceRevision: current.revision,
        requestedById: owner.id,
      },
    });
    await processReview(stale.id, { generate: fake });
    const stalePending = await prisma.aIProposal.findUniqueOrThrow({
      where: { id: stale.id },
    });
    const newer = await prisma.documentVersion.create({
      data: {
        documentId: document.id,
        version: 2,
        objectKey: "synthetic-new-version-" + suffix,
        checksum: "b".repeat(64),
        size: 100,
        extractedText: "Closing is now December 10, 2026.",
        processingStatus: "complete",
      },
    });
    await expect(
      approveReview(owner, stale.id, {
        revision: stalePending.sourceRevision,
        changes: {
          ...changes,
          conflictResolutions: [
            {
              key: "deadline:closing",
              value: "2026-12-05",
              reason: "Old proposal",
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    const manuallyResolved = await resolveReviewConflicts(owner, stale.id, {
      expectedRevision: stalePending.sourceRevision,
      conflictResolutions: [
        {
          key: "deadline:closing",
          value: "2026-12-10",
          reason:
            "Ireland corrected the date after reviewing the newer signed source",
        },
      ],
    });
    expect(manuallyResolved).toMatchObject({
      status: "resolved",
      result: {
        manualConflictResolution: true,
        manualResolutionSources: [{ versionId: newer.id }],
      },
    });
    expect(
      (await prisma.matter.findUniqueOrThrow({ where: { id: matter.id } }))
        .details,
    ).toMatchObject({ sourceConflicts: [] });
    expect(
      await prisma.deadline.findFirst({
        where: { matterId: matter.id, label: "Closing" },
      }),
    ).toMatchObject({
      date: "2026-12-10",
      status: "confirmed",
      details: { manualOverride: true, resolutionSourceVersionIds: [newer.id] },
    });
  });
});
