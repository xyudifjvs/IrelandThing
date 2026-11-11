import { describe, expect, it } from "vitest";
import { HttpError } from "@weatherly/platform";
import { assembleCreationSources } from "../src/creation-extraction/source-bundle";
import { extractCreationProposal } from "../src/creation-extraction/extract";

const offer = { documentId: "offer", versionId: "offer-version" };
const counter = { documentId: "counter", versionId: "counter-version" };
const packets = [
  {
    ...offer,
    processingStatus: "complete",
    pages: [
      { page: 1, text: "Closing November 18. Title commitment November 3." },
      { page: 2, text: "Offer signed November 9." },
    ],
  },
  {
    ...counter,
    processingStatus: "complete",
    pages: [
      {
        page: 1,
        text: "Signed counteroffer. Title commitment due November 12.",
      },
    ],
  },
];

const proposal = {
  propertyAddress: null,
  purchasePriceCents: null,
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
        quote: "Title commitment due November 12.",
      },
    },
    {
      key: "possession",
      date: { date: "2026-11-20", instant: null },
      rule: null,
      evidence: {
        versionId: counter.versionId,
        page: 1,
        quote: "fabricated possession clause",
      },
    },
  ],
};

describe("creation contract extraction", () => {
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
    if (result.status === "proposed")
      expect(result.proposal.dates).toEqual([proposal.dates[0]]);
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
