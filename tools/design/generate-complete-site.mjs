/** Decode the supplied static website without evaluating any bundle/runtime JS. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import {
  assertSafeStaticMarkup,
  assertLocalCss,
} from "./static-reference-safety.mjs";
const base = "design-reference/2026-11-weatherly/complete-site/";
const original = await readFile(
  base + "Weatherly Transaction Co. Website.html",
  "utf8",
);
const provenance = JSON.parse(await readFile(base + "provenance.json", "utf8"));
if (
  Buffer.byteLength(original) !== provenance.bytes ||
  createHash("sha256").update(original).digest("hex") !== provenance.sha256
)
  throw Error("Original website provenance mismatch.");
const scripts = (html) =>
  Object.fromEntries(
    [
      ...html.matchAll(
        /<script[^>]+type="(__bundler\/[^\"]+)"[^>]*>([\s\S]*?)<\/script>/g,
      ),
    ].map((m) => [m[1].split("/")[1], JSON.parse(m[2])]),
  );
const outer = scripts(original),
  keys = [
    "home",
    "services",
    "process",
    "onboarding",
    "agentPortal",
    "contact",
  ];
if (outer.page_order.length !== keys.length)
  throw Error("Unexpected reference page count.");
const safety = {};
const pages = {},
  referencePages = {},
  assets = {};
let fonts = "";
await mkdir("apps/web/public/brand/site", { recursive: true });
for (const [i, id] of outer.page_order.entries()) {
  const packed = outer.manifest[id];
  let bytes = Buffer.from(packed.data, "base64");
  if (packed.compressed) bytes = gunzipSync(bytes);
  const nested = scripts(bytes.toString("utf8")),
    template = nested.template,
    replacements = {};
  for (const [assetId, asset] of Object.entries(nested.manifest)) {
    if (!/^(image\/|font\/)/.test(asset.mime)) continue;
    if (!["image/png", "image/jpeg", "font/woff2"].includes(asset.mime))
      throw Error("Unsupported embedded asset MIME: " + asset.mime);
    let data = Buffer.from(asset.data, "base64");
    if (asset.compressed) data = gunzipSync(data);
    const sha = createHash("sha256").update(data).digest("hex"),
      ext =
        asset.mime === "image/png"
          ? "png"
          : asset.mime === "image/jpeg"
            ? "jpg"
            : "woff2";
    const name = `${sha.slice(0, 20)}.${ext}`,
      url = "/brand/site/" + name;
    await writeFile("apps/web/public/brand/site/" + name, data);
    replacements[assetId] = url;
    assets[assetId] = {
      url,
      mime: asset.mime,
      sha256: sha,
      bytes: data.length,
    };
  }
  const replaceAssets = (text) =>
    Object.entries(replacements).reduce(
      (s, [id, url]) => s.replaceAll(id, url),
      text,
    );
  if (!i)
    fonts = [...template.matchAll(/@font-face\s*\{[\s\S]*?\}/g)]
      .map((m) => m[0])
      .filter((block) => !block.includes("https://"))
      .map(replaceAssets)
      .join("\n");
  const start = template.indexOf('<div style="background:'),
    end = template.indexOf("</x-dc>");
  let canvas = replaceAssets(template.slice(start, end).trim());
  const resources = new Set(Object.values(assets).map((asset) => asset.url));
  assertSafeStaticMarkup(canvas, resources, {
    allowedLinks: new Set([
      "Main.dc.html",
      "Services.dc.html",
      "Process.dc.html",
      "Onboarding.dc.html",
      "Portal.dc.html",
      "Contact.dc.html",
      "https://calendly.com/",
    ]),
  });
  const headerEnd = canvas.indexOf("</header>") + 9,
    footerStart = canvas.lastIndexOf("<footer");
  let body = canvas.slice(headerEnd, footerStart).trim();
  const bg = /background:\s*(#[A-Fa-f0-9]+)/.exec(canvas)?.[1] || "#F9F6F0";
  referencePages[keys[i]] = {
    title: /<title>([\s\S]*?)<\/title>/.exec(template)?.[1] || keys[i],
    background: bg,
    canvas,
    body,
  };
  const routeMap = {
    "Main.dc.html": "/",
    "Services.dc.html": "/services",
    "Process.dc.html": "/process",
    "Onboarding.dc.html": "/onboarding",
    "Portal.dc.html": "/agent-portal",
    "Contact.dc.html": "/contact",
  };
  for (const [from, to] of Object.entries(routeMap))
    body = body.replaceAll('href="' + from + '"', 'href="' + to + '"');
  const changes = [];
  const change = (from, to, why) => {
    if (!body.includes(from)) throw Error(`Missing ${keys[i]} copy: ${from}`);
    body = body.replaceAll(from, to);
    changes.push(why);
  };
  if (keys[i] === "home") {
    body = body.replace(
      '<section style="background: #F2EBE0;',
      '<section id="testimonials" style="background: #F2EBE0;',
    );
  }
  if (keys[i] === "services") {
    change(
      "your brokerage's compliance checklist",
      "Howard Hanna's compliance checklist",
      "Single-brokerage compliance wording.",
    );
    change(
      "your brokerage's approval and account permissions",
      "Howard Hanna's approval and account permissions",
      "Howard Hanna permissions remain required.",
    );
    body = body.replaceAll(
      "If the transaction terminates, no coordination fee is owed.",
      "If the transaction terminates before closing, no coordination fee is owed.",
    );
    changes.push("Approved pre-closing termination fee wording.");
  }
  if (keys[i] === "onboarding") {
    body = body.replace(
      'href="https://calendly.com/"',
      'href="#book-call" data-book-call',
    );
    body = body.replace(
      'id="ob_email2"',
      'id="ob_email2" name="email" required',
    );
    body = body
      .replace('id="ra_name"', 'id="ra_name" name="name" required')
      .replace('id="ra_email"', 'id="ra_email" name="email" required')
      .replace(
        'id="ra_brokerage"',
        'id="ra_brokerage" name="brokerage" value="Howard Hanna" readonly',
      )
      .replace('id="ra_team"', 'id="ra_team" name="team"')
      .replace('id="ra_office"', 'id="ra_office" name="officeAddress"');
    let formIndex = 0;
    body = body.replace(
      /<form\b/g,
      () =>
        `<form data-reference-form="${formIndex++ === 0 ? "information" : "service_agreement"}"`,
    );
    body = body.replaceAll('type="button"', 'type="submit"');
  }
  if (keys[i] === "agentPortal") {
    body = body.replace("<form ", '<form data-reference-form="login" ');
    body = body
      .replace(
        'id="pt_email"',
        'id="pt_email" name="email" autocomplete="username" required',
      )
      .replace(
        'id="pt_pass"',
        'id="pt_pass" name="password" autocomplete="current-password" required',
      );
    body = body.replaceAll('type="button"', 'type="submit"');
  }
  if (keys[i] === "contact") {
    body = body.replace("<form ", '<form data-reference-form="contact" ');
    body = body
      .replace('id="ct_name"', 'id="ct_name" name="name" required')
      .replace('id="ct_email"', 'id="ct_email" name="email" required')
      .replace('id="ct_msg"', 'id="ct_msg" name="message" required');
    body = body.replaceAll('type="button"', 'type="submit"');
  }
  body = body.replace(
    /<\/form>/g,
    "<div data-form-status hidden></div></form>",
  );
  if (keys[i] === "agentPortal")
    body = body.replace(
      "<div data-form-status hidden>",
      "<div data-login-challenge hidden></div><div data-form-status hidden>",
    );
  if (keys[i] === "onboarding")
    body = body
      .replace(
        "Your Calendly scheduler will appear here so agents can pick a date and time.",
        "Your Calendly scheduler will appear here so agents can pick a date and time.",
      )
      .replace(
        "CALENDLY BOOKING CALENDAR</p>",
        "CALENDLY BOOKING CALENDAR</p><div data-booking-request hidden></div>",
      );
  const normalizedChrome = (
    canvas.slice(0, headerEnd) + canvas.slice(footerStart)
  ).replaceAll(/href="([^"]+\.dc\.html)"/g, (_, name) => {
    if (!routeMap[name]) throw Error("Unknown chrome route.");
    return `href="${routeMap[name]}"`;
  });
  safety[keys[i]] = {
    body: assertSafeStaticMarkup(body, resources),
    chrome: assertSafeStaticMarkup(normalizedChrome, resources),
    changes: changes.filter(Boolean),
  };
  pages[keys[i]] = {
    title: referencePages[keys[i]].title,
    background: bg,
    body,
    changes: changes.filter(Boolean),
  };
}
await writeFile(
  "apps/web/app/(marketing)/_components/complete-site-reference.ts",
  "// Generated inert markup from the byte-preserved complete site; no source scripts are executed.\nexport const completeSite = " +
    JSON.stringify(pages, null, 2) +
    " as const;\nexport type CompleteSitePage = keyof typeof completeSite;\n",
);
assertLocalCss(fonts, new Set(Object.values(assets).map((asset) => asset.url)));
await writeFile(
  "apps/web/app/(marketing)/_components/complete-site-fonts.css",
  fonts + "\n",
);
await writeFile(
  base + "decoded-pages.json",
  JSON.stringify(referencePages, null, 2) + "\n",
);
await writeFile(base + "assets.json", JSON.stringify(assets, null, 2) + "\n");
for (const asset of Object.values(assets)) {
  const actual = await readFile("apps/web/public" + asset.url);
  if (
    actual.length !== asset.bytes ||
    createHash("sha256").update(actual).digest("hex") !== asset.sha256
  )
    throw Error("Extracted asset provenance mismatch.");
}
await writeFile(
  base + "static-safety.json",
  JSON.stringify(safety, null, 2) + "\n",
);
console.log(
  "Decoded six static pages, local assets and source font declarations.",
);
