import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isolatedReview, syntheticMcpEvidence } from "./harness.mts";

await isolatedReview(async ({ database, api, web, candidate, logs }) => {
  const results: string[] = [];
  async function request(route: string, { cookie = "", token = "", method = "GET", body }: { cookie?: string; token?: string; method?: string; body?: unknown } = {}) {
    const response = await fetch(api + route, { method, headers: { Origin: web, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18", ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: "Bearer " + token } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  const login = await request("/api/auth/sign-in/email", { method: "POST", body: { email: "ireland@example.test", password: "Weatherly-Local-2026!" } }); assert.equal(login.status, 200);
  const owner = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const created = await request("/api/v1/matters", { cookie: owner, method: "POST", body: { title: "Synthetic MCP checklist", propertyAddress: "1 Synthetic Protocol Lane", side: "buyer", packageCode: "complete" } }); assert.equal(created.status, 201);
  const mid = created.data.id, matterPath = `/api/v1/matters/${mid}`;
  const link = await request(`${matterPath}/checklist-share`, { cookie: owner, method: "POST", body: {} }); assert.equal(link.status, 201);
  const shareToken = new URL(link.data.url).hash.slice(1);
  assert.equal((await request("/api/v1/assistant/clients", { cookie: owner, method: "POST", body: { id: "checker-checklist-protocol", name: "Independent synthetic protocol client", complianceEvidence: syntheticMcpEvidence } })).status, 201);
  // A synthetic durable grant isolates this feature's protocol projection from the separately tested OAuth consent journey.
  const grantToken = randomBytes(32).toString("base64url"), grantId = randomUUID();
  await database.query('INSERT INTO "AssistantGrant"(id,"userId",name,"tokenHash",scopes,"approvedClient","complianceEvidence","clientId","expiresAt") VALUES($1,$2,$3,$4,$5::jsonb,true,$6,$7,now()+interval \'1 hour\')', [grantId, "owner-local", "Independent synthetic checklist review", createHash("sha256").update(grantToken).digest("hex"), JSON.stringify(["weatherly:read"]), syntheticMcpEvidence, "checker-checklist-protocol"]);
  let id = 0;
  const rpc = (method: string, params: unknown = {}, token = grantToken) => request("/api/mcp", { token, method: "POST", body: { jsonrpc: "2.0", id: ++id, method, params } });
  const initialized = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Independent checklist checker", version: "1" } }); assert.equal(initialized.status, 200); assert.equal(initialized.data.result.serverInfo.name, "weatherly");
  results.push("Actual MCP initializes under an isolated synthetic approved read grant");
  const tools = (await rpc("tools/list")).data.result.tools;
  assert.ok(tools.every((tool: any) => tool.annotations.readOnlyHint === true));
  const registry = tools.find((tool: any) => tool.name === "query_records"); assert.ok(registry.inputSchema.properties.kind.enum.includes("checklist_shares"));
  assert.ok(!tools.some((tool: any) => /create.*share|revoke.*share|update.*task/i.test(tool.name)));
  results.push("Checklist sharing metadata is discoverable through the existing read-only registry");
  const query = async () => {
    const reply = await rpc("tools/call", { name: "query_records", arguments: { kind: "checklist_shares", matterId: mid } }); assert.equal(reply.status, 200); assert.ok(!reply.data.result.isError);
    return JSON.parse(reply.data.result.content[0].text);
  };
  const state = await query(); assert.equal(state.items.length, 1); assert.equal(state.items[0].active, true); assert.equal(state.items[0].matterId, mid);
  assert.deepEqual(Object.keys(state.items[0]).sort(), ["active", "createdAt", "expiresAt", "id", "matterId", "revokedAt"]);
  assert.ok(!JSON.stringify(state).includes(shareToken)); results.push("Protocol returns the same safe current share metadata without bearer/hash/URL");
  const task = await request(`${matterPath}/tasks`, { cookie: owner, method: "POST", body: { title: "MCP_CANONICAL_STEP", visibility: "client", dueDate: "2026-12-13" } }); assert.equal(task.status, 201);
  assert.equal((await request(`${matterPath}/tasks/${task.data.id}`, { cookie: owner, method: "PATCH", body: { expectedRevision: task.data.revision, status: "completed" } })).status, 200);
  const read = await rpc("tools/call", { name: "get_matter", arguments: { matterId: mid } }); assert.equal(read.status, 200);
  const bundle = JSON.parse(read.data.result.content[0].text), canonical = bundle.matter.tasks.find((row: any) => row.id === task.data.id);
  assert.equal(canonical.status, "completed"); assert.equal(canonical.dueDate, "2026-12-13"); results.push("MCP get_matter sees the canonical checklist mutation and date immediately");
  assert.equal((await rpc("tools/list", {}, shareToken)).status, 401);
  assert.equal((await request("/api/public/checklist", { token: grantToken })).status, 404);
  results.push("Public link and MCP read grant cannot be confused as each other's credentials");
  assert.equal((await request(`${matterPath}/checklist-share`, { cookie: owner, method: "DELETE" })).status, 200); assert.equal((await query()).items[0].active, false);
  results.push("Share revocation is immediately reflected in the protocol metadata");
  assert.equal((await request(`/api/v1/assistant/grants/${grantId}`, { cookie: owner, method: "DELETE" })).status, 200); assert.equal((await rpc("tools/list")).status, 401);
  results.push("Revoked synthetic MCP grant loses protocol access");
  const audit = JSON.stringify((await database.query('SELECT * FROM "AuditEvent"')).rows);
  for (const token of [shareToken, grantToken]) { assert.ok(!audit.includes(token)); assert.ok(!logs().includes(token)); }
  results.push("Neither credential appears in server logs or durable audit records");
  console.log(JSON.stringify({ candidate, checks: results.length, failures: 0, results }, null, 2));
}, { mcp: true });
