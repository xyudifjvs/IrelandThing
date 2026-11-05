/** Static supplied references vs running local web app, with no bundle JS execution. */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import sharp from "sharp";
const root = "design-reference/2026-11-weatherly/complete-site/",
  out = ".local/redesign/complete-site/";
const pages = JSON.parse(await readFile(root + "decoded-pages.json", "utf8")),
  assets = JSON.parse(await readFile(root + "assets.json", "utf8"));
const fonts = await readFile(
  "apps/web/app/(marketing)/_components/complete-site-fonts.css",
  "utf8",
);
const origin = process.env.WEATHERLY_COMPARE_ORIGIN || "http://127.0.0.1:3314";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw Error("Use only a local synthetic preview.");
const assetChecks = [];
for (const asset of new Map(
  Object.values(assets).map((asset) => [asset.url, asset]),
).values()) {
  const response = await fetch(origin + asset.url);
  assert.equal(response.status, 200, "Missing local asset: " + asset.url);
  const data = Buffer.from(await response.arrayBuffer());
  assert.equal(data.length, asset.bytes);
  assert.equal(createHash("sha256").update(data).digest("hex"), asset.sha256);
  assetChecks.push({
    url: asset.url,
    sha256: asset.sha256,
    bytes: data.length,
  });
}
const routes = {
  home: "/",
  services: "/services",
  process: "/process",
  onboarding: "/onboarding",
  agentPortal: "/agent-portal",
  contact: "/contact",
};
const allowed = new Map(
  Object.values(assets).map((asset) => [asset.url, asset.mime]),
);
const server = createServer(async (req, res) => {
  try {
    const name = req.url?.slice(1);
    if (Object.hasOwn(pages, name)) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>' +
          fonts +
          "body{margin:0}a{color:#7A6247}a:hover{color:#141210}summary{list-style:none}summary::-webkit-details-marker{display:none}</style></head><body>" +
          pages[name].canvas +
          "</body></html>",
      );
    } else if (allowed.has(req.url)) {
      res.setHeader("Content-Type", allowed.get(req.url));
      res.end(await readFile("apps/web/public" + req.url));
    } else {
      res.statusCode = 404;
      res.end();
    }
  } catch {
    res.statusCode = 500;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const refOrigin = "http://127.0.0.1:" + server.address().port;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_EXECUTABLE ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  }),
  results = [];
async function settled(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) => img.decode().catch(() => {})),
    );
  });
  await page
    .locator("nextjs-portal")
    .evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
}
async function capture(reference, actual, key, width, state) {
  const paths = [
    out + `${key}-${width}-${state}-reference.png`,
    out + `${key}-${width}-${state}-actual.png`,
  ];
  await settled(reference);
  await settled(actual);
  async function stableScreenshot(page, path) {
    let previous;
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const current = await page.screenshot({ fullPage: true });
      if (previous?.equals(current)) {
        await writeFile(path, current);
        return;
      }
      previous = current;
    }
    throw Error("Reference screenshot did not settle: " + path);
  }
  await stableScreenshot(reference, paths[0]);
  await stableScreenshot(actual, paths[1]);
  const a = await sharp(paths[0])
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    b = await sharp(paths[1])
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  let changed = 0,
    difference = 0;
  const intersect = Math.min(a.info.height, b.info.height) * width * 4;
  for (let i = 0; i < intersect; i += 4) {
    let differs = false;
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(a.data[i + channel] - b.data[i + channel]);
      difference += delta;
      if (delta) differs = true;
    }
    if (differs) changed++;
  }
  const extra = Math.abs(a.info.height - b.info.height) * width;
  const metrics = (page) =>
    page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.body.scrollHeight,
      header: document
        .querySelector("header")
        ?.getBoundingClientRect()
        .toJSON(),
      footer: document
        .querySelector("footer")
        ?.getBoundingClientRect()
        .toJSON(),
      images: [...document.images].map((img) => ({
        src: new URL(img.src).pathname,
        rect: img.getBoundingClientRect().toJSON(),
        objectPosition: getComputedStyle(img).objectPosition,
        objectFit: getComputedStyle(img).objectFit,
        parent: img.parentElement.getBoundingClientRect().toJSON(),
      })),
      forms: [...document.forms].length,
      details: [...document.querySelectorAll("details")].length,
    }));
  const originalMetrics = await metrics(reference),
    actualMetrics = await metrics(actual);
  const composite = out + `${key}-${width}-${state}-side-by-side.png`;
  await sharp({
    create: {
      width: width * 2,
      height: Math.max(a.info.height, b.info.height),
      channels: 4,
      background: "#fff",
    },
  })
    .composite([
      { input: paths[0], left: 0, top: 0 },
      { input: paths[1], left: width, top: 0 },
    ])
    .png()
    .toFile(composite);
  results.push({
    page: key,
    route: routes[key],
    viewport: { width },
    state,
    reference: originalMetrics,
    actual: actualMetrics,
    changedIntersectingPixels: changed,
    nonoverlapPixels: extra,
    meanIntersectingChannelDifference: difference / ((intersect / 4) * 3),
    sideBySide: composite,
  });
  console.log(
    `${key} ${width} ${state}: ${changed} changed pixels; heights ${a.info.height}/${b.info.height}`,
  );
}
try {
  for (const width of [1280, 390]) {
    for (const [key, route] of Object.entries(routes)) {
      const context = await browser.newContext({
        viewport: { width, height: width === 1280 ? 1200 : 844 },
        deviceScaleFactor: 1,
      });
      await context.route("https://**/*", (r) => r.abort());
      const reference = await context.newPage(),
        actual = await context.newPage();
      await reference.goto(refOrigin + "/" + key);
      const response = await actual.goto(origin + route);
      if (response.status() !== 200)
        throw Error(`${route} returned ${response.status()}`);
      await capture(reference, actual, key, width, "default");
      if (["home", "services", "contact"].includes(key)) {
        for (const page of [reference, actual])
          await page.evaluate(() =>
            document
              .querySelectorAll("details")
              .forEach((detail) => (detail.open = true)),
          );
        await capture(reference, actual, key, width, "expanded");
      }
      await context.close();
    }
  }
  await writeFile(
    out + "comparison.json",
    JSON.stringify(
      {
        mode: "Unmodified source canvas; scripts removed, local original font/image bytes; viewport meta added to make mobile responsive comparison explicit",
        origin,
        assetChecks,
        results,
      },
      null,
      2,
    ) + "\n",
  );
  if (results.some((r) => r.actual.width > r.viewport.width))
    process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
