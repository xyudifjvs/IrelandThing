import { z } from "zod";
import {
  civilDateSchema,
  entityIdSchema,
  revisionSchema,
} from "@weatherly/platform/handoff-contracts";

import { fileClientsInput } from "../commands/file-fact-clients";

export const htoStatus = z.enum([
  "active_listing",
  "under_contract",
  "closed",
  "fell_through",
]);
export const htoSide = z.enum(["buyer", "seller"]);
export const htoPrice = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const htoAddress = z
  .object({
    street: z.string().trim().min(1).max(300),
    city: z.string().trim().max(120),
    state: z.string().trim().max(80),
    zip: z.string().trim().max(30),
  })
  .strict();
const htoClientFields = z
  .object({
    firstName: z.string().trim().max(200),
    lastName: z.string().trim().max(200),
    email: z
      .string()
      .trim()
      .pipe(z.union([z.literal(""), z.email().max(254)])),
    phone: z.string().trim().max(60),
  })
  .strict();

function hasFullName({ firstName, lastName }: z.infer<typeof htoClientFields>) {
  const name = [firstName, lastName].filter(Boolean).join(" ");
  return name.length >= 1 && name.length <= 200;
}
const clientNameError = "Enter a client name of at most 200 characters.";
export const htoClient = htoClientFields.refine(hasFullName, clientNameError);
const manualFields = {
  address: htoAddress,
  agentRosterId: entityIdSchema.nullable(),
  clients: z.array(htoClient).max(50),
  side: htoSide,
  status: htoStatus,
  closeDate: civilDateSchema.nullable(),
  listedDate: civilDateSchema.nullable(),
  purchasePriceCents: htoPrice.nullable(),
};
export const manualClosingInput = z.object(manualFields).strict();
export const manualClosingEdit = manualClosingInput.extend({
  expectedRevision: revisionSchema,
});
export const linkedClosingEdit = z
  .object({
    expectedRevision: revisionSchema,
    agentRosterId: entityIdSchema.nullable().optional(),
    propertyAddress: z.string().trim().min(1).max(500).optional(),
    address: htoAddress.nullable().optional(),
    clients: fileClientsInput.optional(),
    side: htoSide.optional(),
    purchasePriceCents: htoPrice.nullable().optional(),
  })
  .strict();

export const htoFilters = z
  .object({
    agentId: entityIdSchema.optional(),
    status: htoStatus.optional(),
    range: z
      .enum(["this_month", "last_month", "this_year", "all_time"])
      .default("this_year"),
  })
  .strict();

export type HtoStatus = z.infer<typeof htoStatus>;
export type HtoSide = z.infer<typeof htoSide>;
export type HtoFilters = z.infer<typeof htoFilters>;
export type HtoAddress = z.infer<typeof htoAddress>;
export type HtoClient = z.infer<typeof htoClient>;
export type LinkedClosingEdit = z.infer<typeof linkedClosingEdit>;

export type HtoClosingRow = {
  id: string;
  revision: number;
  matterId: string | null;
  matterRevision: number | null;
  canonicalDateEditable: boolean;
  agentRosterId: string | null;
  agentName: string | null;
  clients: (HtoClient & {
    id?: string;
    name?: string;
    previousClient?: HtoClient;
    previousClientConflict?: true;
  })[];
  propertyAddress: string;
  address: HtoAddress | null;
  side: HtoSide;
  status: HtoStatus;
  closeDate: string | null;
  checklistCloseDate: string | null;
  actualCloseDate: string | null;
  listedDate: string | null;
  purchasePriceCents: number | null;
  previousPriceCents: number | null;
  match: null | {
    key: string;
    candidates: {
      id: string;
      revision: number;
      propertyAddress: string;
      agentName: string | null;
      clientNames: string[];
      clientEmailConflict?: true;
    }[];
  };
};

export type HtoOperationsView = {
  rows: HtoClosingRow[];
  agents: { id: string; name: string; active: boolean }[];
  totals: {
    activeListings: number;
    underContract: number;
    closed: number;
    closedVolumeCents: string;
  };
  byAgent: {
    id: string;
    name: string;
    closed: number;
    closedVolumeCents: string;
  }[];
};

export type HtoExportIssue = {
  rowId: string;
  propertyAddress: string;
  clientNumber: number | null;
  name: string | null;
  missing: ("name" | "phone")[];
};

export function htoClientName(
  client: Pick<
    HtoClosingRow["clients"][number],
    "name" | "firstName" | "lastName"
  >,
) {
  return (
    client.name?.trim() ||
    [client.firstName.trim(), client.lastName.trim()].filter(Boolean).join(" ")
  );
}
