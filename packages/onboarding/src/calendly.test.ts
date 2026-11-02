import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("@weatherly/db", () => ({ prisma: {}, Prisma: {} }));
import { schedulingConfig, verifyCalendlySignature } from "./calendly";
const now = 1800000000000;
const raw = Buffer.from('{ "test": "é" }\n');
const timestamp = String(now / 1000);
const key = "synthetic-key";
const sig = createHmac("sha256", key)
  .update(timestamp + ".")
  .update(raw)
  .digest("hex");
describe("Calendly signature boundary", () => {
  it("authenticates exact raw bytes and permits rotated v1 signatures", () => {
    expect(
      verifyCalendlySignature(
        raw,
        `t=${timestamp},v1=${"0".repeat(64)},v1=${sig}`,
        key,
        now,
      ),
    ).toBe(true);
    expect(
      verifyCalendlySignature(
        Buffer.from(JSON.stringify(JSON.parse(raw.toString()))),
        `t=${timestamp},v1=${sig}`,
        key,
        now,
      ),
    ).toBe(false);
  });
  it("rejects stale and future timestamps, malformed hashes, duplicate timestamps and wrong keys", () => {
    for (const offset of [-181000, 181000])
      expect(
        verifyCalendlySignature(
          raw,
          `t=${timestamp},v1=${sig}`,
          key,
          now + offset,
        ),
      ).toBe(false);
    for (const header of [
      `t=${timestamp},v1=abc`,
      `t=${timestamp},t=${timestamp},v1=${sig}`,
      undefined,
    ])
      expect(verifyCalendlySignature(raw, header, key, now)).toBe(false);
    expect(
      verifyCalendlySignature(raw, `t=${timestamp},v1=${sig}`, "wrong", now),
    ).toBe(false);
  });
});
describe("public scheduling configuration", () => {
  it("supports embedding without synchronisation credentials", () => {
    expect(
      schedulingConfig({
        CALENDLY_EVENT_URL: "https://calendly.com/synthetic/consultation",
      }),
    ).toEqual({
      configured: true,
      syncConfigured: false,
      eventUrl: "https://calendly.com/synthetic/consultation",
    });
  });
  it("fails closed against unsafe and ambiguous event URLs", () => {
    for (const url of [
      "http://calendly.com/test/event",
      "https://calendly.com.evil.test/test/event",
      "https://evil.test/test/event",
      "https://calendly.com@evil.test/test/event",
      "https://calendly.com/test/event?redirect=evil",
      "https://calendly.com/test",
    ])
      expect(schedulingConfig({ CALENDLY_EVENT_URL: url })).toEqual({
        configured: false,
        syncConfigured: false,
        eventUrl: null,
      });
  });
});
