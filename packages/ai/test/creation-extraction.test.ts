import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@weatherly/platform";
import { assembleCreationSources } from "../src/creation-extraction/source-bundle";
import { extractCreationProposal } from "../src/creation-extraction/extract";
import {
  creationProposalSchema,
  normalizeCreationProposal,
} from "../src/creation-extraction/proposal";
import { generateStructured } from "../src/gateway";

const offer = { documentId: "offer", versionId: "offer-version" };
const counter = { documentId: "counter", versionId: "counter-version" };
const packets = [
  {
    ...offer,
    processingStatus: "complete",
    pages: [
      {
        page: 1,
        text: "Closing November 18, 2026. Title commitment November 3, 2026.",
      },
      { page: 2, text: "Offer signed November 9." },
    ],
  },
  {
    ...counter,
    processingStatus: "complete",
    pages: [
      {
        page: 1,
        text: "Signed counteroffer. Title commitment due November 12, 2026. Purchase price $325,000.00.",
      },
    ],
  },
];

const proposal = {
  propertyAddress: null,
  purchasePriceCents: {
    value: 33000000,
    evidence: {
      versionId: counter.versionId,
      page: 1,
      quote: "Purchase price $325,000.00.",
    },
  },
  acceptance: null,
  buyers: [],
  sellers: [],
  earnestMoneyCents: null,
  earnestMoneyHolder: null,
  homeWarrantyCompany: null,
  homeWarrantyCents: null,
  titleCompany: null,
  dates: [
    {
      key: "title_commitment",
      date: { date: "2026-11-12", instant: null },
      rule: null,
      evidence: {
        versionId: counter.versionId,
        page: 1,
        quote: "Title commitment due November 12, 2026.",
      },
    },
    {
      key: "possession",
      date: { date: "2026-11-20", instant: null },
      rule: null,
      evidence: {
        versionId: counter.versionId,
        page: 1,
        quote: "Title commitment due November 12, 2026.",
      },
    },
  ],
};

describe("creation contract extraction", () => {
  it("checks the entire cited numeric token and preserves only documented clocks", () => {
    const sources = assembleCreationSources(
      [counter],
      [
        {
          ...counter,
          processingStatus: "complete",
          pages: [
            {
              page: 1,
              text: "Price $100,000. Closing 6/3/2027. Possession June 4, 2027. Walkthrough June 2, 2027 at 10:30 a.m. Eastern Time.",
            },
          ],
        },
      ],
    );
    if (!sources) throw new Error("Expected a complete synthetic packet");
    const evidence = (quote: string) => ({
      versionId: counter.versionId,
      page: 1,
      quote,
    });
    const parsed = creationProposalSchema.parse({
      ...proposal,
      purchasePriceCents: { value: 10000, evidence: evidence("Price $100") },
      earnestMoneyCents: {
        value: 10000000,
        evidence: evidence("Price $100,000"),
      },
      dates: [
        {
          key: "closing",
          date: { date: "2020-06-03", instant: null },
          rule: null,
          evidence: evidence("Closing 6/3/20"),
        },
        {
          key: "possession",
          date: { date: "2027-06-04", instant: "2027-06-04T10:30:00-04:00" },
          rule: null,
          evidence: evidence("Possession June 4, 2027."),
        },
        {
          key: "final_walkthrough",
          date: { date: "2027-06-02", instant: "2027-06-02T10:30:00-04:00" },
          rule: null,
          evidence: evidence(
            "Walkthrough June 2, 2027 at 10:30 a.m. Eastern Time.",
          ),
        },
      ],
    });
    const result = normalizeCreationProposal(parsed, sources);
    expect(result.purchasePriceCents).toBeNull();
    expect(result.earnestMoneyCents).toEqual(parsed.earnestMoneyCents);
    expect(result.dates).toEqual([
      { ...parsed.dates[1], date: { date: "2027-06-04", instant: null } },
      parsed.dates[2],
    ]);
  });

  it("retries a malformed successful response envelope exactly once", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-only");
    vi.stubEnv("OPENROUTER_MODEL", "synthetic/model");
    vi.stubEnv("OPENROUTER_APPROVED_PROVIDERS", "synthetic");
    vi.stubEnv("OPENROUTER_ZDR_APPROVED", "true");
    vi.stubEnv("OPENROUTER_ACCOUNT_PRIVACY_VERIFIED", "true");
    const fetcher = vi.fn(
      async () => new Response("invalid JSON", { status: 200 }),
    );
    try {
      const result = await extractCreationProposal(
        assembleCreationSources([offer, counter], packets),
        {
          generate: (input) => generateStructured(input, fetcher),
        },
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        status: "unavailable",
        reason: "invalid_response",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("sends every pinned page, keeps the signed proposal and discards invented evidence", async () => {
    const sources = assembleCreationSources([offer, counter], packets);
    expect(sources?.documents.flatMap(({ pages }) => pages)).toHaveLength(3);
    const result = await extractCreationProposal(sources, {
      generate: async ({ instructions, schema, data }) => {
        expect(data).toEqual(sources);
        expect(instructions).toContain(
          "express signed Remedies and Title Commitment terms",
        );
        return {
          data: schema.parse(proposal),
          model: "synthetic/model",
          provider: "synthetic",
          usage: { promptTokens: 0, completionTokens: 0, costUsd: null },
        };
      },
    });
    expect(result.status).toBe("proposed");
    if (result.status === "proposed") {
      expect(result.proposal.dates).toEqual([proposal.dates[0]]);
      expect(result.proposal.purchasePriceCents).toBeNull();
    }
  });

  it("refuses a partial or mismatched packet before invoking the provider", async () => {
    const sources = assembleCreationSources(
      [offer, counter],
      packets.slice(0, 1),
    );
    const result = await extractCreationProposal(sources, {
      generate: async () => {
        throw new Error("Unexpected provider call");
      },
    });
    expect(result).toEqual({
      status: "unavailable",
      reason: "source_unavailable",
    });
  });

  it("retries invalid output once within the same budget and stops when canceled", async () => {
    const sources = assembleCreationSources([offer, counter], packets);
    let attempts = 0;
    let budget: AbortSignal | undefined;
    const controller = new AbortController();
    const result = await extractCreationProposal(sources, {
      signal: controller.signal,
      generate: async ({ signal }) => {
        attempts++;
        if (attempts === 1) {
          budget = signal;
          throw new HttpError(
            502,
            "AI_INVALID_RESULT",
            "Invalid synthetic output",
          );
        }
        expect(signal).toBe(budget);
        controller.abort();
        throw new HttpError(
          502,
          "AI_INVALID_RESULT",
          "Discard the interrupted result",
        );
      },
    });
    expect(attempts).toBe(2);
    expect(result).toEqual({ status: "unavailable", reason: "interrupted" });
  });
});
