import type { Prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import {
  revisionSchema,
  transactionFactsSchema,
} from "@weatherly/platform/handoff-contracts";
import { z } from "zod";
import { audit, requireMatter } from "../access";
import { matterChanged } from "../change-hook";
import { fileReviewPending } from "../file-review";
import { json } from "../validation/common";
import { resolveAgentAssignment } from "./agent-assignment";
import { fileClientsInput, writeFileClients } from "./file-fact-clients";
import { adjustFilePurchaseType } from "./file-purchase-type";

const addressInput = z
  .object({
    street: z.string().trim().max(300),
    city: z.string().trim().max(120),
    state: z.string().trim().max(80),
    zip: z.string().trim().max(30),
  })
  .strict();

const updateFileFactsInput = transactionFactsSchema
  .pick({
    agentRosterId: true,
    agentId: true,
    propertyAddress: true,
    side: true,
    purchasePriceCents: true,
    purchaseType: true,
    earnestMoneyCents: true,
    earnestMoneyHolder: true,
    homeWarrantyCents: true,
    homeWarrantyCompany: true,
  })
  .extend({
    address: addressInput.nullable(),
    clients: fileClientsInput,
  })
  .partial()
  .extend({
    expectedRevision: revisionSchema,
  })
  .refine(
    ({ expectedRevision, ...facts }) =>
      Object.values(facts).some((value) => value !== undefined),
    "Provide at least one file fact to update.",
  );

export type UpdateFileFactsInput = z.input<typeof updateFileFactsInput>;

function formatAddress({
  street,
  city,
  state,
  zip,
}: z.infer<typeof addressInput>) {
  return [street, city, [state, zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
}

const activeStages = new Set(["listing", "under_contract", "closing"]);
const terminalStages = new Set(["closed", "terminated"]);

/** C00 injects this command into linked HTO edits so it participates in their transaction. */
export async function updateFileFacts(
  tx: Prisma.TransactionClient,
  actor: Principal,
  matterId: string,
  input: UpdateFileFactsInput,
): Promise<{ matterId: string; revision: number }> {
  assertCoordinator(actor);
  const { expectedRevision, address, clients, ...facts } =
    updateFileFactsInput.parse(input);
  const matter = await requireMatter(actor, matterId, true, tx);
  if (matter.revision !== expectedRevision)
    throw new HttpError(
      409,
      "REVISION_CONFLICT",
      "The file changed. Refresh before editing.",
    );
  const editable =
    activeStages.has(matter.stage) ||
    (matter.business === "hto" && terminalStages.has(matter.stage));
  if (fileReviewPending(matter) || !editable)
    throw new HttpError(
      409,
      "FILE_FACTS_UNAVAILABLE",
      "Choose a published transaction to edit its facts.",
    );

  const structuredPropertyAddress = address
    ? formatAddress(address)
    : undefined;
  if (
    structuredPropertyAddress !== undefined &&
    facts.propertyAddress !== undefined &&
    facts.propertyAddress !== structuredPropertyAddress
  )
    throw new HttpError(
      422,
      "INVALID_FILE_ADDRESS",
      "The property address must match its street, city, state and ZIP.",
    );
  const propertyAddress = structuredPropertyAddress ?? facts.propertyAddress;
  if (
    propertyAddress !== undefined &&
    !transactionFactsSchema.shape.propertyAddress.safeParse(propertyAddress)
      .success
  )
    throw new HttpError(
      422,
      "INVALID_FILE_ADDRESS",
      "Enter a nonempty property address of at most 500 characters.",
    );

  const data: Prisma.MatterUncheckedUpdateInput = {
    ...(propertyAddress !== undefined ? { propertyAddress } : {}),
    ...(facts.side !== undefined ? { side: facts.side } : {}),
    ...(facts.purchasePriceCents !== undefined
      ? { purchasePriceCents: facts.purchasePriceCents }
      : {}),
    revision: { increment: 1 },
  };

  if (facts.agentRosterId !== undefined || facts.agentId !== undefined) {
    const agentRosterId =
      facts.agentRosterId !== undefined
        ? facts.agentRosterId
        : facts.agentId !== undefined
          ? null
          : matter.agentRosterId;
    data.agentRosterId = agentRosterId;
    data.agentId = await resolveAgentAssignment(tx, {
      agentId: facts.agentId ?? null,
      agentRosterId,
    });
  }

  if (
    propertyAddress !== undefined &&
    matter.title === matter.propertyAddress.slice(0, 200)
  )
    data.title = propertyAddress.slice(0, 200);

  if (
    address !== undefined ||
    propertyAddress !== undefined ||
    clients !== undefined ||
    facts.purchaseType !== undefined
  ) {
    const details = json.safeParse(matter.details).data ?? {};
    if (facts.purchaseType !== undefined)
      details.purchaseType = facts.purchaseType;
    if (address) details.structuredAddress = address;
    else if (address === null) delete details.structuredAddress;
    else if (propertyAddress !== undefined) {
      const stored = addressInput.safeParse(details.structuredAddress).data;
      if (!stored || formatAddress(stored) !== propertyAddress)
        delete details.structuredAddress;
    }
    if (clients !== undefined)
      details.structuredClientNames = await writeFileClients(
        tx,
        matterId,
        clients,
        details.structuredClientNames,
      );
    data.details = details;
  }

  for (const [keys, amount, company, amountKey, companyKey, companyField] of [
    [
      ["earnest_money_due"],
      facts.earnestMoneyCents,
      facts.earnestMoneyHolder,
      "earnestMoneyCents",
      "earnestMoneyHolder",
      "holder",
    ],
    [
      ["home_warranty", "home_warranty_ordered"],
      facts.homeWarrantyCents,
      facts.homeWarrantyCompany,
      "homeWarrantyCents",
      "homeWarrantyCompany",
      "company",
    ],
  ] as const) {
    if (amount === undefined && company === undefined) continue;
    if (matter.checklistVersion !== 1 || !activeStages.has(matter.stage))
      throw new HttpError(
        409,
        "CHECKLIST_READ_ONLY",
        "Use an active transaction's current checklist to edit earnest money or warranty details.",
      );
    const step = await tx.task.findFirst({
      where: { matterId, stepKey: { in: [...keys] } },
    });
    if (!step)
      throw new HttpError(
        409,
        "CHECKLIST_STEP_MISSING",
        "The corresponding checklist step is unavailable. Refresh the file before editing its amount.",
      );
    const details = json.safeParse(step.details).data ?? {};
    if (amount !== undefined) {
      details.amountCents = amount;
      delete details[amountKey];
    }
    if (company !== undefined) {
      details[companyField] = company;
      delete details[companyKey];
    }
    await tx.task.update({
      where: { id: step.id },
      data: { details, revision: { increment: 1 } },
    });
    await audit(tx, actor, "task.updated", "Task", step.id, matterId, {
      before: JSON.parse(JSON.stringify(step)),
      changes: {
        ...(amount !== undefined ? { amountCents: amount } : {}),
        ...(company !== undefined ? { [companyField]: company } : {}),
      },
    });
  }

  const updated = await tx.matter.update({
    where: { id: matterId },
    data,
  });
  if (
    facts.purchaseType !== undefined &&
    facts.purchaseType !==
      (json.safeParse(matter.details).data?.purchaseType ?? null)
  ) {
    if (!activeStages.has(matter.stage))
      throw new HttpError(
        409,
        "CHECKLIST_READ_ONLY",
        "Reopen this transaction before changing its purchase type.",
      );
    await adjustFilePurchaseType(tx, actor, updated, facts.purchaseType);
  }
  const previousPurchasePriceCents =
    matter.purchasePriceCents?.toNumber() ?? null;
  const purchasePriceCents = facts.purchasePriceCents;
  await audit(tx, actor, "matter.facts_updated", "Matter", matterId, matterId, {
    beforeRevision: matter.revision,
    fields: [
      ...Object.keys(facts),
      ...(address !== undefined ? ["address"] : []),
      ...(clients !== undefined ? ["clients"] : []),
    ],
    ...(purchasePriceCents !== undefined &&
    purchasePriceCents !== previousPurchasePriceCents
      ? { previousPurchasePriceCents, purchasePriceCents }
      : {}),
  });
  await matterChanged(tx, actor, matterId);
  return { matterId, revision: updated.revision };
}
