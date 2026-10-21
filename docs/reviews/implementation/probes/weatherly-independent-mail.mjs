import "./_review-safety.mjs";
import {
  checkoutRoot,
  checkerDatabaseUrl,
  apiBase,
  webBase,
} from "./_review-safety.mjs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const require = createRequire(
  new URL("../../../../package.json", import.meta.url),
);
const { Client } = require("pg");
const db = new Client({ connectionString: checkerDatabaseUrl });
await db.connect();
const suffix = randomUUID();
const base = apiBase;
const checks = [];
const check = (name, pass, extra = {}) => checks.push({ name, pass, ...extra });
async function req(path, cookie = "", method = "GET", body) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Origin: webBase,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await r.json();
  } catch {
    data = {};
  }
  return { status: r.status, data, headers: r.headers };
}
async function login(email) {
  const r = await req("/api/auth/sign-in/email", "", "POST", {
    email,
    password: "Weatherly-Local-2026!",
  });
  if (r.status !== 200) throw Error("login " + r.status);
  return r.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
}
const owner = await login("ireland@example.test"),
  client = await login("avery.client@example.test"),
  agent = await login("alex.agent@example.test");
const make = (title) =>
  req("/api/v1/matters", owner, "POST", {
    title,
    propertyAddress: "Synthetic Mail " + suffix,
    side: "buyer",
    packageCode: "complete",
    agentId: "agent-local",
    details: {
      clients: [
        { name: "Synthetic Client", email: "avery.client@example.test" },
      ],
      contacts: [
        {
          name: "Synthetic Lender",
          email: "lender@example.test",
          role: "lender",
        },
      ],
    },
  });
const a = (await make("Mail A")).data,
  b = (await make("Mail B")).data;
await db.query(
  'INSERT INTO "MatterParticipant"(id,"matterId","userId",role) VALUES($1,$2,$3,$4)',
  [suffix + "-p", a.id, "client-local", "client"],
);
const threadId = suffix + "-thread",
  privateId = suffix + "-private",
  sharedId = suffix + "-shared";
await db.query(
  'INSERT INTO "EmailThread"(id,"ownerId","providerThreadId","matterId",subject,status,"updatedAt") VALUES($1,$2,$1,$3,$4,$5,now())',
  [threadId, "owner-local", a.id, "PRIVATE THREAD TITLE", "assigned"],
);
for (const [id, subject, visibility] of [
  [privateId, "Private coordination", "coordinator"],
  [sharedId, "Reviewed client message", "client"],
])
  await db.query(
    'INSERT INTO "EmailMessage"(id,"providerMessageId","threadId","fromEmail",subject,text,"sentAt",direction,details) VALUES($1,$1,$2,$3,$4,$5,now(),$6,$7)',
    [
      id,
      threadId,
      "lender@example.test",
      subject,
      "Synthetic evidence " + subject,
      "inbound",
      JSON.stringify({ visibility }),
    ],
  );
let messages = await req(
    "/api/v1/communications/messages?matterId=" + a.id,
    client,
  ),
  threads = await req(
    "/api/v1/communications/threads?matterId=" + a.id,
    client,
  );
check(
  "Client receives only explicitly shared message",
  messages.status === 200 &&
    messages.data.length === 1 &&
    messages.data[0].id === sharedId,
);
check(
  "Private thread title never projected",
  threads.status === 200 &&
    threads.data[0]?.subject === "Reviewed client message" &&
    !JSON.stringify(threads.data).includes("PRIVATE THREAD TITLE"),
);
check(
  "Agent cannot access private sibling message",
  (
    await req("/api/v1/communications/messages?matterId=" + a.id, agent)
  ).data.every((m) => m.id !== privateId),
);
await db.query(
  'UPDATE "MatterParticipant" SET "revokedAt"=now() WHERE "matterId"=$1 AND "userId"=$2',
  [a.id, "client-local"],
);
await db.query(
  'INSERT INTO "MatterParticipant"(id,"matterId","userId",role) VALUES($1,$2,$3,$4)',
  [suffix + "-p2", b.id, "client-local", "client"],
);
const rematch = await req(
  "/api/v1/communications/threads/" + threadId,
  owner,
  "PATCH",
  { matterId: b.id, expectedRevision: 1 },
);
check("Coordinator rematches revisioned thread", rematch.status === 200, {
  status: rematch.status,
});
const oldDenied = await req(
    "/api/v1/communications/messages?matterId=" + a.id,
    client,
  ),
  newHidden = await req(
    "/api/v1/communications/messages?matterId=" + b.id,
    client,
  );
check("Revoked old matter is denied", oldDenied.status === 404);
check(
  "Rematched messages require fresh review before new client sees them",
  newHidden.status === 200 && newHidden.data.length === 0,
);
const staleShare = await req(
  "/api/v1/communications/messages/" + sharedId,
  owner,
  "PATCH",
  { expectedRevision: 1, visibility: "client" },
);
check(
  "Pre-rematch stale share cannot restore visibility",
  staleShare.status === 409,
);
const shared = (
  await db.query('SELECT revision FROM "EmailMessage" WHERE id=$1', [sharedId])
).rows[0];
const reshare = await req(
  "/api/v1/communications/messages/" + sharedId,
  owner,
  "PATCH",
  { expectedRevision: shared.revision, visibility: "client" },
);
check(
  "Explicit new review permits new matter visibility",
  reshare.status === 200 &&
    (
      await req("/api/v1/communications/messages?matterId=" + b.id, client)
    ).data.some((m) => m.id === sharedId),
);
const draftInput = {
  matterId: b.id,
  to: ["avery.client@example.test"],
  subject: "Synthetic",
  body: "Synthetic body",
};
const restricted = await req(
  "/api/v1/communications/drafts",
  owner,
  "POST",
  draftInput,
);
check(
  "Missing direct-contact policy denies client recipient",
  restricted.status === 403,
);
const d = (await req("/api/v1/matters/" + b.id, owner)).data;
await req("/api/v1/matters/" + b.id, owner, "PATCH", {
  expectedRevision: d.revision,
  details: { ...d.details, directContact: "copy_agent" },
});
const draft = await req(
  "/api/v1/communications/drafts",
  owner,
  "POST",
  draftInput,
);
check(
  "Client draft automatically copies assigned agent",
  draft.status === 201 && draft.data.cc.includes("alex.agent@example.test"),
);
const outsider = await req("/api/v1/communications/drafts", owner, "POST", {
  ...draftInput,
  to: ["unapproved@example.test"],
});
check("Unsaved external recipient denied", outsider.status === 422);
check(
  "Agent cannot create outgoing draft",
  (await req("/api/v1/communications/drafts", agent, "POST", draftInput))
    .status === 403,
);
const send = await req(
  "/api/v1/communications/drafts/" + draft.data.id + "/send",
  owner,
  "POST",
  { revision: draft.data.revision, confirmed: true },
);
check("Unconfigured mailbox cannot queue external send", send.status === 503);
check(
  "Unconfigured mailbox cannot connect",
  (await req("/api/v1/communications/connect", owner, "POST", {})).status ===
    503,
);
check(
  "Unconfigured mailbox cannot queue sync",
  (await req("/api/v1/communications/sync", owner, "POST", {})).status === 503,
);
console.log(
  JSON.stringify(
    {
      checks: checks.length,
      failed: checks.filter((c) => !c.pass).length,
      results: checks,
    },
    null,
    2,
  ),
);
await db.end();
