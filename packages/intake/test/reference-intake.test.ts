import { describe, expect, it } from "vitest";
import {
  intakePayload,
  referenceIntake,
  assertSubmissionReady,
} from "../src/index";
import {
  referenceFollowups,
  referenceCompletionIssues,
} from "../src/reference";
import { completedReference } from "./reference-fixture";

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

  it("requires uploads for plain service and accepts a fully answered compliance loop", () => {
    for (const variant of [
      "buyer",
      "seller",
      "buyer-compliance",
      "seller-compliance",
    ] as const) {
      const completed = completedReference(variant);
      const seller = variant.startsWith("seller");
      const compliance = variant.endsWith("-compliance");
      const data = {
        ...base,
        side: seller ? "seller" : "buyer",
        packageCode: compliance ? "complete" : "essentials",
        propertyAddress: "1420 Synthetic Lane, Columbus, OH 43215",
      };
      if (!compliance) {
        expect(() =>
          assertSubmissionReady(
            intakePayload.parse({
              ...data,
              referenceIntake: {
                ...completed,
                fields: {
                  ...completed.fields,
                  docsDotloop: true,
                  contractLocation: "Synthetic loop",
                },
              },
            }),
          ),
        ).toThrow("requires an uploaded executed contract");
      }
      expect(() =>
        assertSubmissionReady(
          intakePayload.parse({
            ...data,
            referenceIntake: {
              ...completed,
              uploads: { contractDocs: ["stored-contract"] },
            },
          }),
        ),
      ).not.toThrow();
      if (compliance) {
        expect(() =>
          assertSubmissionReady(
            intakePayload.parse({ ...data, referenceIntake: completed }),
          ),
        ).not.toThrow();
        expect(() =>
          assertSubmissionReady(
            intakePayload.parse({
              ...data,
              referenceIntake: {
                ...completed,
                fields: {
                  ...completed.fields,
                  docsDotloop: false,
                  contractLocation: "Synthetic property transaction loop",
                },
              },
            }),
          ),
        ).not.toThrow();
        expect(() =>
          assertSubmissionReady(
            intakePayload.parse({
              ...data,
              propertyAddress: "",
              referenceIntake: {
                ...completed,
                fields: { ...completed.fields, docsDotloop: false },
              },
            }),
          ),
        ).toThrow("identify the transaction loop");
      }
    }
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
      { fields: { addl: "yes", c1_email: "bad-email" } },
      { fields: { c1_email: true } },
      {
        fields: {
          hoa: "yes",
          hoaDocs: "mls",
          hoaSent: "yes",
          hoaDate: "2026-02-30",
        },
      },
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
        "Locate executed contract in identified transaction loop; verify account access",
        "Verify reported HOA document delivery date",
      ]),
    );
  });

  it("requires each always-applicable question and visible required field in all four completed variants", () => {
    for (const variant of [
      "buyer",
      "seller",
      "buyer-compliance",
      "seller-compliance",
    ] as const) {
      const complete = completedReference(variant);
      expect(referenceCompletionIssues(complete)).toEqual([]);
      const fields = [
        "service",
        "side",
        "a_num",
        "a_street",
        "a_city",
        "a_state",
        "a_zip",
        "cash",
        "b1_name",
        "b1_email",
        "b1_phone",
        "coop",
        "addl",
        "title",
        "lender",
        "fee",
        "hoa",
        "gift",
        ...(variant.startsWith("seller")
          ? ["occ", "listcomm"]
          : ["emd", "mls"]),
      ];
      for (const key of fields) {
        const missing = { ...complete, fields: { ...complete.fields } };
        delete missing.fields[key];
        expect(
          referenceCompletionIssues(missing).some(
            (issue) => issue.field === key,
          ),
          `${variant}/${key}`,
        ).toBe(true);
      }
    }
  });

  it("checks only active relationship, co-op, additional-contact and manual title/lender branches", () => {
    const complete = completedReference("buyer-compliance");
    const issues = (fields: Record<string, string | boolean>) =>
      referenceCompletionIssues({
        ...complete,
        fields: { ...complete.fields, ...fields },
      });
    expect(
      issues({
        b2_name: "Second client",
        b2_email: "second@example.test",
        b2_phone: "555",
        buyerRel: "other",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "buyerRelOther" }),
      ]),
    );
    expect(
      issues({
        b2_name: "Second client",
        b2_email: "second@example.test",
        b2_phone: "555",
        buyerRel: "other",
        buyerRelOther: "Mother / daughter",
      }),
    ).toEqual([]);
    for (const field of ["co_brokerage", "co_name", "co_phone", "co_email"]) {
      const manual: Record<string, string> = {
        coop: "type",
        co_brokerage: "Synthetic",
        co_name: "Co-op",
        co_phone: "555",
        co_email: "coop@example.test",
      };
      delete manual[field];
      expect(issues(manual).some((issue) => issue.field === field)).toBe(true);
    }
    expect(issues({ addl: "yes" })).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "c1_name" })]),
    );
    expect(
      issues({ addl: "yes", c1_name: "Additional", c1_phone: "555" }),
    ).toEqual([]);
    expect(issues({ title: "have" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "t_co" }),
        expect.objectContaining({ field: "t_email" }),
      ]),
    );
    expect(
      issues({ title: "have", t_contact: "Title person", t_phone: "555" }),
    ).toEqual([]);
    expect(issues({ cash: "no", lender: "have" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "l_co" }),
        expect.objectContaining({ field: "l_email" }),
      ]),
    );
    expect(
      issues({
        cash: "no",
        lender: "have",
        l_co: "Lender",
        l_email: "lender@example.test",
      }),
    ).toEqual([]);
    expect(issues({ cash: "no", lender: "deciding", title: "unsure" })).toEqual(
      [],
    );
    const seller = completedReference("seller-compliance");
    expect(
      referenceCompletionIssues({
        ...seller,
        fields: {
          ...seller.fields,
          cash: "no",
          lender: "buyersagent",
          title: "mls",
        },
      }),
    ).toEqual([]);
  });

  it("requires conditional HOA/MLS/gift answers and leaves supplied help and optional notes valid", () => {
    const complete = completedReference("buyer-compliance");
    const issues = (fields: Record<string, string | boolean>, uploads = {}) =>
      referenceCompletionIssues({
        ...complete,
        fields: { ...complete.fields, ...fields },
        uploads,
      });
    expect(issues({ hoa: "yes", hoaDocs: "request" })).toEqual([]);
    expect(
      issues({ hoa: "yes" }).some((issue) => issue.field === "hoaDocs"),
    ).toBe(true);
    expect(
      issues({ hoa: "yes", hoaDocs: "upload" }).some(
        (issue) => issue.field === "hoaFiles",
      ),
    ).toBe(true);
    expect(
      issues(
        { hoa: "yes", hoaDocs: "upload", hoaSent: "yes" },
        { hoaFiles: ["private-hoa-file"] },
      ).some((issue) => issue.field === "hoaDate"),
    ).toBe(true);
    expect(
      issues({
        hoa: "yes",
        hoaDocs: "mls",
        hoaSent: "yes",
        hoaDate: "2026-11-05",
      }),
    ).toEqual([]);
    expect(
      issues({ mls: "yes" }).some((issue) => issue.field === "mls_sell"),
    ).toBe(true);
    expect(issues({ mls: "yes", mls_sell: "Team lead" })).toEqual([]);
    for (const field of ["tier", "giftOpt", "giftAgree"]) {
      const gift: Record<string, string | boolean> = {
        gift: "yes",
        tier: "Classic",
        giftOpt: "Gift Option 1",
        giftAgree: true,
      };
      delete gift[field];
      expect(issues(gift).some((issue) => issue.field === field)).toBe(true);
    }
    expect(
      issues({
        gift: "yes",
        tier: "Luxury",
        giftOpt: "Gift Option 2",
        giftAgree: true,
      }),
    ).toEqual([]);
  });

  it("retains inactive invalid contact/date values without validating or discarding them", () => {
    const complete = completedReference("buyer-compliance");
    const hidden = {
      ...complete,
      fields: {
        ...complete.fields,
        co_email: "bad-coop",
        c1_email: "bad-additional",
        t_email: "bad-title",
        l_email: "bad-lender",
        hoaDate: "not-a-date",
        buyerRelOther: "",
      },
    };
    expect(referenceIntake.parse(hidden)).toEqual(hidden);
    expect(referenceCompletionIssues(hidden)).toEqual([]);
    for (const fields of [
      { coop: "type", co_email: "bad-coop" },
      { addl: "yes", c1_email: "bad-additional" },
      { title: "have", t_email: "bad-title" },
      { cash: "no", lender: "have", l_email: "bad-lender" },
      { hoa: "yes", hoaDocs: "mls", hoaSent: "yes", hoaDate: "not-a-date" },
      { b1_email: "bad-client" },
    ])
      expect(
        referenceIntake.safeParse({
          ...complete,
          fields: { ...complete.fields, ...fields },
        }).success,
      ).toBe(false);
  });
});
