import { describe, expect, it } from "vitest";
import { intakePayload } from "../src/index";

const payload = {
  packageCode: "complete",
  side: "buyer",
  propertyAddress: "123 Synthetic Intake Road",
  purchaseType: "cash",
  contractSource: "upload",
  documentIds: ["contract-one", "contract-two"],
  clients: [
    { name: "Synthetic Buyer", email: "buyer@example.test", phone: "555-0100" },
  ],
  directContact: "copy_agent",
  title: { choice: "have", name: "Synthetic Title" },
  hoa: "none",
  broker: {
    name: "Synthetic Broker",
    email: "broker@example.test",
    pre1978: false,
    ownChecklist: true,
  },
  notes: "",
  gift: { requested: false },
};

describe("intake brokerage document batches", () => {
  it("retains every checklist attachment and accepts existing single-file drafts", () => {
    const batch = intakePayload.parse({
      ...payload,
      broker: {
        ...payload.broker,
        checklistDocumentId: "checklist-one",
        checklistDocumentIds: [
          "checklist-one",
          "checklist-two",
          "checklist-three",
        ],
      },
    });
    expect(batch.broker?.checklistDocumentIds).toEqual([
      "checklist-one",
      "checklist-two",
      "checklist-three",
    ]);
    expect(
      intakePayload.parse({
        ...payload,
        broker: { ...payload.broker, checklistDocumentId: "legacy-checklist" },
      }).broker?.checklistDocumentId,
    ).toBe("legacy-checklist");
  });

  it("rejects hidden checklist attachments when the checklist option is off", () => {
    for (const evidence of [
      { checklistDocumentId: "legacy-checklist" },
      { checklistDocumentIds: ["checklist-one", "checklist-two"] },
    ]) {
      const parsed = intakePayload.safeParse({
        ...payload,
        broker: { ...payload.broker, ownChecklist: false, ...evidence },
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("enforces the total attachment cap across legacy and batch fields", () => {
    const ids = Array.from({ length: 30 }, (_, index) => `checklist-${index}`);
    expect(
      intakePayload.safeParse({
        ...payload,
        broker: {
          ...payload.broker,
          checklistDocumentId: ids[0],
          checklistDocumentIds: ids,
        },
      }).success,
    ).toBe(true);
    expect(
      intakePayload.safeParse({
        ...payload,
        broker: {
          ...payload.broker,
          checklistDocumentId: "extra-legacy-file",
          checklistDocumentIds: ids,
        },
      }).success,
    ).toBe(false);
  });
});
