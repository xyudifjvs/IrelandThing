import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";
import { requireMatter } from "../src/index";
const id = `matter-lock-${randomUUID()}`,
  ids: string[] = [];
const actor: Principal = {
  id,
  role: "coordinator",
  name: "Synthetic reviewer",
  email: `${id}@example.test`,
  sessionId: id,
};
beforeAll(async () => {
  await prisma.user.create({
    data: { id, name: actor.name, email: actor.email, role: actor.role },
  });
});
afterAll(async () => {
  await prisma.matter.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.delete({ where: { id } });
  await prisma.$disconnect();
});
const signal = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
describe("current matter authorization under a write lock", () => {
  it("re-reads committed revisions/conflicts after contention and rejects a row deleted while waiting", async () => {
    for (const change of ["update", "delete"] as const) {
      const matter = await prisma.matter.create({
        data: {
          title: "Synthetic lock contention",
          propertyAddress: "42 Synthetic Lock Road",
          side: "buyer",
          packageCode: "essentials",
        },
      });
      ids.push(matter.id);
      const locked = signal(),
        release = signal(),
        readerStarted = signal();
      let readerPid = 0;
      const writer = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Matter" WHERE id=${matter.id} FOR UPDATE`;
        if (change === "update")
          await tx.matter.update({
            where: { id: matter.id },
            data: {
              revision: { increment: 1 },
              details: { sourceConflicts: [{ key: "fact:property_address" }] },
            },
          });
        else await tx.matter.delete({ where: { id: matter.id } });
        locked.resolve();
        await release.promise;
      });
      await locked.promise;
      const reader = prisma.$transaction(async (tx) => {
        const [backend] = await tx.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        readerPid = backend.pid;
        readerStarted.resolve();
        return requireMatter(actor, matter.id, true, tx);
      });
      const captured = reader.then(
        (value) => ({ value, error: undefined }),
        (error) => ({ value: undefined, error }),
      );
      try {
        await readerStarted.promise;
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const [state] = await prisma.$queryRaw<
            { waiting: boolean }[]
          >`SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=${readerPid}`;
          if (state?.waiting) {
            waiting = true;
            break;
          }
          await new Promise((done) => setTimeout(done, 10));
        }
        expect(waiting).toBe(true);
        release.resolve();
        await writer;
        const result = await captured;
        if (change === "delete")
          expect(result.error).toMatchObject({
            status: 404,
            code: "MATTER_NOT_FOUND",
          });
        else {
          expect(result.error).toBeUndefined();
          expect(result.value).toMatchObject({
            revision: matter.revision + 1,
            details: { sourceConflicts: [{ key: "fact:property_address" }] },
          });
        }
      } finally {
        release.resolve();
        await Promise.allSettled([writer, reader]);
      }
    }
  });
});
