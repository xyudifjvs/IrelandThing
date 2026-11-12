import { prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import type { z } from "zod";
import { audit } from "../access";
import { exactAddressKey, formatHtoAddress } from "./address";
import { manualClosingEdit, manualClosingInput } from "./contracts";
import {
  decimalCents,
  lockHtoOperations,
  requireHtoTeamMember,
} from "./storage";

function manualData(input: z.infer<typeof manualClosingInput>) {
  const propertyAddress = formatHtoAddress(input.address);
  const listing = input.status === "active_listing";
  return {
    manualAgentRosterId: input.agentRosterId,
    manualPropertyAddress: propertyAddress,
    manualAddress: input.address,
    manualClients: input.clients,
    manualSide: input.side,
    manualStatus: input.status,
    manualCloseDate: listing ? null : input.closeDate,
    manualListedDate: input.listedDate,
    manualPriceCents: listing ? null : input.purchasePriceCents,
    matchKey: exactAddressKey(propertyAddress),
  };
}

export async function addManualClosing(actor: Principal, raw: unknown) {
  assertCoordinator(actor);
  const input = manualClosingInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    await lockHtoOperations(tx);
    await requireHtoTeamMember(tx, input.agentRosterId);
    const row = await tx.htoClosing.create({
      data: manualData(input),
      select: { id: true, revision: true },
    });
    await audit(tx, actor, "hto.manual_added", "HtoClosing", row.id, null);
    return row;
  });
}

export async function updateManualClosing(
  actor: Principal,
  id: string,
  raw: unknown,
) {
  assertCoordinator(actor);
  const input = manualClosingEdit.parse(raw);
  return prisma.$transaction(async (tx) => {
    await lockHtoOperations(tx);
    const current = await tx.htoClosing.findUnique({ where: { id } });
    if (!current)
      throw new HttpError(404, "HTO_ROW_NOT_FOUND", "Closing row not found.");
    if (current.matterId || current.revision !== input.expectedRevision)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "This closing row changed. Refresh and edit it again.",
      );
    if (current.manualAgentRosterId !== input.agentRosterId)
      await requireHtoTeamMember(tx, input.agentRosterId);
    const data = manualData(input);
    const row = await tx.htoClosing.update({
      where: { id },
      data: { ...data, revision: { increment: 1 } },
      select: { id: true, revision: true },
    });
    const previous = decimalCents(current.manualPriceCents);
    if (previous !== data.manualPriceCents) {
      await audit(tx, actor, "hto.price_changed", "HtoClosing", id, null, {
        previousPurchasePriceCents: previous,
        purchasePriceCents: data.manualPriceCents,
      });
    }
    await audit(tx, actor, "hto.manual_updated", "HtoClosing", id, null, {
      previousStatus: current.manualStatus,
      status: data.manualStatus,
    });
    return row;
  });
}
