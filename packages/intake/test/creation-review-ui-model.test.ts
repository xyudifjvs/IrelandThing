import { expect, it } from "vitest";
import type { CreationProposal } from "../../ai/src/creation-extraction/proposal";
import {
  assembleDates,
  previewDates,
  suggestPeople,
} from "../../../apps/web/app/(workspace)/workspace/_features/creation/review-model";

const evidence = {
  versionId: "signed-v1",
  page: 1,
  quote: "Title commitment December 4, 2026",
};

function proposal(): CreationProposal {
  return {
    propertyAddress: null,
    purchasePriceCents: null,
    acceptance: null,
    buyers: [],
    sellers: [{ value: "Name in contract", evidence }],
    earnestMoneyCents: null,
    earnestMoneyHolder: null,
    homeWarrantyCompany: null,
    homeWarrantyCents: null,
    titleCompany: null,
    dates: [
      {
        key: "title_commitment",
        date: { date: "2026-12-04", instant: null },
        rule: { kind: "fixed" },
        evidence,
      },
    ],
  };
}

it("leaves absent terms unresolved and keeps explicit manual edits ahead of signed suggestions", () => {
  const facts = { side: "seller" as const };
  const closing = {
    key: "closing",
    value: { date: "2026-12-15", instant: null },
    rule: { kind: "fixed" as const },
  };
  const inspection = {
    ...closing,
    key: "inspections",
    value: { date: "2026-11-20", instant: null },
  };
  const dates = [closing, inspection];
  const missing = previewDates(facts, assembleDates(facts, dates, null));
  expect(missing.get("title_commitment")).toBeNull();
  expect(missing.get("remedies")).toBeNull();
  const signedDates = assembleDates(facts, dates, proposal());
  expect(previewDates(facts, signedDates).get("title_commitment")?.date).toBe(
    "2026-12-04",
  );
  const cleared = assembleDates(
    facts,
    [closing, { key: "title_commitment", value: null, rule: null }],
    proposal(),
  );
  expect(previewDates(facts, cleared).get("title_commitment")).toBeNull();
});

it("keeps intake client details ahead of names in the extraction proposal", () => {
  const people = [
    {
      role: "client",
      name: "Submitted client",
      email: "agent-supplied@example.test",
      phone: "",
    },
  ];
  expect(suggestPeople(people, "seller", proposal())).toEqual(people);
  expect(suggestPeople([], "seller", proposal())).toEqual([
    { role: "client", name: "Name in contract", email: "", phone: "" },
  ]);
});

it("fills a single unmatched same-side name without dropping the partial intake details", () => {
  const partial = {
    role: "client",
    name: "",
    email: "original@example.test",
    phone: "555-0105",
  };
  expect(suggestPeople([partial], "seller", proposal())).toEqual([
    { ...partial, name: "Name in contract" },
  ]);
  const another = { ...partial, email: "different@example.test" };
  expect(suggestPeople([partial, another], "seller", proposal())).toEqual([
    partial,
    another,
  ]);
  const known = { ...partial, name: "Different named seller" };
  expect(suggestPeople([known, another], "seller", proposal())).toEqual([
    known,
    another,
  ]);
});
