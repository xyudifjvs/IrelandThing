export { formatHtoAddress } from "../../../../../../../packages/matters/src/hto-operations/address";
export { htoClientName as clientName } from "../../../../../../../packages/matters/src/hto-operations/contracts";
export type {
  HtoAddress,
  HtoClient,
  HtoClosingRow,
  HtoExportIssue,
  HtoFilters,
  HtoOperationsView,
  HtoSide,
  HtoStatus,
  LinkedClosingEdit,
} from "../../../../../../../packages/matters/src/hto-operations/contracts";
export type { ChecklistDatePreview } from "../../../../../../../packages/matters/src/date-graph/preview";

import type { HtoStatus } from "../../../../../../../packages/matters/src/hto-operations/contracts";

export const apiPath = "/api/v1/hto-operations";
export const statusLabels = {
  active_listing: "Active listing",
  under_contract: "Under contract",
  closed: "Closed",
  fell_through: "Fell through",
} satisfies Record<HtoStatus, string>;

export function formatCents(value: string | number, showCents = true) {
  const cents = BigInt(value);
  const dollars = (cents / 100n).toLocaleString("en-US");
  const remainder = cents % 100n;
  return (
    "$" +
    dollars +
    (showCents && remainder ? "." + String(remainder).padStart(2, "0") : "")
  );
}

export function priceField(cents: number | null | undefined) {
  if (cents == null) return "";
  const value = BigInt(cents);
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

export function readPrice(value: string) {
  if (!value.trim()) return null;
  const match = /^(\d{1,16})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match)
    throw new Error("Enter a price in dollars with up to two decimal places.");
  const cents =
    BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (cents > Number.MAX_SAFE_INTEGER)
    throw new Error("Enter a smaller purchase price.");
  return Number(cents);
}
