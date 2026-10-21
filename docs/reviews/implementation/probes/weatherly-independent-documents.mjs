import "./_review-safety.mjs";
import {
  checkoutRoot,
  checkerDatabaseUrl,
  apiBase,
  webBase,
} from "./_review-safety.mjs";
import { createHash } from "node:crypto";
const base = apiBase;
let failures = 0;
const results = [];
function check(name, ok, info = {}) {
  results.push({ name, result: ok ? "PASS" : "FAIL", ...info });
  if (!ok) failures++;
}
async function request(path, cookie = "", method = "GET", body) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Origin: webBase,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const bytes = Buffer.from(await r.arrayBuffer());
  let data;
  try {
    data = JSON.parse(bytes.toString());
  } catch {
    data = null;
  }
  return { status: r.status, data, bytes, headers: r.headers };
}
async function login(email) {
  const r = await request("/api/auth/sign-in/email", "", "POST", {
    email,
    password: "Weatherly-Local-2026!",
  });
  if (r.status !== 200) throw new Error("login " + r.status);
  return r.headers
    .getSetCookie()
    .map((x) => x.split(";")[0])
    .join("; ");
}
function pdf(text) {
  const stream = "BT /F1 12 Tf 50 700 Td (" + text + ") Tj ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " +
      Buffer.byteLength(stream) +
      " >>\nstream\n" +
      stream +
      "\nendstream",
  ];
  let src = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(Buffer.byteLength(src));
    src += i + 1 + " 0 obj\n" + objs[i] + "\nendobj\n";
  }
  const xref = Buffer.byteLength(src);
  src +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((v) => String(v).padStart(10, "0") + " 00000 n \n")
      .join("") +
    "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" +
    xref +
    "\n%%EOF";
  return Buffer.from(src);
}
function form(bytes, name = "review.pdf", matterId) {
  const f = new FormData();
  f.set("file", new Blob([bytes], { type: "application/pdf" }), name);
  if (matterId) f.set("matterId", matterId);
  f.set("visibility", "agent");
  return f;
}
const owner = await login("ireland@example.test"),
  agent = await login("alex.agent@example.test"),
  client = await login("avery.client@example.test"),
  other = await login("checker-agent2@example.test");
const bytes1 = pdf("Independent evidence contract Closing November 20 2026");
const uploaded = await request(
  "/api/v1/documents",
  agent,
  "POST",
  form(bytes1, "review-contract.pdf", "demo-oak"),
);
check(
  "Real PDF upload and text/page extraction",
  uploaded.status === 201 &&
    uploaded.data.versions[0].processingStatus === "complete" &&
    uploaded.data.versions[0].extractedText.includes("Independent evidence") &&
    uploaded.data.versions[0].pages[0].page === 1,
  { status: uploaded.status },
);
const id = uploaded.data.id;
const v1 = uploaded.data.versions[0];
check("Upload response omits storage key", !("objectKey" in v1));
check(
  "Other agent direct metadata denied",
  (await request("/api/v1/documents/" + id, other)).status === 404,
);
check(
  "Other agent direct download denied",
  (await request("/api/v1/documents/" + id + "/download", other)).status ===
    404,
);
check(
  "Client unshared metadata denied",
  (await request("/api/v1/documents/" + id, client)).status === 404,
);
check(
  "Client unshared download denied",
  (await request("/api/v1/documents/" + id + "/download", client)).status ===
    404,
);
const orig = await request("/api/v1/documents/" + id + "/download", agent);
check(
  "Authorized download exact original",
  orig.status === 200 &&
    orig.bytes.equals(bytes1) &&
    orig.headers.get("cache-control") === "private, no-store",
);
const bytes2 = pdf("Independent amended contract Closing November 25 2026");
const versioned = await request(
  "/api/v1/documents/" + id + "/versions",
  agent,
  "POST",
  form(bytes2),
);
check(
  "Second version created",
  versioned.status === 201 && versioned.data.versions[0].version === 2,
);
const old = await request(
    "/api/v1/documents/" + id + "/download?versionId=" + v1.id,
    agent,
  ),
  newest = await request("/api/v1/documents/" + id + "/download", agent);
check(
  "Immutable first version preserved",
  old.status === 200 && old.bytes.equals(bytes1),
);
check(
  "Latest download reflects version2",
  newest.status === 200 && newest.bytes.equals(bytes2),
);
const shared = await request("/api/v1/documents/" + id, owner, "PATCH", {
  expectedRevision: versioned.data.revision,
  visibility: "client",
});
check("Coordinator shares document", shared.status === 200, {
  status: shared.status,
});
check(
  "Client sees explicitly shared document",
  (await request("/api/v1/documents/" + id + "/download", client)).status ===
    200,
);
const draft = await request(
  "/api/v1/documents",
  agent,
  "POST",
  form(pdf("Private unassigned intake evidence")),
);
check("Draft upload accepted", draft.status === 201);
check(
  "Unrelated agent cannot read draft",
  (await request("/api/v1/documents/" + draft.data.id, other)).status === 404,
);
check(
  "Client cannot read draft",
  (await request("/api/v1/documents/" + draft.data.id, client)).status === 404,
);
check(
  "Draft excluded from unrelated agent list",
  !(await request("/api/v1/documents", other)).data.some(
    (d) => d.id === draft.data.id,
  ),
);
const invalid = await request(
  "/api/v1/documents",
  agent,
  "POST",
  form(Buffer.from("not a valid document"), "bad.pdf"),
);
check("Spoofed PDF rejected", invalid.status === 415);
const legacy = await request(
  "/api/v1/documents",
  agent,
  "POST",
  form(Buffer.from("synthetic legacy"), "legacy.doc"),
);
check(
  "Legacy DOC returns actionable conversion",
  legacy.status === 415 && legacy.data.error.code === "CONVERSION_REQUIRED",
);
check(
  "Client upload denied",
  (await request("/api/v1/documents", client, "POST", form(bytes1))).status ===
    403,
);
const wrong = await request(
  "/api/v1/documents/" +
    id +
    "/download?versionId=" +
    draft.data.versions[0].id,
  agent,
);
check("Other document version cannot be substituted", wrong.status === 404);
console.log(
  JSON.stringify(
    { candidate: "2859d65", checks: results.length, failures, results },
    null,
    2,
  ),
);
