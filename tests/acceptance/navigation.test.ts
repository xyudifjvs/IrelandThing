import { describe, it, expect } from "vitest";
import { safeAuthorizationReturn } from "../../apps/web/app/(account)/_components/navigation";
describe("login OAuth continuation boundary", () => {
  const origin = "https://weatherly.example";
  it("preserves only local OAuth authorization paths and their required query", () => {
    expect(
      safeAuthorizationReturn(
        "/authorize?client_id=synthetic&response_type=code",
        origin,
      ),
    ).toBe("/authorize?client_id=synthetic&response_type=code");
    expect(
      safeAuthorizationReturn(
        "/authorize?redirect_uri=https%3A%2F%2Fapproved-client.example%2Fcallback",
        origin,
      ),
    ).toContain("/authorize?");
  });
  it.each([
    null,
    "https://evil.example/authorize",
    "//evil.example/authorize",
    "/\\evil.example/authorize",
    "javascript:alert(1)",
    "/workspace",
    "/authorize/other",
    "/authorize\r\nLocation: https://evil.example",
  ])("rejects unrelated or unsafe return %s", (value) => {
    expect(safeAuthorizationReturn(value, origin)).toBeNull();
  });
});
