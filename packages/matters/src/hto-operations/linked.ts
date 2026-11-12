import { prisma, type Prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import {
  entityIdSchema,
  revisionSchema,
} from "@weatherly/platform/handoff-contracts";
import { z } from "zod";
import { audit, requireMatter } from "../access";
import { exactAddressKey, formatHtoAddress } from "./address";
import { linkedClosingEdit, type LinkedClosingEdit } from "./contracts";
import {
  activeManualMatches,
  automaticManualMatch,
  matchKey,
  matterAddress,
} from "./matching";
import {
  decimalCents,
  eligibleMatter,
  htoInclude,
  htoMatterInclude,
  isHtoTeamMember,
  jsonRecord,
  lockHtoOperations,
  requireHtoTeamMember,
  type HtoMatter,
  type StoredHtoClosing,
} from "./storage";

type Tx = Prisma.TransactionClient;
export type UpdateLinkedFileFacts = (
  tx: Tx,
  actor: Principal,
  matterId: string,
  input: LinkedClosingEdit,
) => Promise<{ matterId: string; revision: number }>;

const rowRef = { id: true, revision: true };

function linkedAddressKey(matter: HtoMatter) {
  const address = matterAddress(matter);
  return exactAddressKey(
    address ? formatHtoAddress(address) : matter.propertyAddress,
  );
}

function manualRows(tx: Tx) {
  return tx.htoClosing.findMany({
    where: { matterId: null },
    include: htoInclude,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

async function linkManualRow(
  tx: Tx,
  actor: Principal,
  matter: HtoMatter,
  manual: StoredHtoClosing,
  replacedRowId: string | null,
) {
  const linked = await tx.htoClosing.update({
    where: { id: manual.id },
    data: {
      matterId: matter.id,
      matchKey: linkedAddressKey(matter),
      revision: { increment: 1 },
    },
    select: rowRef,
  });
  await audit(
    tx,
    actor,
    "hto.manual_linked",
    "HtoClosing",
    linked.id,
    matter.id,
    { replacedRowId },
  );
  const previous = decimalCents(manual.manualPriceCents);
  const current = decimalCents(matter.purchasePriceCents);
  if (previous !== null && current !== previous) {
    await audit(
      tx,
      actor,
      "hto.price_changed",
      "HtoClosing",
      linked.id,
      matter.id,
      {
        previousPurchasePriceCents: previous,
        purchasePriceCents: current,
      },
    );
  }
  return linked;
}

/** Run after publishing or changing the canonical file, inside its write transaction. */
export async function syncHtoClosing(
  tx: Tx,
  actor: Principal,
  matterId: string,
) {
  const file = await requireMatter(actor, matterId, true, tx);
  if (!eligibleMatter(file)) return null;
  await lockHtoOperations(tx);
  const existing = await tx.htoClosing.findUnique({
    where: { matterId },
    select: { ...rowRef, matchKey: true },
  });
  const matter = await tx.matter.findUniqueOrThrow({
    where: { id: matterId },
    include: htoMatterInclude,
  });
  const addressKey = linkedAddressKey(matter);
  if (existing) {
    if (existing.matchKey === addressKey)
      return { id: existing.id, revision: existing.revision };
    return tx.htoClosing.update({
      where: { id: existing.id },
      data: { matchKey: addressKey, revision: { increment: 1 } },
      select: rowRef,
    });
  }
  if (await isHtoTeamMember(tx, matter.agentRosterId)) {
    const candidates = activeManualMatches(matter, await manualRows(tx));
    if (candidates.length === 1) {
      const otherLinked = await tx.htoClosing.findMany({
        where: { matter: { business: "hto" } },
        include: htoInclude,
      });
      const candidate = automaticManualMatch(matter, candidates, otherLinked);
      if (candidate) return linkManualRow(tx, actor, matter, candidate, null);
    }
  }
  const linked = await tx.htoClosing.create({
    data: { matterId, matchKey: addressKey },
    select: rowRef,
  });
  await audit(tx, actor, "hto.file_linked", "HtoClosing", linked.id, matterId);
  return linked;
}

/** Resolve the restrictive FK before the canonical file's permanent delete. */
export async function removeHtoClosingBeforeDelete(
  tx: Tx,
  actor: Principal,
  matterId: string,
) {
  await requireMatter(actor, matterId, true, tx);
  await lockHtoOperations(tx);
  const row = await tx.htoClosing.findUnique({
    where: { matterId },
    select: { id: true },
  });
  if (row) {
    await tx.htoClosing.delete({ where: { id: row.id } });
    await audit(
      tx,
      actor,
      "hto.file_row_removed",
      "HtoClosing",
      row.id,
      matterId,
    );
  }
}

export async function withLinkedClosing<T>(
  actor: Principal,
  id: string,
  operation: (tx: Tx, row: StoredHtoClosing, matter: HtoMatter) => Promise<T>,
) {
  assertCoordinator(actor);
  return prisma.$transaction(async (tx) => {
    const ref = await tx.htoClosing.findUnique({
      where: { id },
      select: { matterId: true },
    });
    if (!ref?.matterId)
      throw new HttpError(
        404,
        "HTO_ROW_NOT_FOUND",
        "Linked closing row not found.",
      );
    await requireMatter(actor, ref.matterId, true, tx);
    const row = await tx.htoClosing.findUnique({
      where: { id },
      include: htoInclude,
    });
    if (
      !row?.matter ||
      row.matterId !== ref.matterId ||
      !eligibleMatter(row.matter)
    )
      throw new HttpError(
        404,
        "HTO_ROW_NOT_FOUND",
        "Linked closing row not found.",
      );
    return operation(tx, row, row.matter);
  });
}

export async function updateLinkedClosing(
  actor: Principal,
  id: string,
  raw: unknown,
  updateFileFacts: UpdateLinkedFileFacts,
) {
  assertCoordinator(actor);
  const input = linkedClosingEdit.parse(raw);
  if (
    input.address &&
    input.propertyAddress &&
    formatHtoAddress(input.address) !== input.propertyAddress
  )
    throw new HttpError(
      422,
      "HTO_ADDRESS_CONFLICT",
      "The property address must match its street, city, state and ZIP.",
    );
  return withLinkedClosing(actor, id, async (tx, _row, matter) => {
    if (
      input.agentRosterId !== undefined &&
      input.agentRosterId !== matter.agentRosterId
    )
      await requireHtoTeamMember(tx, input.agentRosterId);
    return updateFileFacts(tx, actor, matter.id, input);
  });
}

const matchFields = {
  key: z.string().regex(/^[a-f0-9]{64}$/),
  expectedMatterRevision: revisionSchema,
  expectedRowRevision: revisionSchema,
};
const matchAction = z.discriminatedUnion("action", [
  z.object({ ...matchFields, action: z.literal("dismiss") }).strict(),
  z
    .object({
      ...matchFields,
      action: z.literal("link"),
      candidateId: entityIdSchema,
      candidateRevision: revisionSchema,
    })
    .strict(),
]);

export async function resolveHtoMatch(
  actor: Principal,
  id: string,
  raw: unknown,
) {
  assertCoordinator(actor);
  const input = matchAction.parse(raw);
  return withLinkedClosing(actor, id, async (tx, row, matter) => {
    await lockHtoOperations(tx);
    const candidates = activeManualMatches(matter, await manualRows(tx));
    const key = matchKey(matter, candidates);
    if (
      row.manualPropertyAddress ||
      matter.revision !== input.expectedMatterRevision ||
      row.revision !== input.expectedRowRevision ||
      key !== input.key ||
      !candidates.length
    ) {
      throw new HttpError(
        409,
        "HTO_MATCH_CONFLICT",
        "The suggested match changed. Refresh and check the address again.",
      );
    }
    const dismissals = await tx.auditEvent.findMany({
      where: {
        entityType: "HtoClosing",
        entityId: id,
        action: "hto.match_dismissed",
      },
      select: { details: true },
    });
    if (dismissals.some((event) => jsonRecord(event.details).key === key)) {
      if (input.action === "dismiss") return { id, revision: row.revision };
      throw new HttpError(
        409,
        "HTO_MATCH_CONFLICT",
        "This match was dismissed. Refresh the closing rows.",
      );
    }
    if (input.action === "dismiss") {
      await audit(
        tx,
        actor,
        "hto.match_dismissed",
        "HtoClosing",
        id,
        matter.id,
        { key },
      );
      return { id, revision: row.revision };
    }
    const candidate = candidates.find(
      (item) =>
        item.id === input.candidateId &&
        item.revision === input.candidateRevision,
    );
    if (!candidate)
      throw new HttpError(
        409,
        "HTO_MATCH_CONFLICT",
        "The manual row changed. Refresh and check the address again.",
      );
    await tx.htoClosing.delete({ where: { id } });
    return linkManualRow(tx, actor, matter, candidate, id);
  });
}
