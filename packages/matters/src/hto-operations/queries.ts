import { prisma, Prisma } from "@weatherly/db";
import { assertCoordinator, type Principal } from "@weatherly/platform";
import {
  htoAddress,
  htoClient,
  htoFilters,
  htoSide,
  htoStatus,
  type HtoClosingRow,
  type HtoFilters,
  type HtoOperationsView,
} from "./contracts";
import {
  activeManualMatches,
  fileStatus,
  matchKey,
  matterAddress,
  matterCloseDate,
} from "./matching";
import {
  decimalCents,
  eligibleMatter,
  eligibleStages,
  htoInclude,
  jsonRecord,
  type HtoDb,
  type HtoMatter,
  type StoredHtoClosing,
} from "./storage";

function manualClients(row: StoredHtoClosing) {
  if (!Array.isArray(row.manualClients)) return [];
  return row.manualClients.flatMap((person) => {
    const result = htoClient.safeParse(person);
    return result.success ? [result.data] : [];
  });
}

function projectRow(
  row: StoredHtoClosing,
  previousPriceCents: number | null,
  historicalDateEdits: boolean,
): HtoClosingRow | null {
  const matter = row.matter;
  const side = htoSide.safeParse(matter ? matter.side : row.manualSide);
  if (!side.success) return null;
  if (matter) {
    if (!eligibleMatter(matter)) return null;
    const status = fileStatus(matter.stage);
    const checklistCloseDate =
      status === "active_listing" ? null : matterCloseDate(matter);
    const closing = matter.tasks[0];
    const actualCloseDate =
      status === "closed" && closing?.status !== "not_applicable"
        ? (closing?.actualDate ?? null)
        : null;
    const names = jsonRecord(jsonRecord(matter.details).structuredClientNames);
    return {
      id: row.id,
      revision: row.revision,
      matterId: matter.id,
      matterRevision: matter.revision,
      canonicalDateEditable: closingDateEditable(matter, historicalDateEdits),
      agentRosterId: matter.agentRosterId,
      agentName: matter.rosterAgent?.name ?? matter.agent?.name ?? null,
      clients: matter.contacts.map((contact) => {
        const fields = jsonRecord(names[contact.id]);
        const firstName =
          typeof fields.firstName === "string" ? fields.firstName : "";
        const lastName =
          typeof fields.lastName === "string" ? fields.lastName : "";
        const namesMatch =
          [firstName, lastName].filter(Boolean).join(" ") === contact.name;
        return {
          id: contact.id,
          name: contact.name,
          firstName: namesMatch ? firstName : "",
          lastName: namesMatch ? lastName : "",
          email: contact.email,
          phone: contact.phone,
        };
      }),
      propertyAddress: matter.propertyAddress,
      address: matterAddress(matter),
      side: side.data,
      status,
      closeDate: actualCloseDate ?? checklistCloseDate,
      checklistCloseDate,
      actualCloseDate,
      listedDate: null,
      purchasePriceCents:
        status === "active_listing"
          ? null
          : decimalCents(matter.purchasePriceCents),
      previousPriceCents:
        status === "active_listing" ? null : previousPriceCents,
      match: null,
    };
  }
  const status = htoStatus.safeParse(row.manualStatus);
  const address = htoAddress.safeParse(row.manualAddress);
  if (!status.success || !row.manualPropertyAddress) return null;
  const listing = status.data === "active_listing";

  return {
    id: row.id,
    revision: row.revision,
    matterId: null,
    matterRevision: null,
    canonicalDateEditable: false,
    agentRosterId: row.manualAgentRosterId,
    agentName: row.manualAgent?.name ?? null,
    clients: manualClients(row),
    propertyAddress: row.manualPropertyAddress,
    address: address.success ? address.data : null,
    side: side.data,
    status: status.data,
    closeDate: listing ? null : row.manualCloseDate,
    checklistCloseDate: null,
    actualCloseDate: null,
    listedDate: row.manualListedDate,
    purchasePriceCents: listing ? null : decimalCents(row.manualPriceCents),
    previousPriceCents: listing ? null : previousPriceCents,
    match: null,
  };
}

function countClosed(rows: readonly HtoClosingRow[]) {
  const closed = rows.filter((row) => row.status === "closed");
  return {
    closed: closed.length,
    closedVolumeCents: closed
      .reduce((sum, row) => sum + BigInt(row.purchasePriceCents ?? 0), 0n)
      .toString(),
  };
}

function yearMonth(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
  };
}

export function dateMatches(
  row: HtoClosingRow,
  range: HtoFilters["range"],
  now: Date,
) {
  if (!row.closeDate || row.status === "active_listing" || range === "all_time")
    return true;
  const { year, month } = yearMonth(now);
  if (range === "this_year") return row.closeDate.startsWith(`${year}-`);
  const offset = range === "last_month" ? month - 1 : month;
  const displayYear = offset === 0 ? year - 1 : year;
  const displayMonth = offset === 0 ? 12 : offset;
  return row.closeDate.startsWith(
    `${displayYear}-${String(displayMonth).padStart(2, "0")}-`,
  );
}

export function closingDateEditable(
  matter: HtoMatter,
  historicalDateEdits: boolean,
) {
  const [closing] = matter.tasks;
  if (
    matter.checklistVersion !== 1 ||
    matter.stage === "listing" ||
    !closing?.dateCapable ||
    closing.status === "not_applicable"
  )
    return false;
  if (["closed", "terminated"].includes(matter.stage))
    return historicalDateEdits;
  return closing.status !== "completed" && closing.status !== "signed";
}

export async function loadHtoOperations(
  db: HtoDb,
  historicalDateEdits = false,
) {
  const rows = await db.htoClosing.findMany({
    where: {
      OR: [
        { matterId: null },
        { matter: { business: "hto", stage: { in: eligibleStages } } },
      ],
    },
    include: htoInclude,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
  const activeAgents = await db.rosterAgent.findMany({
    where: { business: "hto", archivedAt: null },
    select: { id: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const rowIds = rows.map((row) => row.id);
  const matterIds = rows.flatMap((row) => (row.matterId ? [row.matterId] : []));
  const events = await db.auditEvent.findMany({
    where: {
      OR: [
        {
          entityType: "HtoClosing",
          entityId: { in: rowIds },
          action: { in: ["hto.price_changed", "hto.match_dismissed"] },
        },
        {
          entityType: "Matter",
          entityId: { in: matterIds },
          action: "matter.facts_updated",
        },
      ],
    },
    select: {
      entityId: true,
      entityType: true,
      action: true,
      details: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const manual = rows.filter((row) => !row.matterId);
  const agents = new Map(
    activeAgents.map((agent) => [agent.id, { ...agent, active: true }]),
  );
  const prices = new Map<
    string,
    { previous: number | null; createdAt: Date }
  >();
  const dismissals = new Map<string, Set<unknown>>();
  for (const event of events) {
    const details = jsonRecord(event.details);
    if (event.action === "hto.match_dismissed") {
      const keys = dismissals.get(event.entityId) ?? new Set();
      keys.add(details.key);
      dismissals.set(event.entityId, keys);
      continue;
    }
    const previous = details.previousPurchasePriceCents;
    if (
      !(previous === null || typeof previous === "number") ||
      previous === details.purchasePriceCents
    )
      continue;
    const key = event.entityType + ":" + event.entityId;
    if (!prices.has(key))
      prices.set(key, { previous, createdAt: event.createdAt });
  }
  const projected = rows.flatMap((row) => {
    const rowEvent = prices.get("HtoClosing:" + row.id);
    const matterEvent = row.matterId
      ? prices.get("Matter:" + row.matterId)
      : undefined;
    const latest =
      matterEvent && (!rowEvent || matterEvent.createdAt >= rowEvent.createdAt)
        ? matterEvent
        : rowEvent;
    const view = projectRow(row, latest?.previous ?? null, historicalDateEdits);
    if (!view) return [];
    if (view.agentRosterId && view.agentName && !agents.has(view.agentRosterId))
      agents.set(view.agentRosterId, {
        id: view.agentRosterId,
        name: view.agentName,
        active: false,
      });
    if (row.matter && !row.manualPropertyAddress) {
      const candidates = activeManualMatches(row.matter, manual);
      const key = matchKey(row.matter, candidates);
      const dismissed = dismissals.get(row.id)?.has(key);
      if (candidates.length && !dismissed)
        view.match = {
          key,
          candidates: candidates.map((candidate) => ({
            id: candidate.id,
            revision: candidate.revision,
            propertyAddress: candidate.manualPropertyAddress,
            agentName: candidate.manualAgent?.name ?? null,
            clientNames: manualClients(candidate).map(
              ({ firstName, lastName }) =>
                [firstName, lastName].filter(Boolean).join(" "),
            ),
          })),
        };
    }
    return [view];
  });
  return {
    rows: projected,
    agents: [...agents.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function filterRows(
  rows: readonly HtoClosingRow[],
  filters: HtoFilters,
  now: Date,
) {
  return rows.filter(
    (row) =>
      (!filters.agentId || row.agentRosterId === filters.agentId) &&
      (!filters.status || row.status === filters.status) &&
      dateMatches(row, filters.range, now),
  );
}

export async function listHtoOperations(
  actor: Principal,
  raw: unknown,
  now = new Date(),
  historicalDateEdits = false,
): Promise<HtoOperationsView> {
  assertCoordinator(actor);
  const filters = htoFilters.parse(raw);
  return prisma.$transaction(
    async (tx) => {
      const data = await loadHtoOperations(tx, historicalDateEdits);
      const rows = filterRows(data.rows, filters, now);
      const period = data.rows.filter((row) =>
        dateMatches(row, filters.range, now),
      );
      return {
        rows,
        agents: data.agents,
        totals: {
          activeListings: rows.filter((row) => row.status === "active_listing")
            .length,
          underContract: rows.filter((row) => row.status === "under_contract")
            .length,
          ...countClosed(rows),
        },
        byAgent: data.agents.map(({ id, name }) => ({
          id,
          name,
          ...countClosed(period.filter((row) => row.agentRosterId === id)),
        })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
