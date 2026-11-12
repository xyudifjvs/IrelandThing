import { prisma, Prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import { entityIdSchema } from "@weatherly/platform/handoff-contracts";
import { z } from "zod";
import { htoFilters, type HtoClosingRow } from "./contracts";
import { filterRows, loadHtoOperations } from "./queries";

const columns = [
  "First Name",
  "Last Name",
  "Email",
  "Phone",
  "Street",
  "City",
  "State",
  "ZIP",
  "Close Date",
  "Sale Price",
  "Side",
  "Agent",
];

const exportInput = z
  .object({
    filters: htoFilters,
    rowIds: z.array(entityIdSchema).default([]),
  })
  .strict();

function cell(value: string, index: number) {
  // Quoting alone does not disable spreadsheet formulas. A plain international
  // telephone number is safe and keeps its leading + for the FUB import.
  const normalized = value.normalize("NFKC");
  const internationalPhone = index === 3 && /^\+\d[\d ()-]*$/.test(normalized);
  const formula =
    /^[\u0000-\u0020]*[=+\-@]/.test(normalized) || /^[\t\r\n]/.test(normalized);
  const safe = formula && !internationalPhone ? "'" + value : value;
  return /[",\r\n]/.test(safe) ? '"' + safe.replaceAll('"', '""') + '"' : safe;
}

function salePrice(value: number | null) {
  if (value === null) return "";
  const cents = BigInt(value);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

function serializeRows(rows: readonly HtoClosingRow[]) {
  const records = rows.flatMap((row) =>
    row.clients.map((client) => [
      client.firstName,
      client.lastName,
      client.email,
      client.phone,
      row.address?.street ?? "",
      row.address?.city ?? "",
      row.address?.state ?? "",
      row.address?.zip ?? "",
      row.closeDate ?? "",
      salePrice(row.purchasePriceCents),
      row.side === "buyer" ? "Buyer" : "Seller",
      row.agentName ?? "",
    ]),
  );
  return (
    [columns, ...records]
      .map((record) => record.map(cell).join(","))
      .join("\r\n") + "\r\n"
  );
}

function filename(agent?: string) {
  const first = agent?.trim().split(/\s+/)[0];
  const slug = first
    ?.normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 60);
  return slug ? `${slug}-closings-for-FUB.csv` : "closings-for-FUB.csv";
}

export async function exportHtoClosings(
  actor: Principal,
  raw: unknown,
  now = new Date(),
) {
  assertCoordinator(actor);
  const { filters, rowIds } = exportInput.parse(raw);
  return prisma.$transaction(
    async (tx) => {
      const { rows, agents } = await loadHtoOperations(tx);
      const ids = new Set(rowIds);
      const selected = ids.size
        ? rows.filter((row) => ids.has(row.id))
        : filterRows(rows, filters, now);
      if (ids.size && selected.length !== ids.size)
        throw new HttpError(
          409,
          "HTO_EXPORT_SELECTION_CHANGED",
          "A selected row changed. Refresh the closing rows and try again.",
        );
      return {
        filename: filename(
          agents.find((agent) => agent.id === filters.agentId)?.name,
        ),
        csv: serializeRows(selected),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
