import "./_review-safety.mjs";
import {
  checkoutRoot,
  checkerDatabaseUrl,
  apiBase,
  webBase,
} from "./_review-safety.mjs";
const base = apiBase;
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
const logged = await req("/api/auth/sign-in/email", "", "POST", {
  email: "ireland@example.test",
  password: "Weatherly-Local-2026!",
});
const c = logged.headers
  .getSetCookie()
  .map((v) => v.split(";")[0])
  .join("; ");
const m = (
  await req("/api/v1/matters", c, "POST", {
    title: "Independent dynamic template",
    propertyAddress: "Synthetic Review Lane",
    side: "buyer",
    packageCode: "complete",
    agentId: "agent-local",
  })
).data;
const dl = (
  await req("/api/v1/matters/" + m.id + "/deadlines", c, "POST", {
    label: "Closing",
    date: "2026-11-20",
    status: "confirmed",
  })
).data;
const t = (
  await req("/api/v1/communications/templates", c, "POST", {
    name: "Independent closing template",
    side: "buyer",
    phase: "contract",
    subject: "Closing {{closingDate}}",
    body: "Recorded close: {{deadline_closing}}",
  })
).data;
const rendered = await req(
  "/api/v1/communications/templates/" + t.id + "/render",
  c,
  "POST",
  { matterId: m.id },
);
const draft = await req("/api/v1/communications/drafts", c, "POST", {
  matterId: m.id,
  to: ["alex.agent@example.test"],
  subject: rendered.data.subject,
  body: rendered.data.body,
  templateId: t.id,
  templateRevision: t.revision,
});
const update = await req(
  "/api/v1/matters/" + m.id + "/deadlines/" + dl.id,
  c,
  "PATCH",
  { expectedRevision: dl.revision, date: "2026-11-27" },
);
const drafts = await req("/api/v1/communications/drafts?matterId=" + m.id, c);
const after = drafts.data.find((d) => d.id === draft.data.id);
const checks = [];
const check = (name, pass, extra = {}) => checks.push({ name, pass, ...extra });
check(
  "Real API date update refreshes saved template draft",
  after.subject === "Closing 2026-11-27" &&
    after.body === "Recorded close: 2026-11-27",
);
let edited = await req(
  "/api/v1/communications/drafts/" + after.id,
  c,
  "PATCH",
  {
    expectedRevision: after.revision,
    body: "Manual review: closing Nov27 plus coordinator note",
  },
);
let currentDeadline = update.data;
const changedAgain = await req(
  "/api/v1/matters/" + m.id + "/deadlines/" + dl.id,
  c,
  "PATCH",
  { expectedRevision: currentDeadline.revision, date: "2026-12-01" },
);
let row = (
  await req("/api/v1/communications/drafts?matterId=" + m.id, c)
).data.find((d) => d.id === draft.data.id);
check(
  "Generated subject follows next date while manual body remains",
  row.subject === "Closing 2026-12-01" &&
    row.body === "Manual review: closing Nov27 plus coordinator note",
  { subject: row.subject, body: row.body },
);
check(
  "Preserved manual field requires review",
  row.details?.bodyOverride === true && row.details?.reviewNeeded === true,
);
const stale = await req(
  "/api/v1/communications/drafts/" + row.id + "/reset-template",
  c,
  "POST",
  { expectedRevision: after.revision },
);
check("Reset with stale revision rejected", stale.status === 409);
const reset = await req(
  "/api/v1/communications/drafts/" + row.id + "/reset-template",
  c,
  "POST",
  { expectedRevision: row.revision },
);
check(
  "Explicit current reset restores generated current-date content",
  reset.status === 200 &&
    reset.data.body === "Recorded close: 2026-12-01" &&
    reset.data.details.reviewNeeded === false,
);
const fields = await req(
  "/api/v1/communications/merge-fields?matterId=" + m.id,
  c,
);
check(
  "Date merge key exposes confirmed value and source",
  fields.status === 200 &&
    fields.data.some(
      (f) =>
        f.key === "closingDate" &&
        f.value === "2026-12-01" &&
        f.status === "confirmed" &&
        f.sourceIds.includes(dl.id),
    ),
);
console.log(
  JSON.stringify(
    {
      candidate: "2859d65",
      checks: checks.length,
      failed: checks.filter((x) => !x.pass).length,
      results: checks,
    },
    null,
    2,
  ),
);
