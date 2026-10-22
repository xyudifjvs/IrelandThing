import { afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@weatherly/db";
import { claimJob, executeJob } from "./jobs";
const suffix = randomUUID(),
  ids = [`lease-one-${suffix}`, `lease-two-${suffix}`];
afterAll(async () => {
  await prisma.outboxJob.deleteMany({ where: { id: { in: ids } } });
});
it("claims disjoint work concurrently and recovers an expired worker lease", async () => {
  await prisma.outboxJob.createMany({
    data: ids.map((id) => ({
      id,
      topic: `lease-test-${suffix}`,
      payload: { synthetic: true },
      idempotencyKey: id,
      availableAt: new Date(0),
    })),
  });
  const [a, b] = await Promise.all([
    claimJob(`a-${suffix}`),
    claimJob(`b-${suffix}`),
  ]);
  expect(new Set([a?.id, b?.id])).toEqual(new Set(ids));
  expect(a?.attempts).toBe(1);
  expect(b?.attempts).toBe(1);
  await prisma.outboxJob.update({
    where: { id: a!.id },
    data: { leaseUntil: new Date(0) },
  });
  const reclaimed = await claimJob(`recovery-${suffix}`);
  expect(reclaimed?.id).toBe(a!.id);
  expect(reclaimed?.attempts).toBe(2);
  // The abandoned owner's completion must not finalize work leased to someone else.
  await executeJob(`a-${suffix}`, a!, { [a!.topic]: async () => {} });
  expect(
    (await prisma.outboxJob.findUniqueOrThrow({ where: { id: a!.id } })).state,
  ).toBe("running");
  await executeJob(`recovery-${suffix}`, reclaimed!, {
    [reclaimed!.topic]: async () => {},
  });
  expect(
    (await prisma.outboxJob.findUniqueOrThrow({ where: { id: a!.id } })).state,
  ).toBe("complete");
});
