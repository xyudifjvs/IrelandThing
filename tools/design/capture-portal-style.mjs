/** Authenticated, read-only local synthetic style evidence. No provider/account operations. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const origin = process.env.WEATHERLY_COMPARE_ORIGIN || "http://127.0.0.1:3314";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw Error("Local synthetic preview required.");
const out = ".local/redesign/portal-style/";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_EXECUTABLE ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  }),
  captures = [];
try {
  for (const [role, email, prefix] of [
    ["agent", "alex.agent@example.test", "portal"],
    ["coordinator", "ireland@example.test", "workspace"],
  ]) {
    const context = await browser.newContext();
    const response = await context.request.post(
      origin + "/api/auth/sign-in/email",
      {
        headers: { Origin: origin },
        data: { email, password: "Weatherly-Local-2026!" },
      },
    );
    assert.equal(response.status(), 200, "Synthetic login failed");
    const session = await (
      await context.request.get(origin + "/api/v1/session")
    ).json();
    assert.equal(session.user.role, role);
    const matters = await (
      await context.request.get(origin + "/api/v1/matters?limit=200&offset=0")
    ).json();
    const choices = matters
      .filter(
        (m) =>
          /synthetic/i.test(
            (m.title || "") + " " + (m.propertyAddress || ""),
          ) && !["pending_review", "terminated"].includes(m.stage),
      )
      .sort((a, b) => (b.tasks?.length || 0) - (a.tasks?.length || 0));
    assert.ok(choices.length, "No approved synthetic style fixture found");
    const matter = choices[0];
    await context.route("https://**/*", (route) => route.abort());
    const page = await context.newPage();
    for (const width of [1280, 390]) {
      await page.setViewportSize({
        width,
        height: width === 1280 ? 1000 : 844,
      });
      for (const [view, path] of [
        ["overview", "/" + prefix],
        ["transaction", "/" + prefix + "/transactions/" + matter.id],
      ]) {
        await page.goto(origin + path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(
          page.getByText("Opening your file…", { exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByText("Opening your transaction…", { exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByText("Loading portfolio totals…", { exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByText("Opening your transactions…", { exact: true }),
        ).toHaveCount(0);
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        });
        await page
          .locator("nextjs-portal")
          .evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
        const metrics = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
          viewport: innerWidth,
          font: getComputedStyle(document.querySelector("h1")).fontFamily,
        }));
        const file = out + prefix + "-" + view + "-" + width + ".png";
        await page.screenshot({ path: file, fullPage: true });
        captures.push({ role, view, path, viewport: width, file, ...metrics });
        assert.ok(
          metrics.width <= width,
          `${prefix} ${view} overflows at ${width}: ${metrics.width}`,
        );
      }
    }
    await context.close();
  }
  await writeFile(
    out + "captures.json",
    JSON.stringify(
      {
        scope:
          "Authenticated local synthetic records; website style alignment only. No source design exists for authenticated portal/workspace. Read-only capture; no transaction mutation.",
        captures,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(captures, null, 2));
} finally {
  await browser.close();
}
