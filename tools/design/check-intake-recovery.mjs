/** Independent UI fault/race checks against a local web build.
 * All session/intake/document API responses below are synthetic mocks. These checks
 * establish browser recovery behavior; use verify-intake.mjs for real storage/auth.
 */
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const origin = process.env.WEATHERLY_COMPARE_ORIGIN || "http://127.0.0.1:3314";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw Error("Local synthetic preview required");
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_EXECUTABLE ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const results = [];
async function session(context) {
  await context.route("**/api/v1/session", (r) =>
    r.fulfill({
      json: {
        user: {
          id: "independent-review-agent",
          name: "Independent Review Agent",
          email: "review@example.test",
          role: "agent",
        },
      },
    }),
  );
}
async function recovery(retry) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await session(context);
  let creates = 0,
    uploads = 0,
    revision = 1,
    payload = {};
  await context.route("**/api/v1/intake/drafts", async (r) => {
    if (r.request().method() === "GET") return r.fulfill({ json: [] });
    creates++;
    if (creates === 1)
      return r.fulfill({
        status: 503,
        json: {
          error: { message: "Synthetic draft association interruption" },
        },
      });
    payload = r.request().postDataJSON().payload;
    return r.fulfill({
      status: 201,
      json: { id: "review-draft", revision, status: "draft", payload },
    });
  });
  await context.route("**/api/v1/intake/drafts/review-draft", async (r) => {
    payload = r.request().postDataJSON().payload;
    revision++;
    return r.fulfill({
      json: { id: "review-draft", revision, status: "draft", payload },
    });
  });
  await context.route("**/api/v1/documents", (r) => {
    uploads++;
    return r.fulfill({
      status: 201,
      json: { id: "review-document", name: "review.pdf" },
    });
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(origin + "/portal/intake");
    await expect(page.locator("[data-agent-name]")).toHaveText(
      "Independent Review Agent",
    );
    await page.locator("#contractDocs").setInputFiles({
      name: "unsupported.doc",
      mimeType: "application/msword",
      buffer: Buffer.from("synthetic"),
    });
    await expect(page.locator("#list-contractDocs")).toContainText(
      "older Word",
    );
    await page.locator("#list-contractDocs [data-remove-queue]").click();
    await expect(page.locator("#list-contractDocs")).toBeEmpty();
    await page.locator("#contractDocs").setInputFiles({
      name: "review.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 synthetic review"),
    });
    await expect(page.locator("#list-contractDocs")).toContainText(
      "finishing its association failed",
    );
    if (retry) {
      await page.locator("#list-contractDocs [data-retry]").click();
      await expect(page.locator("#list-contractDocs")).toContainText(
        "Saved privately",
      );
      await page.locator("#list-contractDocs [data-remove-doc]").click();
    } else await page.locator("#list-contractDocs [data-remove-queue]").click();
    await expect(page.locator("#list-contractDocs")).toBeEmpty();
    await expect.poll(() => creates).toBe(2);
    assert.equal(uploads, 1);
    assert.deepEqual(payload.referenceIntake.fileNames, {});
    assert.deepEqual(payload.referenceIntake.uploads.contractDocs, []);
    assert.deepEqual(errors, []);
    results.push({
      scenario: retry
        ? "association failure → retry → remove"
        : "association failure → remove",
      checks: [
        "Invalid file visible and removable",
        "Failed association visible",
        "No duplicate bytes upload",
        "Removed document absent from next snapshot",
      ],
      uploads,
      creates,
      pageErrors: errors,
    });
  } finally {
    await context.close();
  }
}
async function race() {
  const context = await browser.newContext();
  await session(context);
  let release,
    startedResolve,
    uploads = 0,
    payload;
  const started = new Promise((r) => (startedResolve = r)),
    blocked = new Promise((r) => (release = r));
  await context.route("**/api/v1/intake/drafts", async (r) => {
    if (r.request().method() === "GET") return r.fulfill({ json: [] });
    payload = r.request().postDataJSON().payload;
    startedResolve();
    await blocked;
    return r.fulfill({
      status: 201,
      json: { id: "race-draft", revision: 1, status: "draft", payload },
    });
  });
  await context.route("**/api/v1/documents", (r) => {
    uploads++;
    return r.fulfill({
      status: 201,
      json: { id: "race-doc", name: "race.pdf" },
    });
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(origin + "/portal/intake");
    await expect(page.locator("[data-agent-name]")).toHaveText(
      "Independent Review Agent",
    );
    await page
      .getByRole("button", { name: "Resume & preferences", exact: true })
      .click();
    await page
      .getByLabel("Client communication preference")
      .selectOption("through_agent");
    await page.locator("#a_num").fill("42");
    await page.locator("#next").click();
    await started;
    await expect(page.locator("#a_num")).toBeDisabled();
    await expect(
      page.getByLabel("Client communication preference"),
    ).toBeDisabled();
    const data = await page.evaluateHandle(() => {
      const d = new DataTransfer();
      d.items.add(
        new File(["%PDF-1.4 synthetic"], "race.pdf", {
          type: "application/pdf",
        }),
      );
      return d;
    });
    await page
      .locator('[data-drop="contractDocs"]')
      .dispatchEvent("drop", { dataTransfer: data });
    release();
    await expect(page.locator('.step[data-step="1"]')).toBeVisible();
    assert.equal(uploads, 0);
    assert.equal(payload.directContact, "through_agent");
    await expect(page.locator('.step[data-step="1"] h1')).toBeFocused();
    await page.goto(origin + "/portal/intake");
    await expect(page.locator("[data-agent-name]")).toBeVisible();
    await expect(page.locator(".proto")).toContainText("$425");
    await page.locator('[name="service"][value="ctcc"]').check();
    await expect(page.locator(".proto")).toContainText("$515");
    await expect(page.locator(".proto")).toContainText(
      "Full Listing coming soon",
    );
    await page.goto(origin + "/portal/intake?variant=constructor");
    await expect(page.locator("[data-agent-name]")).toBeVisible();
    assert.deepEqual(errors, []);
    results.push({
      scenario: "save snapshot in flight",
      checks: [
        "Native and communication controls disabled",
        "Dropped file ignored",
        "Through-agent preference retained",
        "New step heading focused",
        "Approved service mapping and Full Listing coming soon",
        "Inherited URL variant ignored",
      ],
      uploads,
      pageErrors: errors,
    });
  } finally {
    release();
    await context.close();
  }
}
try {
  await recovery(true);
  await recovery(false);
  await race();
  console.log(
    JSON.stringify(
      { origin, apiMode: "synthetic mocked responses", results },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
