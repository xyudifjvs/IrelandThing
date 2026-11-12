import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

type Request = (
  route: string,
  body?: unknown,
  cookie?: string,
  method?: string,
) => Promise<{ res: Response; data: any }>;

export async function checkCanonicalFile({
  request,
  owner,
  agent,
  client,
  intakePayload,
  origin,
}: {
  request: Request;
  owner: string;
  agent: string;
  client: string;
  intakePayload: Record<string, unknown>;
  origin: string;
}) {
  async function call(
    route: string,
    status: number,
    body?: unknown,
    cookie = owner,
    method?: string,
  ) {
    const reply = await request(route, body, cookie, method);
    assert.equal(
      reply.res.status,
      status,
      `${method || (body === undefined ? "GET" : "POST")} ${route}: ${JSON.stringify(reply.data)}`,
    );
    return reply.data;
  }

  const propertyAddress = "82 Synthetic Canonical Lane, Columbus, OH";
  const pending = await call(
    "/api/v1/intake/drafts",
    201,
    {
      payload: { ...intakePayload, propertyAddress },
    },
    agent,
  );
  const submitted = await call(
    `/api/v1/intake/drafts/${pending.id}/submit`,
    200,
    {
      expectedRevision: pending.revision,
      idempotencyKey: randomUUID(),
    },
    agent,
  );
  const matterId = submitted.matter.id;
  const file = `/api/v1/matters/${matterId}`;
  assert.equal(
    (await call(file, 200, undefined, agent)).stage,
    "pending_review",
  );
  await call(file, 404, undefined, client);
  await call(`${file}/checklist-share`, 409, {});
  await call(`${file}/file-review`, 409);
  await call(`${file}/confirm-file`, 409, {});
  for (const prefix of ["intakes", "intake"])
    await call(
      `/api/v1/${prefix}/submissions/${submitted.submission.id}/create-transaction`,
      409,
      {},
    );

  const reviewPath = "/api/v1/creation-reviews";
  const open = { intakeId: submitted.submission.id, requestId: randomUUID() };
  await call(reviewPath, 403, open, agent);
  const review = await call(reviewPath, 200, open);
  const closeDate = "2027-05-21";
  const input = {
    expectedRevision: review.revision,
    requestId: randomUUID(),
    business: { business: "hto", packageCode: "hto_included" },
    facts: {
      title: "Synthetic canonical closing",
      propertyAddress,
      side: "seller",
      agentId: "agent-local",
      agentRosterId: null,
      purchaseType: "financed",
      purchasePriceCents: 40500000,
      acceptance: null,
      deadlineTimeZone: "America/New_York",
    },
    people: [
      {
        role: "client",
        name: "Synthetic Seller",
        email: "seller@example.test",
        phone: "",
      },
    ],
    dates: [
      {
        key: "closing",
        value: { date: closeDate, instant: null },
        rule: { kind: "fixed" },
      },
    ],
  };
  const confirm = `${reviewPath}/${review.id}/confirm`;
  assert.equal((await call(confirm, 200, input)).matterId, matterId);
  assert.equal((await call(confirm, 200, input)).matterId, matterId);
  const active = await call(file, 200);
  assert.equal(active.stage, "under_contract");
  await call(`${file}/file-review`, 409);
  assert.equal(
    active.tasks.find(
      ({ stepKey }: { stepKey: string }) => stepKey === "closing",
    ).dueDate,
    closeDate,
  );
  assert.equal(active.contacts[0].name, "Synthetic Seller");
  assert.equal(
    (await call(`${reviewPath}/matter/${matterId}/intake`, 200)).snapshot
      .propertyAddress,
    propertyAddress,
  );
  const intakes = await call("/api/v1/portfolio/intakes", 200);
  assert.ok(
    !intakes.items.some(
      ({ id }: { id: string }) => id === submitted.submission.id,
    ),
  );

  await call(`${file}/participants`, 201, {
    userId: "client-local",
    role: "client",
  });
  await call(`${file}/checklist-share`, 403, {}, agent);
  const share = await call(`${file}/checklist-share`, 201, {});
  const token = new URL(share.url).hash.slice(1);
  const shared = await fetch(`${origin}/api/public/checklist`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(shared.status, 200);
  assert.match(shared.headers.get("cache-control") || "", /no-store/);
  const bearer = await shared.json();
  const preview = await call(file, 200, undefined, client);
  assert.deepEqual(preview.tasks, bearer.tasks);
  assert.deepEqual(preview.people, bearer.people);
  assert.deepEqual(preview.notes, []);
  await call(`${reviewPath}/matter/${matterId}/intake`, 403, undefined, client);
  assert.equal(
    (
      await call(
        `/api/v1/billing/account/file-summary?matterId=${matterId}`,
        200,
        undefined,
        agent,
      )
    ).service,
    null,
  );

  const draft = await call("/api/v1/communications/drafts", 201, {
    matterId,
    to: ["outside@example.test"],
    subject: "Synthetic reminder",
    body: "Reviewed synthetic text.",
  });
  const work = `/api/v1/communications/work/${draft.workItemId}`;
  await call(
    work,
    200,
    { action: "later", expectedRevision: 1 },
    owner,
    "PATCH",
  );
  const before = await call(file, 200);
  const terminated = await call(`${file}/terminate`, 200, {
    expectedRevision: before.revision,
    reason: "Synthetic check",
  });
  assert.equal(terminated.stage, "terminated");
  const reopened = await call(`${file}/reopen`, 200, {
    expectedRevision: terminated.revision,
  });
  assert.equal(reopened.stage, "under_contract");
  assert.deepEqual(
    await call(`/api/v1/communications/work?matterId=${matterId}`, 200),
    [],
  );

  const hto = () => call("/api/v1/hto-operations?range=all_time", 200);
  const row = (await hto()).rows.find(
    (entry: { matterId: string }) => entry.matterId === matterId,
  );
  assert.ok(row, "Creation should link the HTO row exactly once");
  const moved = await call(
    `${file}/business`,
    200,
    {
      expectedRevision: reopened.revision,
      business: { business: "weatherly", packageCode: "essentials" },
    },
    owner,
    "PATCH",
  );
  assert.ok(
    !(await hto()).rows.some((entry: { id: string }) => entry.id === row.id),
  );
  const returned = await call(
    `${file}/business`,
    200,
    {
      expectedRevision: moved.revision,
      business: { business: "hto", packageCode: "hto_included" },
    },
    owner,
    "PATCH",
  );
  assert.ok(
    (await hto()).rows.some((entry: { id: string }) => entry.id === row.id),
  );
  await call(
    file,
    200,
    { expectedRevision: returned.revision, confirmation: "DELETE" },
    owner,
    "DELETE",
  );
  await call(file, 404);
  assert.ok(
    !(await hto()).rows.some((entry: { id: string }) => entry.id === row.id),
  );
  assert.equal(
    (
      await fetch(`${origin}/api/public/checklist`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status,
    404,
  );
}
