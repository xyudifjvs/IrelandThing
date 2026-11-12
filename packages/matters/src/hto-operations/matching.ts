import { createHash } from "node:crypto";
import { z } from "zod";
import { htoAddress, type HtoStatus } from "./contracts";
import {
  decimalCents,
  jsonRecord,
  type HtoMatter,
  type StoredHtoClosing,
} from "./storage";
import {
  exactAddressKey,
  formatHtoAddress,
  hasLocality,
  nearAddressKey,
} from "./address";

export function matterAddress(matter: HtoMatter) {
  const parsed = htoAddress.safeParse(
    jsonRecord(matter.details).structuredAddress,
  );
  return parsed.success &&
    exactAddressKey(formatHtoAddress(parsed.data)) ===
      exactAddressKey(matter.propertyAddress)
    ? parsed.data
    : null;
}

export function matterCloseDate(matter: HtoMatter) {
  const [closing] = matter.tasks;
  return closing?.status === "not_applicable"
    ? null
    : (closing?.dueDate ?? null);
}

export function fileStatus(stage: string): HtoStatus {
  if (stage === "listing") return "active_listing";
  if (stage === "closed") return "closed";
  if (stage === "terminated") return "fell_through";
  return "under_contract";
}

function manualAddress(row: StoredHtoClosing) {
  const parsed = htoAddress.safeParse(row.manualAddress);
  return parsed.success ? parsed.data : null;
}

export function activeManualMatches(
  matter: HtoMatter,
  rows: readonly StoredHtoClosing[],
) {
  if (!["listing", "under_contract", "closing"].includes(matter.stage))
    return [];
  const address = matterAddress(matter);
  const raw = address ? formatHtoAddress(address) : matter.propertyAddress;
  const near = nearAddressKey(raw);
  const closeDate = matterCloseDate(matter);
  return rows.filter(
    (row): row is StoredHtoClosing & { manualPropertyAddress: string } => {
      if (
        row.matterId ||
        !row.manualPropertyAddress ||
        row.manualSide !== matter.side ||
        !["active_listing", "under_contract"].includes(row.manualStatus || "")
      )
        return false;
      if (
        row.manualAgentRosterId &&
        matter.agentRosterId &&
        row.manualAgentRosterId !== matter.agentRosterId
      )
        return false;
      if (
        row.manualStatus === "under_contract" &&
        row.manualCloseDate &&
        closeDate &&
        row.manualCloseDate !== closeDate
      )
        return false;
      return nearAddressKey(row.manualPropertyAddress) === near;
    },
  );
}

const matchEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));

function knownClientEmails(values: readonly unknown[]) {
  return new Set(
    values.flatMap((value) => {
      const parsed = matchEmail.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    }),
  );
}

export function hasConflictingClientEmails(
  matter: HtoMatter,
  candidate: StoredHtoClosing,
) {
  if (
    candidate.manualStatus !== "under_contract" ||
    !Array.isArray(candidate.manualClients)
  )
    return false;
  const manual = knownClientEmails(
    candidate.manualClients.map((client) => jsonRecord(client).email),
  );
  const file = knownClientEmails(matter.contacts.map((client) => client.email));
  return (
    manual.size > 0 &&
    file.size > 0 &&
    ![...manual].some((email) => file.has(email))
  );
}

export function automaticManualMatch(
  matter: HtoMatter,
  matches: readonly StoredHtoClosing[],
  otherLinked: readonly StoredHtoClosing[],
) {
  if (matches.length !== 1) return null;
  const [candidate] = matches;
  const address = matterAddress(matter);
  const raw = address ? formatHtoAddress(address) : matter.propertyAddress;
  const candidateAddress = manualAddress(candidate);
  if (
    !candidate.manualPropertyAddress ||
    !matter.agentRosterId ||
    candidate.manualAgentRosterId !== matter.agentRosterId ||
    !hasLocality(raw, address) ||
    !hasLocality(candidate.manualPropertyAddress, candidateAddress) ||
    exactAddressKey(candidate.manualPropertyAddress) !== exactAddressKey(raw)
  )
    return null;
  if (
    otherLinked.some((row) => {
      if (!row.matter || row.matter.id === matter.id) return false;
      const linkedAddress = matterAddress(row.matter);
      return (
        nearAddressKey(
          linkedAddress
            ? formatHtoAddress(linkedAddress)
            : row.matter.propertyAddress,
        ) === nearAddressKey(raw)
      );
    })
  )
    return null;
  if (candidate.manualStatus === "under_contract") {
    const close = matterCloseDate(matter);
    const candidatePrice = decimalCents(candidate.manualPriceCents);
    const currentPrice = decimalCents(matter.purchasePriceCents);
    if (
      !close ||
      !candidate.manualCloseDate ||
      close !== candidate.manualCloseDate ||
      hasConflictingClientEmails(matter, candidate) ||
      (candidatePrice !== null &&
        currentPrice !== null &&
        candidatePrice !== currentPrice)
    )
      return null;
  }
  return candidate;
}

export function matchKey(
  matter: HtoMatter,
  matches: readonly StoredHtoClosing[],
) {
  const address = matterAddress(matter);
  return createHash("sha256")
    .update(
      JSON.stringify([
        exactAddressKey(
          address ? formatHtoAddress(address) : matter.propertyAddress,
        ),
        ...matches.map((row) => row.id).sort(),
      ]),
    )
    .digest("hex");
}
