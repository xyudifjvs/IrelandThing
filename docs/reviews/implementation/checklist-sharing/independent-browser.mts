import assert from "node:assert/strict";
import { chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { isolatedReview, checkoutRoot } from "./harness.mts";

await isolatedReview(async ({ api, web, candidate, logs }) => {
  const results: string[] = [];
  async function request(route: string, cookie = "", method = "GET", body?: unknown) {
    const response = await fetch(api + route, { method, headers: { Origin: web, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json(); assert.ok(response.ok, `Synthetic API request failed ${method} ${route}: ${response.status}`); return { response, data };
  }
  async function signIn(email: string) {
    const { response } = await request("/api/auth/sign-in/email", "", "POST", { email, password: "Weatherly-Local-2026!" });
    return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  }
  async function authenticate(context: BrowserContext, cookie: string) {
    await context.addCookies(cookie.split("; ").map((value) => { const index = value.indexOf("="); return { name: value.slice(0, index), value: value.slice(index + 1), url: web, httpOnly: true, sameSite: "Lax" as const }; }));
  }
  const ownerCookie = await signIn("ireland@example.test"), agentCookie = await signIn("alex.agent@example.test");
  const { data: matter } = await request("/api/v1/matters", ownerCookie, "POST", { title: "Synthetic Weatherly client checklist", propertyAddress: "1 Synthetic Review Lane, Columbus, OH", side: "buyer", packageCode: "complete", agentId: "agent-local", details: { private: "NEVER_PUBLIC_DETAILS" } });
  const matterPath = `/api/v1/matters/${matter.id}`;
  for (const task of (await request(matterPath, ownerCookie)).data.tasks)
    await request(`${matterPath}/tasks/${task.id}`, ownerCookie, "DELETE", { expectedRevision: task.revision });
  const { data: alpha } = await request(`${matterPath}/tasks`, ownerCookie, "POST", { title: "CLIENT_ALPHA", visibility: "client", dueDate: "2026-12-11" });
  await request(`${matterPath}/tasks`, ownerCookie, "POST", { title: "NEVER_PUBLIC_AGENT", visibility: "agent" });
  await request(`${matterPath}/tasks`, ownerCookie, "POST", { title: "NEVER_PUBLIC_PRIVATE", visibility: "coordinator" });
  const { data: deadline } = await request(`${matterPath}/deadlines`, ownerCookie, "POST", { label: "Closing review date", date: "2026-12-15", status: "confirmed" });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHECKER_CHROMIUM_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell") });
  const contexts: BrowserContext[] = [];
  try {
    const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), agentContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] }), clientContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    contexts.push(ownerContext, agentContext, clientContext);
    await authenticate(ownerContext, ownerCookie); await authenticate(agentContext, agentCookie);
    const owner = await ownerContext.newPage(), agent = await agentContext.newPage(), client = await clientContext.newPage();
    const errors: string[] = [], requests: { url: string; referrer: string; authorization: string }[] = [];
    for (const page of [owner, agent, client]) page.on("pageerror", (error) => errors.push(error.message));
    client.on("request", (req) => requests.push({ url: req.url(), referrer: req.headers().referer || "", authorization: req.headers().authorization || "" }));
    await Promise.all([owner.goto(`${web}/workspace/transactions/${matter.id}`), agent.goto(`${web}/portal/transactions/${matter.id}`)]);
    await expect(owner.getByRole("heading", { name: "Transaction checklist", exact: true })).toBeVisible({ timeout: 30000 });
    await agent.getByRole("button", { name: "Generate client link", exact: true }).click();
    const field = agent.getByRole("textbox", { name: "Client checklist link", exact: true }); await expect(field).toBeVisible();
    const url = await field.inputValue(), token = new URL(url).hash.slice(1);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/); assert.equal(new URL(url).search, "");
    await agent.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(agent.getByText("Client checklist link copied.", { exact: true })).toBeVisible();
    assert.equal(await agent.evaluate(() => navigator.clipboard.readText()), url);
    results.push("Agent generates fragment link and copies the exact value to clipboard");
    const clientResponse = await client.goto(url); assert.ok(clientResponse);
    assert.match(clientResponse!.headers()["cache-control"], /no-store/); assert.equal(clientResponse!.headers()["referrer-policy"], "no-referrer"); assert.match(clientResponse!.headers()["x-robots-tag"], /noindex/);
    await expect(client.getByRole("heading", { name: matter.title, exact: true })).toBeVisible({ timeout: 30000 });
    await expect(client.getByText("CLIENT_ALPHA", { exact: true })).toBeVisible();
    assert.ok(!(await client.locator("body").innerText()).includes("NEVER_PUBLIC"));
    assert.ok(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await client.locator("input,textarea,select").count(), 0);
    results.push("Mobile public page has narrow read-only content, no horizontal overflow and private headers");
    const shared = owner.locator("section").filter({ has: owner.getByRole("heading", { name: "Transaction checklist", exact: true }) });
    const agentChecklist = agent.locator("section").filter({ has: agent.getByRole("heading", { name: "Shared checklist", exact: true }) });
    const row = (title: string) => shared.getByText(title, { exact: true }).locator("..").locator("..").locator("..");
    await owner.getByRole("checkbox", { name: "Mark CLIENT_ALPHA complete", exact: true }).click();
    await expect(owner.getByRole("checkbox", { name: "Mark CLIENT_ALPHA complete", exact: true })).toBeChecked({ timeout: 12000 });
    await expect(client.getByText("1 of 1 steps complete", { exact: true })).toBeVisible({ timeout: 12000 });
    await row("CLIENT_ALPHA").getByRole("button", { name: "Edit step", exact: true }).click();
    await owner.getByRole("textbox", { name: "Step title", exact: true }).fill("CLIENT_ALPHA_EDITED");
    await owner.getByLabel("Step due date", { exact: true }).fill("2026-12-20");
    await owner.getByLabel("Step status", { exact: true }).selectOption("signed");
    await owner.getByRole("button", { name: "Save step", exact: true }).click();
    await expect(client.getByText("CLIENT_ALPHA_EDITED", { exact: true })).toBeVisible({ timeout: 12000 });
    await expect(agentChecklist.getByText("CLIENT_ALPHA_EDITED", { exact: true })).toBeVisible({ timeout: 12000 });
    await expect(client.getByText(/Signed · Dec 20, 2026/)).toBeVisible();
    results.push("Coordinator UI completion/title/status/date edits update open agent and public mobile pages");
    await owner.getByRole("textbox", { name: "New checklist step", exact: true }).fill("CLIENT_ADDED");
    await owner.getByLabel("New step visibility", { exact: true }).selectOption("client");
    await owner.getByLabel("New step due date", { exact: true }).fill("2026-12-21");
    await shared.getByRole("button", { name: "Add", exact: true }).click();
    await expect(client.getByText("CLIENT_ADDED", { exact: true })).toBeVisible({ timeout: 12000 });
    await expect(agentChecklist.getByText("CLIENT_ADDED", { exact: true })).toBeVisible({ timeout: 12000 });
    await owner.getByRole("button", { name: "Move CLIENT_ADDED up", exact: true }).click();
    await expect.poll(async () => { const { data } = await request(matterPath, ownerCookie); return data.tasks.filter((t: any) => t.visibility !== "coordinator").map((t: any) => t.title).join(","); }).toBe("CLIENT_ALPHA_EDITED,CLIENT_ADDED,NEVER_PUBLIC_AGENT");
    await expect.poll(() => shared.locator("strong").allTextContents(), { timeout: 12000 }).toEqual(["CLIENT_ALPHA_EDITED", "CLIENT_ADDED", "NEVER_PUBLIC_AGENT"]);
    await owner.getByRole("button", { name: "Move CLIENT_ADDED up", exact: true }).click();
    await expect.poll(() => client.locator("ol li strong").allTextContents(), { timeout: 12000 }).toEqual(["CLIENT_ADDED", "CLIENT_ALPHA_EDITED"]);
    const currentDeadline = (await request(matterPath, ownerCookie)).data.deadlines.find((d: any) => d.id === deadline.id);
    await request(`${matterPath}/deadlines/${deadline.id}`, ownerCookie, "PATCH", { expectedRevision: currentDeadline.revision, date: "2026-12-22" });
    await expect(client.getByText("Dec 22, 2026", { exact: true })).toBeVisible({ timeout: 12000 });
    await expect(agentChecklist.getByText("CLIENT_ADDED", { exact: true })).toBeVisible();
    results.push("UI additions/order changes and canonical confirmed-date changes propagate without reload");
    await row("CLIENT_ALPHA_EDITED").getByRole("button", { name: "Edit step", exact: true }).click();
    await owner.getByLabel("Step visibility", { exact: true }).selectOption("coordinator");
    await owner.getByRole("button", { name: "Save step", exact: true }).click();
    await expect(client.getByText("CLIENT_ALPHA_EDITED", { exact: true })).toHaveCount(0, { timeout: 12000 });
    await expect(agent.getByText("CLIENT_ALPHA_EDITED", { exact: true })).toHaveCount(0, { timeout: 12000 });
    await row("CLIENT_ADDED").getByRole("button", { name: "Edit step", exact: true }).click();
    await owner.getByRole("button", { name: "Delete step", exact: true }).click();
    await expect(client.getByText("CLIENT_ADDED", { exact: true })).toHaveCount(0, { timeout: 12000 });
    results.push("Visibility withdrawal and task deletion remove content from already-open agent/client views");
    // Preserve one visible synthetic step for reconnection and stale-response checks.
    let alphaCurrent = (await request(matterPath, ownerCookie)).data.tasks.find((t: any) => t.id === alpha.id);
    await request(`${matterPath}/tasks/${alpha.id}`, ownerCookie, "PATCH", { expectedRevision: alphaCurrent.revision, visibility: "client", title: "CLIENT_RECONNECTED" });
    await expect(client.getByText("CLIENT_RECONNECTED", { exact: true })).toBeVisible({ timeout: 12000 });
    await clientContext.setOffline(true);
    await expect(client.getByRole("heading", { name: matter.title, exact: true })).toHaveCount(0, { timeout: 3000 });
    await expect(client.getByText(/offline|interrupted|timed out/i).first()).toBeVisible();
    await clientContext.setOffline(false);
    await expect(client.getByText("CLIENT_RECONNECTED", { exact: true })).toBeVisible({ timeout: 12000 });
    results.push("Offline event clears sensitive content immediately and reconnect restores current content");
    let intercepted = false, release: (() => void) | undefined, held: Promise<void> | undefined;
    const entered = new Promise<void>((resolve) => {
      void client.route("**/api/public/checklist", async (route) => {
        if (intercepted) { await route.continue(); return; }
        intercepted = true;
        const old = await route.fetch();
        held = new Promise<void>((resume) => { release = resume; }); resolve();
        await held;
        await route.fulfill({ response: old }).catch(() => {});
      });
    });
    await entered;
    alphaCurrent = (await request(matterPath, ownerCookie)).data.tasks.find((t: any) => t.id === alpha.id);
    await request(`${matterPath}/tasks/${alpha.id}`, ownerCookie, "PATCH", { expectedRevision: alphaCurrent.revision, title: "CLIENT_LATEST_AFTER_RECONNECT" });
    await client.evaluate(() => window.dispatchEvent(new Event("offline")));
    // The real navigator state is online. A visibility/pagehide clear reliably aborts this old generation.
    await client.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await client.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await expect(client.getByText("CLIENT_LATEST_AFTER_RECONNECT", { exact: true })).toBeVisible({ timeout: 12000 });
    release?.(); await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(client.getByText("CLIENT_RECONNECTED", { exact: true })).toHaveCount(0); await client.unroute("**/api/public/checklist");
    results.push("Delayed pre-reconnect response cannot overwrite the new generation");
    await client.route("**/api/public/checklist", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Synthetic review outage" } }) }));
    await expect(client.getByRole("heading", { name: matter.title, exact: true })).toHaveCount(0, { timeout: 12000 });
    await expect(client.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    await client.unroute("**/api/public/checklist"); await client.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(client.getByText("CLIENT_LATEST_AFTER_RECONNECT", { exact: true })).toBeVisible({ timeout: 12000 });
    results.push("Server errors clear old content and retry/reconnection recover");
    await client.route("**/api/public/checklist", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await route.continue().catch(() => {});
    });
    await expect(client.getByRole("heading", { name: matter.title, exact: true })).toHaveCount(0, { timeout: 10000 });
    await expect(client.getByRole("status").filter({ hasText: "The connection timed out. Checklist hidden while we reconnect." })).toBeVisible();
    await client.unroute("**/api/public/checklist");
    await expect(client.getByText("CLIENT_LATEST_AFTER_RECONNECT", { exact: true })).toBeVisible({ timeout: 12000 });
    results.push("Stalled request times out, clears stale content within the bound and resumes polling");
    await client.screenshot({ path: path.join(checkoutRoot, "docs/reviews/implementation/checklist-sharing/client-mobile.png"), fullPage: true });
    // A second manager replaces the link; first manager must stop offering its revoked URL.
    await owner.getByRole("button", { name: "Replace link", exact: true }).click();
    await expect(agent.getByRole("textbox", { name: "Client checklist link", exact: true })).toHaveCount(0, { timeout: 12000 });
    await expect(client.getByRole("heading", { name: "Checklist unavailable", exact: true })).toBeVisible({ timeout: 12000 });
    const replacement = await owner.getByRole("textbox", { name: "Client checklist link", exact: true }).inputValue();
    await client.goto(replacement); await expect(client.getByText("CLIENT_LATEST_AFTER_RECONNECT", { exact: true })).toBeVisible();
    await owner.getByRole("button", { name: "Revoke link", exact: true }).click();
    await expect(client.getByRole("heading", { name: "Checklist unavailable", exact: true })).toBeVisible({ timeout: 12000 });
    await expect(client.getByText("CLIENT_LATEST_AFTER_RECONNECT", { exact: true })).toHaveCount(0);
    results.push("External rotation hides stale copy controls; link rotation/revocation clear open public pages");
    const publicTokens = [token, new URL(replacement).hash.slice(1)];
    assert.ok(!requests.some((req) => publicTokens.some((credential) => req.url.includes(credential) || req.referrer.includes(credential))));
    assert.ok(requests.filter((req) => req.authorization).every((req) => new URL(req.url).pathname === "/api/public/checklist"));
    assert.ok(publicTokens.every((credential) => !logs().includes(credential))); assert.deepEqual(errors, []);
    results.push("No token in HTTP request URLs/referrers/server logs and no browser runtime errors");
    console.log(JSON.stringify({ candidate, checks: results.length, failures: 0, results }, null, 2));
  } finally { for (const context of contexts) await context.close(); await browser.close(); }
}, { web: true });
