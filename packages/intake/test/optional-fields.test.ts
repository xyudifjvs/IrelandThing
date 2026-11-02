import { describe, expect, it } from "vitest";
import { intakePayload } from "../src/index";

const blank = {
  packageCode: "essentials",
  side: "buyer",
  propertyAddress: "",
  purchaseType: "financed",
  contractSource: "upload",
  documentIds: [],
  clients: [{ name: "" }],
  directContact: "copy_agent",
  title: { choice: "have" },
  lender: { choice: "have" },
  hoa: "none",
  broker: { name: "", email: "", pre1978: false, ownChecklist: false },
  gift: { requested: false },
};

describe("optional transaction intake details", () => {
  it("accepts blank details and no documents for every service", () => {
    for (const packageCode of ["essentials", "complete", "full_listing"]) {
      expect(
        intakePayload.safeParse({
          ...blank,
          packageCode,
          side: packageCode === "full_listing" ? "seller" : "buyer",
        }).success,
      ).toBe(true);
    }
  });

  it("accepts omitted contacts, broker, lender and title details", () => {
    const {
      broker: _broker,
      lender: _lender,
      title: _title,
      clients: _clients,
      propertyAddress: _address,
      ...payload
    } = blank;
    expect(intakePayload.parse(payload)).toMatchObject({
      propertyAddress: "",
      clients: [],
      title: { choice: "have" },
    });
    expect(
      intakePayload.safeParse({ ...payload, gift: { requested: true } })
        .success,
    ).toBe(true);
  });

  it("allows partial contact details but still rejects invalid supplied emails", () => {
    expect(
      intakePayload.safeParse({ ...blank, clients: [{ name: "Mock client" }] })
        .success,
    ).toBe(true);
    for (const patch of [
      { clients: [{ name: "", email: "invalid" }] },
      { title: { choice: "have", email: "invalid" } },
      { lender: { choice: "have", email: "invalid" } },
      { broker: { ...blank.broker, email: "invalid" } },
    ]) {
      expect(intakePayload.safeParse({ ...blank, ...patch }).success).toBe(
        false,
      );
    }
  });

  it("keeps branch consistency and document limits", () => {
    expect(
      intakePayload.safeParse({ ...blank, packageCode: "full_listing" })
        .success,
    ).toBe(false);
    expect(
      intakePayload.safeParse({
        ...blank,
        documentIds: Array(31).fill("document"),
      }).success,
    ).toBe(false);
    expect(
      intakePayload.safeParse({ ...blank, purchaseType: "cash" }).success,
    ).toBe(false);
  });
});
