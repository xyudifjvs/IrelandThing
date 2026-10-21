import { describe, it, expect } from "vitest";
import { offsetDate, definitionSchema, defaultDefinition } from "../src/rules";
describe("workflow dates", () => {
  it("uses date-only arithmetic across year and leap boundaries", () => {
    expect(offsetDate("2028-02-28", 1, false)).toBe("2028-02-29");
    expect(offsetDate("2026-01-01", -1, false)).toBe("2025-12-31");
  });
  it("skips weekends and specifically configured closure dates", () => {
    expect(offsetDate("2026-10-23", 1, true, ["2026-10-26"])).toBe(
      "2026-10-27",
    );
    expect(offsetDate("2026-10-26", -1, true)).toBe("2026-10-23");
  });
  it("preserves 17 source milestones without invented legal date rules", () => {
    expect(defaultDefinition.steps).toHaveLength(17);
    expect(defaultDefinition.steps.every((s) => !("rule" in s))).toBe(true);
  });
  it("rejects duplicate keys and self-referential rules", () => {
    const step = {
      key: "a",
      title: "Close",
      kind: "checklist",
      visibility: "agent",
    };
    expect(definitionSchema.safeParse({ steps: [step, step] }).success).toBe(
      false,
    );
    expect(
      definitionSchema.safeParse({
        steps: [
          {
            ...step,
            rule: {
              anchor: "Close",
              offsetDays: 1,
              businessDays: false,
              skipDates: [],
            },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
