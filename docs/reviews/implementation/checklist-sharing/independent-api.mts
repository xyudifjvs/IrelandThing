import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isolatedReview } from "./harness.mts";

await isolatedReview(async ({ database, api, web, logs, candidate }) => {
  const results: { name: string; pass: boolean }[] = [];
  const tokens: string[] = [];
  async function check(name: string, probe: () => unknown | Promise<unknown>) {
    try { await probe(); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false }); throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  async function request(route: string, cookie = "", method = "GET", body?: unknown, token?: string) {
    const response = await fetch(api + route, {
      method,
      headers: {
        Origin: web,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, headers: response.headers, data };
  }
  async function signIn(email: string) {
    const reply = await request("/api/auth/sign-in/email", "", "POST", { email, password: "Weatherly-Local-2026!" });
    assert.equal(reply.status, 200, `Synthetic sign-in failed (${email})`);
    return reply.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  }
  await database.query('INSERT INTO "User"(id,name,email,role,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,$4,true,now(),now())', ["checker-unrelated", "Synthetic outsider", "outsider@example.test", "agent"]);
  await database.query('INSERT INTO "Account"(id,"accountId","userId","providerId",password,"createdAt","updatedAt") SELECT $1,$2,$2,\'credential\',password,now(),now() FROM "Account" WHERE id=\'agent-local-credential\'', ["checker-unrelated-credential", "checker-unrelated"]);
  const owner = await signIn("ireland@example.test"), agent = await signIn("alex.agent@example.test"), client = await signIn("avery.client@example.test"), outsider = await signIn("outsider@example.test");
  const created = await request("/api/v1/matters", owner, "POST", { title: "Synthetic shared review", propertyAddress: "1 Synthetic Review Lane", side: "buyer", packageCode: "complete", agentId: "agent-local", details: { privateMarker: "NEVER_PUBLIC_CONTACT", clients: [{ email: "never-public@example.test" }] } });
  assert.equal(created.status, 201);
  const mid = created.data.id, matterPath = `/api/v1/matters/${mid}`, sharePath = `${matterPath}/checklist-share`;
  await request(`${matterPath}/participants`, owner, "POST", { userId: "client-local", role: "client" });
  for (const task of (await request(matterPath, owner)).data.tasks)
    assert.equal((await request(`${matterPath}/tasks/${task.id}`, owner, "DELETE", { expectedRevision: task.revision })).status, 200);
  const tasks = [];
  for (const [title, visibility, kind] of [["CLIENT_ALPHA", "client", "checklist"], ["CLIENT_CUSTOM", "client", "custom"], ["NEVER_PUBLIC_AGENT", "agent", "checklist"], ["NEVER_PUBLIC_COORDINATOR", "coordinator", "checklist"]]) {
    const response = await request(`${matterPath}/tasks`, owner, "POST", { title, visibility, kind, dueDate: "2026-12-11", details: { note: "NEVER_PUBLIC_TASK_DETAILS" } });
    assert.equal(response.status, 201); tasks.push(response.data);
  }
  for (const visibility of ["coordinator", "client"]) assert.equal((await request(`${matterPath}/notes`, owner, "POST", { body: "NEVER_PUBLIC_NOTE_" + visibility, visibility })).status, 201);
  for (const status of ["proposed", "confirmed"]) assert.equal((await request(`${matterPath}/deadlines`, owner, "POST", { label: status === "confirmed" ? "CLIENT_CONFIRMED_DATE" : "NEVER_PUBLIC_PROPOSED_DATE", date: "2026-12-12", status, details: { private: "NEVER_PUBLIC_DATE_DETAILS" } })).status, 201);
  await database.query('INSERT INTO "Document"(id,"matterId",name,"mimeType",visibility,"createdById","updatedAt") VALUES($1,$2,$3,$4,$5,$6,now())', ["checker-document", mid, "NEVER_PUBLIC_DOCUMENT", "text/plain", "client", "owner-local"]);
  const initial = (await request(matterPath, owner)).data;
  assert.equal((await request(`${matterPath}/tasks/reorder`, owner, "POST", { expectedRevision: initial.revision, taskIds: [tasks[0].id, tasks[2].id, tasks[1].id, tasks[3].id] })).status, 200);

  let shared: Awaited<ReturnType<typeof request>>;
  function tokenFrom(reply: Awaited<ReturnType<typeof request>>) {
    assert.equal(reply.status, 201);
    const url = new URL(reply.data.url);
    assert.equal(url.origin, web); assert.equal(url.pathname, "/checklist"); assert.equal(url.search, "");
    const token = url.hash.slice(1); assert.match(token, /^[A-Za-z0-9_-]{43}$/); tokens.push(token); return token;
  }
  await check("Anonymous/client/unrelated management denied; assigned agent can generate", async () => {
    for (const [cookie, status] of [["", 401], [client, 403], [outsider, 404]] as const) {
      for (const method of ["GET", "POST", "DELETE"]) assert.equal((await request(sharePath, cookie, method, method === "POST" ? {} : undefined)).status, status);
    }
    shared = await request(sharePath, agent, "POST", {}); tokenFrom(shared);
    assert.match(shared.headers.get("cache-control") || "", /no-store/);
    assert.equal(shared.headers.get("referrer-policy"), "no-referrer");
  });
  let token = tokens.at(-1)!;
  await check("Only hash persists; list metadata cannot recover token; default expiry bounded", async () => {
    const rows = (await database.query('SELECT * FROM "ChecklistShare" WHERE "matterId"=$1', [mid])).rows;
    assert.equal(rows.length, 1); assert.equal(rows[0].tokenHash, createHash("sha256").update(token).digest("hex"));
    assert.ok(!JSON.stringify(rows).includes(token)); assert.ok(!Object.keys(rows[0]).some((key) => ["token", "url"].includes(key)));
    const metadata = await request(sharePath, owner); assert.equal(metadata.status, 200); assert.equal(metadata.data.active, true); assert.ok(!JSON.stringify(metadata.data).includes(token)); assert.ok(!("tokenHash" in metadata.data)); assert.ok(!("url" in metadata.data));
    const duration = new Date(metadata.data.expiresAt).getTime() - Date.now(); assert.ok(duration > 29 * 86400000 && duration <= 30 * 86400000);
  });
  await check("Existing API/MCP registry returns scoped safe metadata through the domain service", async () => {
    const path = `/api/v1/assistant/records?kind=checklist_shares&matterId=${mid}`;
    for (const cookie of [owner, agent]) {
      const reply = await request(path, cookie); assert.equal(reply.status, 200); assert.equal(reply.data.items.length, 1); assert.equal(reply.data.items[0].active, true);
      assert.deepEqual(Object.keys(reply.data.items[0]).sort(), ["active", "createdAt", "expiresAt", "id", "matterId", "revokedAt"]);
      assert.ok(!JSON.stringify(reply.data).includes(token));
    }
    assert.equal((await request(path, client)).status, 403); assert.equal((await request(path, outsider)).status, 404);
    const bundle = await request(`/api/v1/assistant/matters/${mid}`, client); assert.equal(bundle.status, 200); assert.equal(bundle.data.matter.tasks.length, 2); assert.ok(bundle.data.matter.tasks.every((task: any) => task.visibility === "client"));
  });
  await check("Public exact allowlist excludes all notes/documents/contacts/private fields", async () => {
    const reply = await request("/api/public/checklist", "", "GET", undefined, token);
    assert.equal(reply.status, 200); assert.deepEqual(Object.keys(reply.data).sort(), ["deadlines", "matter", "tasks"]);
    assert.deepEqual(Object.keys(reply.data.matter).sort(), ["id", "propertyAddress", "stage", "title"]);
    assert.deepEqual(reply.data.tasks.map((task: any) => task.title), ["CLIENT_ALPHA", "CLIENT_CUSTOM"]);
    for (const task of reply.data.tasks) assert.deepEqual(Object.keys(task).filter((key) => key !== "position").sort(), ["dueDate", "id", "status", "title"]);
    if (reply.data.tasks.some((task: any) => "position" in task)) assert.deepEqual(reply.data.tasks.map((task: any) => task.position), [0, 1], "Public positions cannot expose gaps caused by hidden tasks");
    assert.deepEqual(reply.data.deadlines.map((deadline: any) => deadline.label), ["CLIENT_CONFIRMED_DATE"]);
    assert.ok(!JSON.stringify(reply.data).includes("NEVER_PUBLIC"));
    const second = await request("/api/public/checklist?matterId=demo-maple", "", "GET", undefined, token); assert.equal(second.status, 200); assert.equal(second.data.matter.id, mid);
  });
  await check("Valid and invalid public responses forbid caching/indexing/referrers", async () => {
    for (const credential of [token, "bad", "A".repeat(43), undefined]) {
      const reply = await request("/api/public/checklist", "", "GET", undefined, credential);
      assert.equal(reply.status, credential === token ? 200 : 404);
      assert.match(reply.headers.get("cache-control") || "", /no-store/); assert.match(reply.headers.get("x-robots-tag") || "", /noindex/); assert.equal(reply.headers.get("referrer-policy"), "no-referrer");
    }
    for (const path of ["/api/public/checklist?token=" + token, "/api/public/checklist#" + token]) assert.equal((await request(path)).status, 404);
  });
  await check("Bearer link never confers writes or ordinary API identity", async () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) assert.equal((await request("/api/public/checklist", "", method, { title: "intrusion" }, token)).status, 404);
    for (const [path, method, body] of [[matterPath, "GET", undefined], [`${matterPath}/tasks`, "POST", { title: "intrusion", visibility: "client" }], [`${matterPath}/tasks/${tasks[0].id}`, "PATCH", { title: "intrusion", expectedRevision: tasks[0].revision }], [sharePath, "POST", {}]] as const) assert.equal((await request(path, "", method, body, token)).status, 401);
  });
  await check("Canonical role projections, concurrent edit protection and live public content", async () => {
    const ownerView = await request(matterPath, owner), agentView = await request(matterPath, agent), clientView = await request(matterPath, client);
    assert.equal(ownerView.data.tasks.length, 4); assert.equal(agentView.data.tasks.length, 3); assert.equal(clientView.data.tasks.length, 2);
    const edits = await Promise.all(["CLIENT_EDIT_A", "CLIENT_EDIT_B"].map((title) => request(`${matterPath}/tasks/${tasks[0].id}`, owner, "PATCH", { title, status: "completed", dueDate: "2026-12-13", expectedRevision: tasks[0].revision })));
    assert.deepEqual(edits.map((reply) => reply.status).sort(), [200, 409]);
    const winner = edits.find((reply) => reply.status === 200)!.data; tasks[0] = winner;
    const publicView = await request("/api/public/checklist", "", "GET", undefined, token);
    assert.equal(publicView.data.tasks[0].title, winner.title); assert.equal(publicView.data.tasks[0].status, "completed"); assert.equal(publicView.data.tasks[0].dueDate, "2026-12-13");
    const before = (await request(matterPath, owner)).data;
    assert.equal((await request(`${matterPath}/tasks/reorder`, owner, "POST", { expectedRevision: before.revision, taskIds: before.tasks.map((task: any) => task.id).reverse() })).status, 200);
    assert.equal((await request(`${matterPath}/tasks/reorder`, owner, "POST", { expectedRevision: before.revision, taskIds: before.tasks.map((task: any) => task.id) })).status, 409);
    assert.deepEqual((await request("/api/public/checklist", "", "GET", undefined, token)).data.tasks.map((task: any) => task.id), [tasks[1].id, tasks[0].id]);
  });
  await check("Visibility withdrawal and deletion enforced by each subsequent public read", async () => {
    const current = (await request(matterPath, owner)).data.tasks.find((task: any) => task.id === tasks[0].id);
    assert.equal((await request(`${matterPath}/tasks/${current.id}`, owner, "PATCH", { visibility: "coordinator", expectedRevision: current.revision })).status, 200);
    assert.ok(!(await request("/api/public/checklist", "", "GET", undefined, token)).data.tasks.some((task: any) => task.id === current.id));
    const remaining = (await request(matterPath, owner)).data.tasks.find((task: any) => task.id === tasks[1].id);
    assert.equal((await request(`${matterPath}/tasks/${remaining.id}`, owner, "DELETE", { expectedRevision: remaining.revision })).status, 200);
    assert.deepEqual((await request("/api/public/checklist", "", "GET", undefined, token)).data.tasks, []);
  });
  await check("Rotation revokes the previous link; concurrent rotates leave exactly one usable token", async () => {
    const next = tokenFrom(await request(sharePath, owner, "POST", {})); assert.notEqual(next, token); assert.equal((await request("/api/public/checklist", "", "GET", undefined, token)).status, 404); token = next;
    const rotated = await Promise.all([request(sharePath, owner, "POST", {}), request(sharePath, owner, "POST", {})]);
    assert.notEqual(`${rotated[0].data.id}:${rotated[0].data.createdAt}`, `${rotated[1].data.id}:${rotated[1].data.createdAt}`, "Each rotation needs a distinct public generation marker");
    const candidates = rotated.map(tokenFrom); const states = await Promise.all(candidates.map((value) => request("/api/public/checklist", "", "GET", undefined, value)));
    assert.deepEqual(states.map((reply) => reply.status).sort(), [200, 404]); token = candidates[states.findIndex((reply) => reply.status === 200)];
    assert.equal((await database.query('SELECT count(*)::int AS n FROM "ChecklistShare" WHERE "matterId"=$1', [mid])).rows[0].n, 1);
  });
  await check("Expiry bounds and actual expiration are server enforced", async () => {
    for (const expiresAt of [new Date(Date.now() - 1000).toISOString(), new Date(Date.now() + 366 * 86400000).toISOString()]) assert.equal((await request(sharePath, owner, "POST", { expiresAt })).status, 422);
    await database.query('UPDATE "ChecklistShare" SET "expiresAt"=now()-interval \'1 second\' WHERE "matterId"=$1', [mid]);
    assert.equal((await request("/api/public/checklist", "", "GET", undefined, token)).status, 404); assert.equal((await request(sharePath, owner)).data.active, false);
  });
  await check("Revoked matter participant loses share management and previously issued public link", async () => {
    const response = await request("/api/v1/matters", owner, "POST", { title: "Synthetic participant review", propertyAddress: "2 Synthetic Review Lane", side: "buyer", packageCode: "complete" });
    const path = `/api/v1/matters/${response.data.id}`, share = `${path}/checklist-share`;
    const member = await request(`${path}/participants`, owner, "POST", { userId: "agent-local", role: "agent" });
    const value = tokenFrom(await request(share, agent, "POST", {})); assert.equal((await request("/api/public/checklist", "", "GET", undefined, value)).status, 200);
    assert.equal((await request(`${path}/participants/${member.data.id}`, owner, "DELETE")).status, 200);
    for (const method of ["GET", "POST", "DELETE"]) assert.equal((await request(share, agent, method, method === "POST" ? {} : undefined)).status, 404);
    assert.equal((await request("/api/public/checklist", "", "GET", undefined, value)).status, 404);
  });
  await check("Revoking issuer account invalidates an issued link even while assignment remains", async () => {
    token = tokenFrom(await request(sharePath, agent, "POST", {}));
    assert.equal((await request("/api/v1/users/agent-local/access", owner, "POST", { enabled: false, reason: "Synthetic independent review" })).status, 200);
    assert.equal((await request("/api/public/checklist", "", "GET", undefined, token)).status, 404);
    assert.equal((await request(sharePath, owner)).data.active, false);
  });
  await check("Coordinator revoke is idempotent and never restores any earlier token", async () => {
    token = tokenFrom(await request(sharePath, owner, "POST", {}));
    for (let i = 0; i < 2; i++) assert.equal((await request(sharePath, owner, "DELETE")).status, 200);
    for (const value of tokens) assert.equal((await request("/api/public/checklist", "", "GET", undefined, value)).status, 404);
  });
  await check("No raw token or share URL in persisted audit or server logs", async () => {
    const audit = JSON.stringify((await database.query('SELECT * FROM "AuditEvent"')).rows);
    for (const value of tokens) { assert.ok(!audit.includes(value)); assert.ok(!logs().includes(value)); }
    assert.ok(!audit.includes("/checklist#"));
  });
  console.log(JSON.stringify({ candidate, checks: results.length, failures: results.filter((result) => !result.pass).length, results }, null, 2));
});
