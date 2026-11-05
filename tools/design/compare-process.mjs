/** Compare the static supplied Process page with a running web build. Never executes export JS.
 * WEATHERLY_COMPARE_ORIGIN=http://127.0.0.1:3000 node tools/design/compare-process.mjs
 */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const referenceRoot = "design-reference/2026-11-weatherly/";
const output = ".local/weatherly-redesign/marketing/";
const origin = process.env.WEATHERLY_COMPARE_ORIGIN || "http://127.0.0.1:3000";
const target = new URL(origin);
if (!["127.0.0.1", "localhost"].includes(target.hostname))
  throw new Error("Use a local synthetic preview for design comparisons.");
const fonts = {
  "d1d1c8ac-523d-4152-8929-bdc902ac0ab2":
    "process-cormorant-italic-latin.woff2",
  "21aa33ab-306c-4e8d-8573-42b616d675cc": "process-cormorant-latin.woff2",
  "f322d5c5-adaf-4d28-85e6-857a6babce34": "process-montserrat-latin.woff2",
};
let template = JSON.parse(
  await readFile(referenceRoot + "template.json", "utf8"),
);
template = template.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
for (const [id, file] of Object.entries(fonts))
  template = template.replaceAll('"' + id + '"', '"/' + file + '"');
const server = createServer(async (req, res) => {
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(template);
  } else if (Object.values(fonts).includes(req.url?.slice(1))) {
    res.setHeader("Content-Type", "font/woff2");
    res.end(await readFile("apps/web/public/fonts" + req.url));
  } else {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const referenceOrigin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_EXECUTABLE ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
await mkdir(output, { recursive: true });
const results = [];
try {
  for (const [width, height] of [
    [1280, 1200],
    [390, 844],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    const reference = await context.newPage(),
      actual = await context.newPage();
    await reference.goto(referenceOrigin);
    await actual.goto(origin + "/process");
    for (const page of [reference, actual])
      await page.evaluate(() => document.fonts.ready);
    await actual
      .locator("nextjs-portal")
      .evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
    const metrics = (page) =>
      page.evaluate(() => ({
        body: document.body.scrollHeight,
        width: document.documentElement.scrollWidth,
        ...Object.fromEntries(
          ["header", "section", "footer", "h1"].map((name) => [
            name,
            document.querySelector(name)?.getBoundingClientRect().toJSON(),
          ]),
        ),
      }));
    const paths = [
      output + `process-original-${width}.png`,
      output + `process-actual-${width}.png`,
    ];
    await reference.screenshot({ path: paths[0], fullPage: true });
    await actual.screenshot({ path: paths[1], fullPage: true });
    const a = await sharp(paths[0])
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const b = await sharp(paths[1])
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let changed = 0,
      total = 0;
    for (let i = 0; i < Math.min(a.data.length, b.data.length); i += 4) {
      let different = false;
      for (let j = 0; j < 3; j++) {
        const delta = Math.abs(a.data[i + j] - b.data[i + j]);
        total += delta;
        if (delta) different = true;
      }
      if (different) changed++;
    }
    const sameDimensions =
      a.info.width === b.info.width && a.info.height === b.info.height;
    results.push({
      width,
      reference: await metrics(reference),
      actual: await metrics(actual),
      imageOriginal: a.info,
      imageActual: b.info,
      sameDimensions,
      changedPixels: changed,
      meanChannelDifference:
        total / ((Math.min(a.data.length, b.data.length) / 4) * 3),
    });
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
      .toFile(output + `process-side-by-side-${width}.png`);
    await context.close();
  }
  await writeFile(
    output + "comparison.json",
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(JSON.stringify(results, null, 2));
  if (results.some((r) => !r.sameDimensions || r.changedPixels !== 0))
    process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
