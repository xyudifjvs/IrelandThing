import { assertCoordinator, type Principal } from "@weatherly/platform";
import { prisma, type Prisma } from "@weatherly/db";
import { z } from "zod";
import { fileReviewPending } from "../file-review";
import {
  activePortfolioStages,
  milestoneInclude,
  object,
  portfolioMilestones,
} from "./milestones";

export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const transactionQuery = pagination
  .extend({
    status: z.enum(["active", "closed", "terminated", "all"]).default("active"),
    business: z.enum(["all", "hto", "weatherly"]).default("all"),
    q: z.string().trim().max(200).default(""),
  })
  .strict();
const hiddenStages = [
  "pending_review",
  "pre_listing",
  "prelisting",
  "archived",
];
type EmailWorkSummary = {
  id: string;
  title: string;
  propertyAddress: string;
  matterId: string;
  remindOn: string | null;
  toSend: boolean;
};
export type PortfolioDependencies = {
  listEmailWork: (
    actor: Principal,
    input: { from?: string; through?: string },
  ) => Promise<EmailWorkSummary[]>;
};

function matterWhere(
  status: "active" | "closed" | "terminated" | "all",
): Prisma.MatterWhereInput {
  if (status === "all") return { stage: { notIn: hiddenStages } };
  if (status === "active") return { stage: { in: activePortfolioStages } };
  return { stage: status };
}

function string(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function listPortfolioTransactions(
  actor: Principal,
  raw: unknown,
  dependencies: PortfolioDependencies,
) {
  assertCoordinator(actor);
  const { status, business, q, page, limit } = transactionQuery.parse(raw);
  const terms = q.toLocaleLowerCase("en-US").split(/\s+/).filter(Boolean);
  const [result, work] = await Promise.all([
    prisma.$transaction(
      async (tx) => {
        const pending = await tx.intakeSubmission.findMany({
          where: { processedAt: null, deletedAt: null },
          select: { matterId: true },
        });
        const candidates = await tx.matter.findMany({
          where: {
            ...matterWhere(status),
            id: { notIn: pending.map((row) => row.matterId) },
            ...(business === "weatherly"
              ? { OR: [{ business: "weatherly" }, { business: null }] }
              : business === "hto"
                ? { business: "hto" }
                : {}),
          },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            propertyAddress: true,
            stage: true,
            details: true,
            side: true,
            business: true,
            agent: { select: { name: true, email: true } },
            rosterAgent: { select: { name: true, email: true } },
            contacts: {
              where: {
                retiredAt: null,
                role: { in: ["client", "buyer", "seller"] },
              },
              select: { name: true, email: true },
            },
          },
        });
        const filtered = candidates.filter((matter) => {
          if (fileReviewPending(matter)) return false;
          if (!terms.length) return true;
          const details = object(matter.details);
          const legacyClients = Array.isArray(details.clients)
            ? details.clients.map(object)
            : [];
          const clients = matter.contacts.length
            ? matter.contacts
            : legacyClients;
          const agent = matter.rosterAgent ?? matter.agent;
          const haystack = [
            matter.propertyAddress,
            agent?.name,
            agent?.email,
            ...clients.flatMap((client) => [
              string(client.name),
              string(client.email),
            ]),
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("en-US");
          return terms.every((term) => haystack.includes(term));
        });
        const selected = filtered.slice((page - 1) * limit, page * limit);
        const rows = await tx.matter.findMany({
          where: { id: { in: selected.map((row) => row.id) } },
          include: milestoneInclude,
        });
        const byId = new Map(rows.map((row) => [row.id, row]));
        return {
          total: filtered.length,
          page,
          limit,
          items: selected.map((row) => {
            const { events, closing } = portfolioMilestones(byId.get(row.id)!);
            return {
              id: row.id,
              propertyAddress: row.propertyAddress,
              side: row.side,
              stage: row.stage,
              business: row.business ?? "weatherly",
              agentName: row.rosterAgent?.name ?? row.agent?.name ?? null,
              nextDeadline: activePortfolioStages.includes(row.stage)
                ? (events.find((event) => event.kind !== "appointment") ?? null)
                : null,
              closing,
            };
          }),
        };
      },
      { isolationLevel: "RepeatableRead" },
    ),
    dependencies.listEmailWork(actor, {}),
  ]);
  const byMatter = new Map<string, EmailWorkSummary[]>();
  for (const item of work) {
    if (!item.toSend) continue;
    const group = byMatter.get(item.matterId) ?? [];
    group.push(item);
    byMatter.set(item.matterId, group);
  }
  return {
    ...result,
    items: result.items.map((matter) => {
      const reminders = activePortfolioStages.includes(matter.stage)
        ? (byMatter.get(matter.id) ?? [])
        : [];
      return {
        ...matter,
        toSend: { count: reminders.length, next: reminders[0] ?? null },
      };
    }),
  };
}
