import type { UpdateFileFactsInput } from "../../../../../../../packages/matters/src/commands/file-facts";
import type { TransactionFile } from "./file-model";
import {
  hasVersionedChecklist,
  type ChecklistMatter,
  type ChecklistTaskRecord,
} from "../checklist/canonical-checklist-model";

export type FileDetailsDraft = {
  propertyAddress: string;
  side: "buyer" | "seller";
  purchaseType: "cash" | "financed" | "";
  purchasePrice: string;
  agentId: string | null;
  agentRosterId: string | null;
  earnestMoney: string;
  earnestMoneyHolder: string;
  homeWarranty: string;
  homeWarrantyCompany: string;
};

function amountField(value: unknown) {
  if (value == null || !/^\d+$/.test(String(value))) return "";
  const cents = BigInt(String(value));
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export function readFileAmount(
  value: string,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  if (!value.trim()) return null;
  const match = /^(\d{1,16})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match)
    throw Error(`Enter ${name} in dollars with up to two decimal places.`);
  const cents =
    BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (cents > BigInt(maximum)) throw Error(`Enter a smaller ${name}.`);
  return Number(cents);
}

export function fileDetailsDraft(file: TransactionFile): FileDetailsDraft {
  const versioned: ChecklistMatter | null = hasVersionedChecklist(file)
    ? file
    : null;
  const tasks: ChecklistTaskRecord[] = versioned?.tasks ?? [];
  const emd = tasks.find(
    (task) => task.stepKey === "earnest_money_due",
  )?.details;
  const warranty = tasks.find((task) =>
    ["home_warranty", "home_warranty_ordered"].includes(task.stepKey),
  )?.details;
  const type = file.details?.purchaseType;
  return {
    propertyAddress: file.propertyAddress ?? "",
    side: file.side === "seller" ? "seller" : "buyer",
    purchaseType: type === "cash" || type === "financed" ? type : "",
    purchasePrice: amountField(file.purchasePriceCents),
    agentId: file.agentId ?? null,
    agentRosterId: file.agentRosterId ?? null,
    earnestMoney: amountField(emd?.amountCents ?? emd?.earnestMoneyCents),
    earnestMoneyHolder: emd?.holder ?? emd?.earnestMoneyHolder ?? "",
    homeWarranty: amountField(
      warranty?.amountCents ?? warranty?.homeWarrantyCents,
    ),
    homeWarrantyCompany:
      warranty?.company ?? warranty?.homeWarrantyCompany ?? "",
  };
}

/** Submit only edited facts, including explicit clears; unrelated values stay saved. */
export function fileDetailsPatch(
  initial: FileDetailsDraft,
  draft: FileDetailsDraft,
): Omit<UpdateFileFactsInput, "expectedRevision"> {
  const patch: Omit<UpdateFileFactsInput, "expectedRevision"> = {};
  if (draft.propertyAddress !== initial.propertyAddress)
    patch.propertyAddress = draft.propertyAddress.trim();
  if (draft.side !== initial.side) patch.side = draft.side;
  if (draft.purchaseType !== initial.purchaseType)
    patch.purchaseType = draft.purchaseType || null;
  if (draft.purchasePrice !== initial.purchasePrice)
    patch.purchasePriceCents = readFileAmount(
      draft.purchasePrice,
      "purchase price",
    );
  if (
    draft.agentRosterId !== initial.agentRosterId ||
    draft.agentId !== initial.agentId
  ) {
    patch.agentId = draft.agentId;
    patch.agentRosterId = draft.agentRosterId;
  }
  if (draft.earnestMoney !== initial.earnestMoney)
    patch.earnestMoneyCents = readFileAmount(
      draft.earnestMoney,
      "earnest money amount",
      10000000000,
    );
  if (draft.earnestMoneyHolder !== initial.earnestMoneyHolder)
    patch.earnestMoneyHolder = draft.earnestMoneyHolder;
  if (draft.homeWarranty !== initial.homeWarranty)
    patch.homeWarrantyCents = readFileAmount(
      draft.homeWarranty,
      "home warranty amount",
      10000000000,
    );
  if (draft.homeWarrantyCompany !== initial.homeWarrantyCompany)
    patch.homeWarrantyCompany = draft.homeWarrantyCompany;
  return patch;
}
