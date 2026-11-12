import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext } from "playwright";
import { expect } from "@playwright/test";

const supplied = process.env.WEATHERLY_ACCEPTANCE_ORIGIN;
if (!supplied)
  throw new Error(
    "Set WEATHERLY_ACCEPTANCE_ORIGIN to the synthetic local web preview.",
  );
const origin = new URL(supplied);
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
if (!loopback.has(origin.hostname))
  throw new Error("Browser acceptance requires a loopback origin.");

const browser = await chromium.launch({
  executablePath: process.env.WEATHERLY_CHROME_PATH || undefined,
  headless: true,
  args: ["--disable-background-networking", "--disable-sync"],
});
const password = "Weatherly-Local-2026!";

async function session(email?: string, mobile = false) {
  const context = await browser.newContext({
    baseURL: origin.origin,
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1280, height: 900 },
  });
  await context.route("**/*", (route) =>
    loopback.has(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  if (email)
    await api(context, "POST", "/api/auth/sign-in/email", 200, {
      email,
      password,
    });
  return context;
}

async function api(
  context: BrowserContext,
  method: string,
  path: string,
  status: number,
  data?: unknown,
) {
  const response = await context.request.fetch(path, {
    method,
    data,
    headers: { Origin: origin.origin },
  });
  const body = await response.json();
  assert.equal(
    response.status(),
    status,
    `${method} ${path}: ${JSON.stringify(body)}`,
  );
  return body;
}

try {
  const owner = await session("ireland@example.test");
  const agent = await session("alex.agent@example.test", true);
  const client = await session("avery.client@example.test", true);
  const publicContext = await session(undefined, true);
  const coordinator = await owner.newPage();
  const agentPage = await agent.newPage();
  const clientPage = await client.newPage();
  const publicPage = await publicContext.newPage();
  for (const page of [coordinator, agentPage, clientPage, publicPage])
    page.setDefaultTimeout(25_000);

  await coordinator.goto("/workspace");
  await coordinator.getByText("Local preview · synthetic data").waitFor();
  const propertyAddress = `Synthetic Browser ${randomUUID().slice(0, 8)} Lane`;
  const review = await api(owner, "POST", "/api/v1/creation-reviews", 200, {
    requestId: randomUUID(),
  });
  const { matterId } = await api(
    owner,
    "POST",
    `/api/v1/creation-reviews/${review.id}/confirm`,
    200,
    {
      expectedRevision: review.revision,
      requestId: randomUUID(),
      business: { business: "hto", packageCode: "hto_included" },
      facts: {
        title: "Synthetic browser transaction",
        propertyAddress,
        side: "buyer",
        agentId: "agent-local",
        agentRosterId: null,
        purchaseType: "cash",
        purchasePriceCents: 21500000,
        acceptance: null,
        deadlineTimeZone: "America/New_York",
      },
      people: [],
      dates: [
        {
          key: "closing",
          value: { date: "2027-05-21", instant: null },
          rule: { kind: "fixed" },
        },
      ],
    },
  );
  const file = `/api/v1/matters/${matterId}`;
  await api(owner, "POST", `${file}/participants`, 201, {
    userId: "client-local",
    role: "client",
  });

  await coordinator.goto(`/workspace/transactions/${matterId}?tab=emails`);
  await coordinator.getByRole("heading", { name: propertyAddress }).waitFor();
  for (const tab of [
    "Checklist",
    "Emails",
    "Documents",
    "Intake",
    "Compliance",
  ])
    await coordinator.getByRole("tab", { name: tab, exact: true }).waitFor();
  assert.equal(
    await coordinator
      .getByRole("tab", { name: "Emails", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await coordinator
    .getByRole("heading", { name: "People on this deal" })
    .waitFor();

  const documentName = "Synthetic browser document.pdf";
  const attachment = await owner.request.post("/api/v1/documents", {
    headers: { Origin: origin.origin },
    multipart: {
      matterId,
      category: "other",
      uploadRequestId: randomUUID(),
      file: {
        name: documentName,
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\n% Synthetic\n%%EOF"),
      },
    },
  });
  assert.equal(attachment.status(), 201, await attachment.text());
  await coordinator
    .getByRole("tab", { name: "Documents", exact: true })
    .click();
  await coordinator.getByText(documentName, { exact: true }).waitFor();
  const clientSwitch = coordinator.getByRole("checkbox", {
    name: "Show on client portal",
  });
  assert.equal(await clientSwitch.isChecked(), false);
  await clientSwitch.click();
  await expect(clientSwitch).toBeChecked({ timeout: 20_000 });

  const share = await api(owner, "POST", `${file}/checklist-share`, 201, {});
  await agentPage.goto(`/portal/transactions/${matterId}`);
  await agentPage.getByRole("heading", { name: propertyAddress }).waitFor();
  await clientPage.goto(`/portal/transactions/${matterId}`);
  await clientPage.getByText(documentName, { exact: true }).waitFor();
  await publicPage.goto(share.url);
  await publicPage.getByText(documentName, { exact: true }).waitFor();
  assert.equal(
    await agentPage.getByText(documentName, { exact: true }).count(),
    0,
  );
  for (const page of [agentPage, clientPage, publicPage]) {
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      true,
    );
  }

  const current = await api(owner, "GET", file, 200);
  const closed = await api(owner, "POST", `${file}/close-out`, 200, {
    expectedRevision: current.revision,
  });
  assert.equal(closed.stage, "closed");
  await coordinator.reload();
  await clientSwitch.waitFor();
  await clientSwitch.click();
  await expect(clientSwitch).not.toBeChecked({ timeout: 20_000 });
  await clientPage
    .getByText(documentName, { exact: true })
    .waitFor({ state: "hidden" });
  await publicPage
    .getByText(documentName, { exact: true })
    .waitFor({ state: "hidden" });
  const { id: documentId } = await attachment.json();
  const token = new URL(share.url).hash.slice(1);
  const denied = await publicContext.request.get(
    `/api/public/checklist/documents/${documentId}/download`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  assert.equal(denied.status(), 404);
  await api(owner, "DELETE", file, 200, {
    expectedRevision: closed.revision,
    confirmation: "DELETE",
  });
  await api(owner, "GET", file, 404);
  console.log(
    "Real browser passed coordinator tabs, mobile agent and client portals, bearer sharing and terminal withdrawal.",
  );
} finally {
  await browser.close();
}
