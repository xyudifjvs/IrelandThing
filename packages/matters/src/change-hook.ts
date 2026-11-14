import type { Prisma } from "@weatherly/db";
import type { Principal } from "@weatherly/platform";

export type MatterChangeHook = (
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
) => Promise<void>;

let matterChangeHook: MatterChangeHook | undefined;

export function registerMatterChangeHook(hook?: MatterChangeHook) {
  matterChangeHook = hook;
}

export async function matterChanged(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
) {
  if (matterChangeHook) await matterChangeHook(tx, actor, matterId);
}
