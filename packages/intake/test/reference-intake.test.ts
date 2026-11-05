import { describe, expect, it } from "vitest";
import {
  intakePayload,
  referenceIntake,
  assertSubmissionReady,
} from "../src/index";
import { referenceFollowups } from "../src/reference";

const base = {
  packageCode: "essentials",
  side: "buyer",
  purchaseType: "cash",
  contractSource: "upload",
  directContact: "copy_agent",
  hoa: "none",
  gift: { requested: false },
};
const reference = {
  version: 1,
  variant: "buyer",
  fields: {},
  uploads: {},
  fileNames: {},
};

describe("supplied Weatherly intake records", () => {
  it("accepts incomplete answer shapes with the approved service mapping", () => {
    for (const variant of [
      "buyer",
      "seller",
      "buyer-compliance",
      "seller-compliance",
    ]) {
      const side = variant.startsWith("seller") ? "seller" : "buyer";
      const packageCode = variant.endsWith("-compliance")
        ? "complete"
        : "essentials";
      expect(
        intakePayload.parse({
          ...base,
          side,
          packageCode,
          referenceIntake: { ...reference, variant },
        }).referenceIntake,
      ).toEqual({ ...reference, variant });
      expect(
        intakePayload.safeParse({
          ...base,
          side,
          packageCode: packageCode === "complete" ? "essentials" : "complete",
          referenceIntake: { ...reference, variant },
        }).success,
      ).toBe(false);
    }
  });

  it("requires the confirmed contract minimum only when submitting", () => {
    for (const fields of [
      {},
      { docsDotloop: true },
      { contractLocation: "   " },
    ]) {
      const data = intakePayload.parse({
        ...base,
        referenceIntake: { ...reference, fields },
      });
      expect(() => assertSubmissionReady(data)).toThrow(
        "Upload the executed contract",
      );
    }
    for (const patch of [
      {
        fields: {
          contractLocation:
            "Dotloop: Synthetic Road loop, Executed contract folder",
        },
      },
      { uploads: { contractDocs: ["stored-contract"] } },
    ])
      expect(() =>
        assertSubmissionReady(
          intakePayload.parse({
            ...base,
            referenceIntake: { ...reference, ...patch },
          }),
        ),
      ).not.toThrow();
    expect(() =>
      assertSubmissionReady(
        intakePayload.parse({ ...base, documentIds: ["contract"] }),
      ),
    ).not.toThrow();
    expect(() =>
      assertSubmissionReady(
        intakePayload.parse({
          ...base,
          packageCode: "complete",
          contractSource: "dotloop",
          dotloopLoopId: "synthetic-loop",
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertSubmissionReady(
        intakePayload.parse({
          ...base,
          packageCode: "full_listing",
          side: "seller",
          documentIds: ["contract"],
        }),
      ),
    ).toThrow("Full Listing is coming soon");
  });

  it("retains hidden contacts, acknowledgments and upload-only groups", () => {
    const value = {
      ...reference,
      fields: {
        side: "buyer",
        service: "ctc",
        addl: "no",
        c2_email: "additional@example.test",
        c2_rel: "Parent",
        buyerRel: "other",
        buyerRelOther: "Mother / daughter",
        hoa: "no",
        hoaDate: "2026-11-04",
        gift: "no",
        giftAgree: true,
      },
      uploads: { hoaFiles: ["hoa-only"], utilFiles: ["seller-only"] },
      fileNames: { "hoa-only": "hoa.pdf", "seller-only": "utilities.pdf" },
    };
    expect(referenceIntake.parse(value)).toEqual(value);
  });

  it("rejects invalid supplied email/date/shape without inventing required fields", () => {
    for (const patch of [
      { fields: { c1_email: "bad-email" } },
      { fields: { c1_email: true } },
      { fields: { hoaDate: "2026-02-30" } },
      { fields: { side: "seller" } },
      { fields: { service: "ctcc" } },
      { fields: { constructor: "unsafe-key" } },
      { fields: { notes: "x".repeat(20001) } },
      { uploads: { inventedGroup: ["doc"] } },
      { fileNames: { orphan: "invisible.pdf" } },
    ])
      expect(
        referenceIntake.safeParse({ ...reference, ...patch }).success,
      ).toBe(false);
    expect(
      intakePayload.safeParse({
        ...base,
        side: "seller",
        referenceIntake: reference,
      }).success,
    ).toBe(false);
  });

  it("keeps the legacy cap and supports four bounded new attachment groups", () => {
    const groups = Object.fromEntries(
      ["contractDocs", "hoaFiles", "utilFiles", "policyFiles"].map((group) => [
        group,
        Array.from({ length: 30 }, (_, i) => `${group}-${i}`),
      ]),
    );
    const ids = Object.values(groups).flat();
    expect(intakePayload.safeParse({ ...base, documentIds: ids }).success).toBe(
      false,
    );
    expect(
      intakePayload.safeParse({
        ...base,
        documentIds: ids,
        referenceIntake: { ...reference, uploads: groups },
      }).success,
    ).toBe(true);
    expect(
      referenceIntake.safeParse({
        ...reference,
        uploads: { hoaFiles: Array(31).fill("doc") },
      }).success,
    ).toBe(false);
  });

  it("turns saved coordination requests into review tasks without invitations or provider actions", () => {
    const parsed = referenceIntake.parse({
      ...reference,
      variant: "seller-compliance",
      fields: {
        side: "seller",
        service: "ctcc",
        coop: "type",
        addl: "yes",
        occ: "Occupied",
        fee: "$300",
        listcomm: "3%",
        hoa: "yes",
        hoaSent: "yes",
        hoaDate: "2026-11-04",
        docsDotloop: true,
        utilNotes: "Prior policy is in Dotloop",
      },
    });
    const titles = referenceFollowups(parsed).map((task) => task.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Review additional communication and portal contact requests",
        "Review seller utilities and previous title policy",
        "Review listing commission instructions",
        "Review requested contract documents in Dotloop; verify account access",
        "Verify reported HOA document delivery date",
      ]),
    );
  });
});
