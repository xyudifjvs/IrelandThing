import { expect, it } from "vitest";
import {
  fileDetailsDraft,
  fileDetailsPatch,
  readFileAmount,
} from "../../../../apps/web/app/(workspace)/workspace/_features/transaction-workspace/file-details-model";
import type { TransactionFile } from "../../../../apps/web/app/(workspace)/workspace/_features/transaction-workspace/file-model";

const file: TransactionFile = {
  id: "synthetic",
  propertyAddress: "123 Synthetic Street",
  side: "seller",
  purchasePriceCents: "25000001",
  agentId: "saved-agent",
  details: { purchaseType: "financed" },
};
it("prefills exact stored cents and submits only edited fields, including explicit clears", () => {
  const initial = fileDetailsDraft(file);
  expect(initial.purchasePrice).toBe("250000.01");
  expect(
    fileDetailsPatch(initial, { ...initial, purchasePrice: "275000.02" }),
  ).toEqual({ purchasePriceCents: 27500002 });
  expect(fileDetailsPatch(initial, { ...initial, purchasePrice: "" })).toEqual({
    purchasePriceCents: null,
  });
  expect(fileDetailsPatch(initial, { ...initial, agentId: null })).toEqual({
    agentId: null,
    agentRosterId: null,
  });
  expect(fileDetailsPatch(initial, initial)).toEqual({});
});
it("rejects fractions of a cent, negative values and unsafe/oversized amounts", () => {
  expect(readFileAmount("0", "price")).toBe(0);
  expect(readFileAmount("1.01", "price")).toBe(101);
  for (const value of ["-1", "1.001", "NaN", "1e4", "9007199254740992"])
    expect(() => readFileAmount(value, "price")).toThrow();
  expect(() =>
    readFileAmount("100000000.01", "earnest money", 10000000000),
  ).toThrow();
});
