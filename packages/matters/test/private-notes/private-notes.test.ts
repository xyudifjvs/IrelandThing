import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import {
  addPrivateTodo,
  clearCompletedPrivateTodos,
  listPrivateTodos,
  readPrivateScratchpad,
  removePrivateTodo,
  savePrivateScratchpad,
  setPrivateTodoCompletion,
} from "../../src/private-notes/service";

function principal(role: Principal["role"]): Principal {
  const id = randomUUID();
  return {
    id,
    role,
    email: `${id}@example.test`,
    name: "Synthetic reviewer fixture",
    sessionId: id,
  };
}

const owner = principal("coordinator");
const other = principal("coordinator");
const agent = principal("agent");
const client = principal("client");
const principals = [owner, other, agent, client];
let fileId: string;

beforeAll(async () => {
  await prisma.user.createMany({
    data: principals.map(({ id, email, name, role }) => ({
      id,
      email,
      name,
      role,
    })),
  });
  const file = await prisma.matter.create({
    data: {
      title: "Synthetic buyer file",
      propertyAddress: "41 Test Street",
      side: "buyer",
      packageCode: "essentials",
    },
  });
  fileId = file.id;
});

afterAll(async () => {
  if (fileId) await prisma.matter.deleteMany({ where: { id: fileId } });
  await prisma.user.deleteMany({
    where: { id: { in: principals.map(({ id }) => id) } },
  });
});

it("uses one owner-scoped item across notes and file views and clears only completed items", async () => {
  const attached = await addPrivateTodo(owner, {
    matterId: fileId,
    body: "Confirm the wire instructions",
  });
  const general = await addPrivateTodo(owner, { body: "General follow-up" });
  await addPrivateTodo(other, { body: "Unrelated owner" });
  expect((await listPrivateTodos(owner, {})).items.map(({ id }) => id)).toEqual(
    [general.id, attached.id],
  );
  await expect(
    setPrivateTodoCompletion(other, attached.id, {
      expectedRevision: 1,
      completed: true,
    }),
  ).rejects.toMatchObject({ status: 409 });
  const finished = await setPrivateTodoCompletion(owner, attached.id, {
    expectedRevision: attached.revision,
    completed: true,
  });
  expect((await listPrivateTodos(owner, { matterId: fileId })).items).toEqual([
    finished,
  ]);
  await expect(
    removePrivateTodo(owner, attached.id, { expectedRevision: 1 }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await clearCompletedPrivateTodos(owner, { matterId: fileId })).toEqual(
    { removed: 1 },
  );
  expect((await listPrivateTodos(owner, {})).items).toEqual([general]);
  expect((await listPrivateTodos(other, {})).total).toBe(1);
});

it("keeps autosaved scratchpads private and rejects stale saves", async () => {
  await expect(
    savePrivateScratchpad(other, {
      body: "Draft from a prior account",
      expectedRevision: 0,
      expectedOwnerId: owner.id,
    }),
  ).rejects.toMatchObject({ status: 409, code: "SCRATCHPAD_OWNER_CHANGED" });
  await expect(
    readPrivateScratchpad(other, { expectedOwnerId: owner.id }),
  ).rejects.toMatchObject({ status: 409, code: "SCRATCHPAD_OWNER_CHANGED" });
  const first = await savePrivateScratchpad(owner, {
    body: "Private note",
    expectedRevision: 0,
    expectedOwnerId: owner.id,
  });
  const race = await Promise.allSettled([
    savePrivateScratchpad(owner, {
      body: "Tab A",
      expectedRevision: first.revision,
    }),
    savePrivateScratchpad(owner, {
      body: "Tab B",
      expectedRevision: first.revision,
    }),
  ]);
  expect(race.map(({ status }) => status).sort()).toEqual([
    "fulfilled",
    "rejected",
  ]);
  expect((await readPrivateScratchpad(owner)).revision).toBe(
    first.revision + 1,
  );
  expect(await readPrivateScratchpad(other)).toEqual({ body: "", revision: 0 });
  await expect(readPrivateScratchpad(agent)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    listPrivateTodos(client, { matterId: fileId }),
  ).rejects.toMatchObject({ status: 403 });
});
