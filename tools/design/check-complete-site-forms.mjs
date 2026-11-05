/** Local mocked form contracts only. No provider calls or business-record writes. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const origin = process.env.WEATHERLY_COMPARE_ORIGIN || "http://127.0.0.1:3314";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw Error("Local preview required.");
const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_EXECUTABLE ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  }),
  checks = [];
try {
  const context = await browser.newContext(),
    posts = [],
    releases = [];
  let hold = true,
    contactFail = true;
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let result = {};
    if (path === "/api/v1/onboarding/scheduling")
      result = { configured: false, eventUrl: null };
    else if (path === "/api/v1/onboarding/inquiries") {
      const payload = route.request().postDataJSON();
      posts.push(payload);
      if (hold) await new Promise((resolve) => releases.push(resolve));
      if (payload.kind === "contact" && contactFail) {
        contactFail = false;
        await route.fulfill({
          status: 503,
          json: { message: "Synthetic save failure" },
        });
        return;
      }
      result = { id: "mock-received-" + posts.length, status: "received" };
    } else if (path === "/api/auth/sign-in/email")
      result = { twoFactorRedirect: true };
    else if (path.includes("/two-factor/")) {
      posts.push({ verify: path, ...route.request().postDataJSON() });
      result = { status: true };
    } else if (path === "/api/v1/session")
      result = {
        user: {
          id: "mock-agent",
          name: "Synthetic Agent",
          email: "agent@example.test",
          role: "agent",
        },
      };
    else if (path === "/api/v1/matters") result = [];
    await route.fulfill({ json: result });
  });
  const page = await context.newPage();
  await page.goto(origin + "/onboarding");
  const info = page.locator('[data-reference-form="information"]');
  await info.locator("[name=email]").fill("synthetic-info@example.test");
  await info.getByRole("button").click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(info.locator("[name=email]")).toBeDisabled();
  await expect(info.getByRole("button")).toBeDisabled();
  assert.equal(posts[0].name, "");
  assert.equal(posts[0].kind, "information");
  releases.shift()();
  await expect(info.getByRole("status")).toContainText(
    "Information request saved",
  );
  await expect(info.locator("[name=email]")).toHaveValue(
    "synthetic-info@example.test",
  );
  await info.getByRole("button").click();
  await expect(info.getByRole("status")).toContainText("already saved");
  assert.equal(posts.length, 1);
  hold = false;
  checks.push(
    "Email-only information request: pending controls locked, confirmed receipt only, same-content repeat does not create another request.",
  );
  const agreement = page.locator('[data-reference-form="service_agreement"]');
  await agreement.locator("[name=name]").fill("Synthetic Agent");
  await agreement.locator("[name=email]").fill("agreement@example.test");
  await agreement.locator("[name=team]").fill("Synthetic team");
  await agreement.locator("[name=officeAddress]").fill("Synthetic office");
  await expect(agreement.locator("[name=brokerage]")).toHaveValue(
    "Howard Hanna",
  );
  assert.equal(
    await agreement.locator("[name=brokerage]").getAttribute("readonly"),
    "",
  );
  await agreement.getByRole("button").click();
  await expect(agreement.getByRole("status")).toContainText(
    "No agreement or invitation has been sent",
  );
  assert.deepEqual(posts.at(-1).payload, {
    brokerage: "Howard Hanna",
    requestType: "service_agreement",
    team: "Synthetic team",
    officeAddress: "Synthetic office",
  });
  checks.push(
    "Agreement request carries structured team/office/type fields and preserves the Howard Hanna restriction.",
  );
  await page.locator("[data-book-call]").click();
  const booking = page.locator("[data-booking-request] form");
  await expect(booking).toContainText("Scheduling is not connected yet");
  await booking.locator("[name=name]").fill("Synthetic Caller");
  await booking.locator("[name=email]").fill("call@example.test");
  await booking.locator("[name=meetingTime]").fill("2030-01-02T10:00");
  await booking.getByRole("button").click();
  await expect(booking.getByRole("status")).toContainText(
    "no meeting, Zoom link or email has been created",
  );
  assert.equal(posts.at(-1).kind, "meeting");
  checks.push(
    "Unconfigured booking saves only a call request and does not claim a booked event.",
  );
  await page.goto(origin + "/contact");
  const contact = page.locator('[data-reference-form="contact"]');
  await contact.locator("[name=name]").fill("Synthetic Sender");
  await contact.locator("[name=email]").fill("contact@example.test");
  await contact.locator("[name=message]").fill("Synthetic inquiry");
  await contact.getByRole("button").click();
  await expect(contact.getByRole("alert")).toBeVisible();
  const failedId = posts.at(-1).requestId;
  await expect(contact.locator("[name=message]")).toHaveValue(
    "Synthetic inquiry",
  );
  await contact.getByRole("button").click();
  await expect(contact.getByRole("status")).toContainText(
    "This form has not sent an email",
  );
  assert.equal(posts.at(-1).requestId, failedId);
  checks.push(
    "Failed contact save retains fields and retries the same idempotency key; success truthfully says no email was sent.",
  );
  await page.goto(origin + "/agent-portal");
  const login = page.locator('[data-reference-form="login"]');
  await login.locator("[name=email]").fill("agent@example.test");
  await login.locator("[name=password]").fill("synthetic-password");
  await login.getByRole("button", { name: /log in/i, exact: true }).click();
  await expect(login.getByLabel("Verification code")).toBeVisible();
  await expect(login.locator("[name=email]")).toBeDisabled();
  await expect(login.locator("[name=password]")).toHaveValue("");
  await expect(
    login.getByRole("button", { name: /log in/i, exact: true }),
  ).toBeDisabled();
  await login.getByLabel("Verification code").fill("123456");
  await login.getByLabel("Verification code").press("Enter");
  await expect(page).toHaveURL(origin + "/portal");
  assert.equal(posts.at(-1).verify, "/api/auth/two-factor/verify-totp");
  checks.push(
    "MFA locks original credentials, clears password, and supports Enter verification before role-based portal redirect.",
  );
  await mkdir(".local/redesign/complete-site", { recursive: true });
  await writeFile(
    ".local/redesign/complete-site/form-checks.json",
    JSON.stringify(
      {
        mode: "Mocked API contract checks; no external providers or business records",
        checks,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(checks.join("\n"));
} finally {
  await browser.close();
}
