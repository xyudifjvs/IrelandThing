/** Real synthetic browser journeys + original-template state/visual comparison.
 * Start a local API/web with the isolated synthetic DB before running.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";
const origin = process.env.WEATHERLY_COMPARE_ORIGIN || "http://127.0.0.1:3314";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw Error("Local synthetic preview required");
const base = "design-reference/2026-11-weatherly/",
  out = ".local/redesign/intake/";
await mkdir(out, { recursive: true });
// Reproducible synthetic bytes only; no dependency on prior local workspaces.
execFileSync("python3", [
  "-c",
  String.raw`
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path('.local/redesign/intake')
text='Synthetic Weatherly redesign verification contract only.'
stream='BT /F1 12 Tf 70 700 Td ('+text+') Tj ET'
objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+str(len(stream))+' >>\nstream\n'+stream+'\nendstream']
pdf='%PDF-1.4\n';offsets=[]
for i,obj in enumerate(objects,1):
 offsets.append(len(pdf.encode()));pdf+=str(i)+' 0 obj\n'+obj+'\nendobj\n'
start=len(pdf.encode());pdf+='xref\n0 6\n0000000000 65535 f \n'+''.join(f'{o:010d} 00000 n \n' for o in offsets)+'trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n'+str(start)+'\n%%EOF'
(root/'mock-contract.pdf').write_text(pdf)
with ZipFile(root/'mock-contract.docx','w',ZIP_DEFLATED) as z:
 z.writestr('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
 z.writestr('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
 z.writestr('word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>')
`,
]);

const sources = {
  buyer: "Weatherly Buyer Intake.html",
  seller: "Weatherly Seller Intake.html",
  "buyer-compliance": "Weatherly Buyer Compliance Intake.html",
  "seller-compliance": "Weatherly Seller Compliance Intake.html",
};
const fontCss = await readFile(
  "apps/web/app/(portal)/portal/_components/reference-intake.css",
  "utf8",
);
const faces = fontCss.slice(0, fontCss.indexOf(".weatherly-intake"));
// Four original scripts were inspected: DOM-only steps, conditional fields, people,
// filenames and preview completion. External resources are removed; network blocked.
const server = createServer(async (req, res) => {
  try {
    const key = req.url.slice(1);
    if (Object.hasOwn(sources, key)) {
      let html = await readFile(base + "originals/" + sources[key], "utf8");
      html = html.replace(/<link[^>]*>/g, "");
      html = html.replace("</head>", `<style>${faces}</style></head>`);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'",
      );
      res.end(html);
    } else if (/^fonts\/intake-[\w-]+\.ttf$/.test(key)) {
      res.setHeader("Content-Type", "font/ttf");
      res.end(await readFile("apps/web/public/" + key));
    } else {
      res.statusCode = 404;
      res.end();
    }
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const refOrigin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_EXECUTABLE ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const checks = [],
  comparisons = process.argv.includes("--journeys-only")
    ? JSON.parse(await readFile(out + "comparison-progress.json", "utf8"))
    : [],
  pageErrors = [];
const context = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
});
try {
  const login = await context.request.post(origin + "/api/auth/sign-in/email", {
    headers: { Origin: origin },
    data: {
      email: "alex.agent@example.test",
      password: "Weatherly-Local-2026!",
    },
  });
  assert.equal(login.status(), 200, await login.text());
  checks.push("Real synthetic agent authentication through web proxy");
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const reference = await context.newPage();
  async function ready(p) {
    await p.evaluate(() => document.fonts.ready);
    await p.addStyleTag({
      content:
        "*,*::before,*::after{animation:none!important;transition:none!important}.save-message[role=status]{visibility:hidden!important}nextjs-portal{display:none!important}",
    });
  }
  async function goto(variant, width = 1280) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin + "/portal/intake?variant=" + variant);
    await expect(page.locator('.step[data-step="0"]')).toBeVisible();
    await expect(page.locator("[data-agent-name]")).toHaveText("Alex Morgan");
    await ready(page);
  }
  async function go(p, n) {
    await p.locator(`[data-go="${n}"]`).click();
    await expect(p.locator(`.step[data-step="${n}"]`)).toBeVisible();
  }
  async function compare(variant, label, width = 1280) {
    await ready(page);
    await ready(reference);
    await page.mouse.move(0, 0);
    await reference.mouse.move(0, 0);
    const stripHeight = await page
      .locator(".proto")
      .evaluate((el) => el.getBoundingClientRect().height);
    await reference.locator(".proto").evaluate((el, height) => {
      el.replaceChildren();
      el.style.height = height + "px";
    }, stripHeight);
    // Normalize only live account identity and the two documented app-only review additions.
    await reference
      .locator(".who")
      .evaluate(
        (el) =>
          (el.innerHTML =
            '<span>Submitting as <b>Alex Morgan</b> · <span>alex.agent@example.test</span></span><span class="hint">From your portal profile</span>'),
      );
    await page.addStyleTag({
      content:
        "[data-full-review],[data-contract-location],[data-contact-review]{display:none!important}",
    });
    const a = await reference.locator("form.wrap").screenshot(),
      b = await page.locator("form.wrap").screenshot();
    const ar = await sharp(a)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
      br = await sharp(b)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    let pixels = 0,
      maximumInteriorChannelDifference = 0,
      pixelsOverTolerance = 0;
    const equalSize =
      ar.info.width === br.info.width && ar.info.height === br.info.height;
    if (equalSize)
      for (let i = 0; i < ar.data.length; i += 4) {
        const delta = Math.max(
          ...[0, 1, 2].map((j) => Math.abs(ar.data[i + j] - br.data[i + j])),
        );
        if (delta) pixels++;
        const x = (i / 4) % ar.info.width,
          y = Math.floor(i / 4 / ar.info.width);
        if (x > 0 && x < ar.info.width - 1 && y > 0 && y < ar.info.height - 1) {
          maximumInteriorChannelDifference = Math.max(
            maximumInteriorChannelDifference,
            delta,
          );
          if (delta > 1) pixelsOverTolerance++;
        }
      }
    const result = {
      variant,
      label,
      width,
      original: { width: ar.info.width, height: ar.info.height },
      actual: { width: br.info.width, height: br.info.height },
      changedPixels: equalSize ? pixels : null,
      maximumInteriorChannelDifference,
      pixelsOverTolerance,
    };
    comparisons.push(result);
    await writeFile(
      out + "comparison-progress.json",
      JSON.stringify(comparisons, null, 2),
    );
    if (true) {
      await writeFile(out + `${variant}-${width}-${label}-original.png`, a);
      await writeFile(out + `${variant}-${width}-${label}-actual.png`, b);
    }
    assert.equal(equalSize, true, variant + " " + label + " crop dimensions");
    assert.equal(
      pixelsOverTolerance,
      0,
      variant + " " + label + " interior RGB tolerance 1/255",
    );
    const railMetrics = async (p) =>
      p
        .locator(".rail")
        .evaluate((el) => ({
          width: el.getBoundingClientRect().width,
          background: getComputedStyle(el).backgroundColor,
          labels: [...el.querySelectorAll(".nav button")].map((b) =>
            b.textContent.trim(),
          ),
        }));
    assert.deepEqual(
      await railMetrics(page),
      await railMetrics(reference),
      variant + " " + label + " rail",
    );
    const visibleConditions = async (p) =>
      p
        .locator("[data-show]")
        .evaluateAll((nodes) =>
          nodes
            .filter(
              (n) =>
                !n.dataset.show.startsWith("service=") &&
                !n.dataset.show.startsWith("side="),
            )
            .map((n) => ({ condition: n.dataset.show, hidden: n.hidden })),
        );
    assert.deepEqual(
      await visibleConditions(page),
      await visibleConditions(reference),
      variant + " " + label + " conditions",
    );
  }
  if (!process.argv.includes("--journeys-only"))
    for (const variant of Object.keys(sources)) {
      console.log("Checking", variant);
      await goto(variant);
      await reference.setViewportSize({ width: 1280, height: 1000 });
      await reference.goto(refOrigin + "/" + variant);
      await ready(reference);
      for (let step = 0; step < 6; step++) {
        await go(page, step);
        await go(reference, step);
        await compare(variant, "step-" + step);
      }
      // Every conditional choice at its actual step; no fabricated completion/transactions.
      for (const [step, names] of [
        [0, ["cash", "docsDotloop", "occ"]],
        [1, ["coop", "addl"]],
        [2, ["title", "lender", "emd"]],
        [3, ["hoa", "hoaDocs", "hoaSent"]],
        [4, ["mls", "gift", "tier"]],
      ]) {
        await go(page, step);
        await go(reference, step);
        for (const name of names) {
          if (["hoaDocs", "hoaSent"].includes(name))
            for (const p of [page, reference])
              await p.locator('[name="hoa"][value="yes"]').check();
          if (name === "hoaSent")
            for (const p of [page, reference])
              await p.locator('[name="hoaDocs"][value="upload"]').check();
          if (name === "tier")
            for (const p of [page, reference])
              await p.locator('[name="gift"][value="yes"]').check();
          const controls = await reference.locator(`[name="${name}"]`).all();
          for (const control of controls) {
            const type = await control.getAttribute("type"),
              value = await control.getAttribute("value");
            if (type === "checkbox") {
              for (const checked of [true, false]) {
                await page
                  .locator(`[name="${name}"]`)
                  .setChecked(checked, { force: true });
                await control.setChecked(checked, { force: true });
                await compare(variant, name + "-" + checked);
              }
            } else if (type === "radio") {
              // Reveal parent sections before nested choices.
              if (!(await control.isVisible())) continue;
              await page
                .locator(`[name="${name}"][value="${value}"]`)
                .check({ force: true });
              await control.check({ force: true });
              await compare(variant, name + "-" + value);
            }
          }
        }
      }
      await go(page, 1);
      await go(reference, 1);
      for (const p of [page, reference]) {
        await p.locator("#addBuyer").click();
        await p.locator('[name="buyerRel"]').selectOption("other");
        await p.locator('[name="buyerRelOther"]').fill("Parent and child");
      }
      await compare(variant, "multiple-clients-other-relationship");
      checks.push(
        variant + ": all six steps and conditional choices match visibility",
      );
      await goto(variant, 390);
      await reference.setViewportSize({ width: 390, height: 1000 });
      await reference.goto(refOrigin + "/" + variant);
      await reference.addStyleTag({
        content:
          "@media(max-width:760px){.shell{grid-template-columns:minmax(0,1fr)}.rail{min-width:0}}",
      });
      await compare(variant, "step-0", 390);
      for (let step = 1; step < 6; step++) {
        await go(page, step);
        await go(reference, step);
        await compare(variant, "step-" + step, 390);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
      }
    }
  // A full real seller compliance journey with uploaded-only HOA/utilities, saved
  // hidden values, all contacts, resume, retry, revision conflict and durable receipt.
  await goto("seller-compliance");
  await page.locator('[name="a_num"]').fill("1420");
  await page.locator('[name="a_street"]').fill("Synthetic Maple Ave");
  await page.locator('[name="a_city"]').fill("Columbus");
  await page.locator('[name="a_state"]').fill("OH");
  await page.locator('[name="a_zip"]').fill("43215");
  await page.locator('[name="occ"][value="Occupied"]').check();
  await page.locator('[name="docsDotloop"]').check();
  await page
    .locator('[name="contractLocation"]')
    .fill("Dotloop: synthetic executed contract folder");
  await go(page, 1);
  await page.locator('[name="b1_name"]').fill("Synthetic Seller");
  await page.locator('[name="b1_email"]').fill("seller@example.test");
  await page.locator('[name="b1_phone"]').fill("555-0111");
  await page.locator("#addBuyer").click();
  await page.locator('[name="b2_name"]').fill("Second Seller");
  await page.locator('[name="buyerRel"]').selectOption("other");
  await page.locator('[name="buyerRelOther"]').fill("Parent and child");
  await page.locator('[name="coop"][value="type"]').check();
  await page.locator('[name="co_name"]').fill("Coop Agent");
  await page.locator('[name="co_email"]').fill("coop@example.test");
  await page.locator('[name="addl"][value="yes"]').check();
  for (const [name, value] of Object.entries({
    c1_name: "Additional Contact",
    c1_email: "contact@example.test",
    c1_phone: "555-0222",
    c1_rel: "Parent",
  }))
    await page.locator(`[name="${name}"]`).fill(value);
  await go(page, 2);
  await page.locator('[name="title"][value="mls"]').check();
  await page.locator('[name="lender"][value="have"]').check();
  await page.locator('[name="l_co"]').fill("Earlier hidden lender");
  await page.locator('[name="lender"][value="preapproval"]').check();
  await page.locator('[name="fee"]').fill("$500");
  await page.locator('[name="listcomm"]').fill("3%");
  await go(page, 3);
  await page.locator('[name="hoa"][value="yes"]').check();
  await page.locator('[name="hoaDocs"][value="upload"]').check();
  await page.locator("#hoaFiles").setInputFiles({
    name: "legacy.doc",
    mimeType: "application/msword",
    buffer: Buffer.from("legacy"),
  });
  await expect(page.getByText(/older Word/)).toBeVisible();
  await page.locator("[data-remove-queue]").click();
  const fixture = out + "mock-contract.pdf";
  // First upload fails once; retry retains stable upload request id.
  let failOnce = true;
  await page.route("**/api/v1/documents", async (route) => {
    if (route.request().method() === "POST" && failOnce) {
      failOnce = false;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.locator("#hoaFiles").setInputFiles(fixture);
  await expect(page.locator("[data-retry]")).toBeVisible();
  await page.locator("[data-retry]").click();
  await expect(page.locator("#list-hoaFiles")).toContainText("Saved privately");
  await page.unroute("**/api/v1/documents");
  await page.locator('[name="hoaSent"][value="yes"]').check();
  await page.locator('[name="hoaDate"]').fill("2026-11-04");
  await go(page, 4);
  await page.locator('[name="notes"]').fill("constructor");
  await page
    .locator('[name="utilNotes"]')
    .fill("Synthetic utilities and previous policy instructions");
  await page.locator("#utilFiles").setInputFiles(out + "mock-contract.docx");
  await expect(page.locator("#list-utilFiles")).toContainText(
    "Saved privately",
  );
  await page.locator('[name="giftAgree"]').check();
  await page.locator("#payBtn").click();
  await expect(page.locator("#payNote")).toContainText(
    "Payment link to be added",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator(".save-message[role=status]")).toContainText(
    "Saved",
  );
  const savedDrafts = await (
    await context.request.get(origin + "/api/v1/intake/drafts")
  ).json();
  const draft = savedDrafts.find(
    (x) => x.payload.referenceIntake?.fields.a_street === "Synthetic Maple Ave",
  );
  assert.ok(draft);
  await page.reload();
  await page
    .getByRole("button", { name: "Resume & preferences", exact: true })
    .click();
  await page
    .getByRole("button", { name: /1420 Synthetic Maple Ave/ })
    .first()
    .click();
  await expect(page.locator('[name="a_street"]')).toHaveValue(
    "Synthetic Maple Ave",
  );
  await go(page, 5);
  await expect(page.locator("#review")).toContainText("mock-contract.docx");
  await expect(page.locator("#review")).toContainText("Uploaded (1 file)");
  await page.locator("[data-full-review] summary").click();
  await expect(page.locator("[data-full-review]")).toContainText("555-0222");
  await expect(page.locator("[data-full-review]")).toContainText("constructor");
  await expect(page.locator("[data-full-review]")).toContainText(
    "Earlier hidden lender",
  );
  await page.screenshot({
    path: out + "seller-compliance-real-review.png",
    fullPage: true,
  });
  const submitted = page.waitForResponse(
    (r) => r.url().endsWith("/submit") && r.request().method() === "POST",
  );
  await page.locator("#next").click();
  const response = await submitted;
  assert.equal(response.status(), 200, await response.text());
  const result = await response.json();
  await expect(page.locator(".done-card")).toBeVisible();
  assert.ok(result.submission.id);
  assert.equal(
    result.submission.snapshot.referenceIntake.fields.c1_phone,
    "555-0222",
  );
  assert.equal(
    result.submission.snapshot.referenceIntake.fields.notes,
    "constructor",
  );
  assert.equal(result.submission.snapshot.lender.name, undefined);
  assert.equal(result.submission.snapshot.documentIds.length, 2);
  const repeat = await context.request.post(
    origin + `/api/v1/intake/drafts/${draft.id}/submit`,
    {
      headers: { Origin: origin },
      data: {
        expectedRevision: draft.revision,
        idempotencyKey: "intake-submit-" + draft.id,
      },
    },
  );
  assert.equal(repeat.status(), 200);
  assert.equal((await repeat.json()).submission.id, result.submission.id);
  const documents = await (
    await context.request.get(
      origin + `/api/v1/documents?matterId=${result.matter.id}`,
    )
  ).json();
  assert.equal(documents.length, 2);
  for (const doc of documents)
    assert.equal(
      (
        await context.request.get(
          origin + `/api/v1/documents/${doc.id}/download`,
        )
      ).status(),
      200,
    );
  checks.push(
    "Real seller compliance: structured address, multiple sellers/relationship, co-op, additional contacts, title/lender, commission, HOA date, utilities/prior-policy upload, gift acknowledgment; failed-upload retry; save/resume; uploaded-only documents retained; idempotent durable receipt and downloads",
  );
  await page.goto(origin + "/portal/transactions/" + result.matter.id);
  await expect(
    page.getByText("Submitted intake", { exact: true }),
  ).toBeVisible();
  await page
    .getByText("All saved answers and documents", { exact: true })
    .click();
  await expect(page.getByText("555-0222", { exact: true })).toBeVisible();
  checks.push("Agent transaction displays full saved reference record");
  const owner = await browser.newContext();
  assert.equal(
    (
      await owner.request.post(origin + "/api/auth/sign-in/email", {
        headers: { Origin: origin },
        data: {
          email: "ireland@example.test",
          password: "Weatherly-Local-2026!",
        },
      })
    ).status(),
    200,
  );
  const request = await owner.request.post(
    origin + `/api/v1/matters/${result.matter.id}/tasks`,
    {
      headers: { Origin: origin },
      data: {
        title: "Deposit synthetic earnest money",
        kind: "client_request",
        visibility: "client",
      },
    },
  );
  assert.equal(request.status(), 201);
  const clientTask = await request.json();
  const shared = await owner.request.post(
    origin + `/api/v1/matters/${result.matter.id}/checklist-share`,
    { headers: { Origin: origin }, data: {} },
  );
  assert.equal(shared.status(), 201);
  const share = await shared.json();
  const publicContext = await browser.newContext(),
    clientPage = await publicContext.newPage();
  await clientPage.goto(share.url);
  await expect(
    clientPage.getByRole("region", { name: "What we need from you" }),
  ).toContainText("Deposit synthetic earnest money");
  await clientPage.screenshot({
    path: out + "client-live-request.png",
    fullPage: true,
  });
  const completed = await owner.request.patch(
    origin + `/api/v1/matters/${result.matter.id}/tasks/${clientTask.id}`,
    {
      headers: { Origin: origin },
      data: { expectedRevision: clientTask.revision, status: "completed" },
    },
  );
  assert.equal(completed.status(), 200);

  await expect(
    clientPage.getByRole("region", { name: "What we need from you" }),
  ).toContainText("Nothing requested right now.");
  await expect(
    clientPage.getByRole("region", { name: "Client checklist" }),
  ).toContainText("Completed");
  const synced = await (
    await context.request.get(origin + `/api/v1/matters/${result.matter.id}`)
  ).json();
  assert.equal(
    synced.tasks.find((x) => x.id === clientTask.id).status,
    "completed",
  );
  assert.equal(
    (
      await publicContext.request.get(
        origin + "/api/v1/matters/" + result.matter.id,
      )
    ).status(),
    401,
  );
  await clientPage.screenshot({
    path: out + "client-live-completed.png",
    fullPage: true,
  });
  await publicContext.close();
  await owner.close();
  checks.push(
    "Real client link: no login, explicit client action visible, coordinator completion synchronizes agent and client from same task, full matter API remains private",
  );
  // The confirmed minimum replaces the earlier blank-final acceptance policy.
  for (const variant of Object.keys(sources)) {
    await goto(variant);
    await go(page, 5);
    await page.locator("#next").click();
    await expect(page.locator(".save-message[role=alert]")).toContainText(
      "Upload the executed contract",
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.locator(".save-message[role=status]")).toContainText(
      "Saved",
    );
    await go(page, 0);
    await page
      .locator('[name="contractLocation"]')
      .fill("Synthetic executed contract location for coordinator review");
    await go(page, 5);
    const submitted = page.waitForResponse(
      (r) => r.url().endsWith("/submit") && r.request().method() === "POST",
    );
    await page.locator("#next").click();
    const res = await submitted;
    assert.equal(res.status(), 200, await res.text());
    const saved = await res.json();
    assert.equal(
      saved.submission.snapshot.serviceSnapshot.priceCents,
      variant.endsWith("compliance") ? 51500 : 42500,
    );
    await expect(page.locator(".done-card")).toBeVisible();
  }
  checks.push(
    "All four drafts save incomplete; blank final rejected; explicit contract location permits confirmed minimum; new service price snapshots 42500/51500",
  );
  await goto("buyer");
  await page
    .locator('[name="a_street"]')
    .fill("Retained while changing variant");
  await page.locator('[name="side"][value="seller"]').check();
  await page.locator('[name="service"][value="ctcc"]').check();
  await expect(page.locator('[name="a_street"]')).toHaveValue(
    "Retained while changing variant",
  );
  await expect(page.locator('[name="service"][value="ctcc"]')).toBeChecked();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  checks.push(
    "Changing buyer/seller and service retains answers and approved catalog mapping",
  );
  await page.goto(origin + "/portal/intake?package=full_listing");
  await expect(page.locator(".proto")).toContainText(
    "Full Listing coming soon",
  );
  await expect(
    page.locator('[name="package"][value="full_listing"]'),
  ).toHaveCount(0);
  checks.push("Full Listing has no new order path");
  const anonymous = await browser.newContext();
  assert.equal(
    (await anonymous.request.get(origin + "/api/v1/intake/drafts")).status(),
    401,
  );
  const anonPage = await anonymous.newPage();
  await anonPage.goto(origin + "/portal/intake");
  await expect(anonPage.locator("#form")).toHaveCount(0);
  await anonymous.close();
  const client = await browser.newContext();
  assert.equal(
    (
      await client.request.post(origin + "/api/auth/sign-in/email", {
        headers: { Origin: origin },
        data: {
          email: "avery.client@example.test",
          password: "Weatherly-Local-2026!",
        },
      })
    ).status(),
    200,
  );
  assert.equal(
    (await client.request.get(origin + "/api/v1/intake/drafts")).status(),
    403,
  );
  await client.close();
  assert.equal(
    (
      await context.request.post(origin + "/api/v1/intake/drafts", {
        headers: { Origin: "https://foreign.example" },
        data: { payload: {} },
      })
    ).status(),
    403,
  );
  checks.push(
    "Unauthenticated/client intake denial and exact same-origin write protection",
  );
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ checks, comparisons, pageErrors }, null, 2));
  await writeFile(
    out + "results.json",
    JSON.stringify({ checks, comparisons, pageErrors }, null, 2),
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
