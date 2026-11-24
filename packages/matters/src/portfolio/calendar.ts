import {
  assertCoordinator,
  HttpError,
  type Principal,
  validDate,
} from "@weatherly/platform";
import { prisma } from "@weatherly/db";
import { z } from "zod";
import { fileReviewPending } from "../file-review";
import {
  activePortfolioStages,
  addCivilDays,
  civilDay,
  compareMilestones,
  milestoneInclude,
  portfolioMilestones,
  type PortfolioMilestone,
} from "./milestones";
import type { PortfolioDependencies } from "./transactions";
import { calendarCompletionDays } from "./calendar-completion";

const day = z.string().refine(validDate);
const dateRange = z.object({ from: day, through: day }).strict();
async function portfolioEvents(actor: Principal, history: boolean) {
  assertCoordinator(actor);
  const matters = await prisma.$transaction(
    async (tx) => {
      const pending = await tx.intakeSubmission.findMany({
        where: { processedAt: null, deletedAt: null },
        select: { matterId: true },
      });
      return tx.matter.findMany({
        where: {
          id: { notIn: pending.map((row) => row.matterId) },
          stage: history
            ? { not: "pending_review" }
            : { in: activePortfolioStages },
        },
        include: milestoneInclude,
      });
    },
    { isolationLevel: "RepeatableRead" },
  );
  const completionDays = history
    ? await calendarCompletionDays(matters, prisma)
    : new Map<string, string>();
  return matters
    .filter((matter) => !fileReviewPending(matter))
    .flatMap(
      (matter) =>
        portfolioMilestones(matter, history, history, completionDays).events,
    );
}

export async function listPortfolioCalendar(actor: Principal, raw: unknown) {
  assertCoordinator(actor);
  const { from, through } = dateRange.parse(raw);
  if (from > through || through > addCivilDays(from, 62))
    throw new HttpError(
      422,
      "INVALID_CALENDAR_RANGE",
      "Choose a calendar range of up to 63 days.",
    );
  return (await portfolioEvents(actor, true))
    .filter((event) => from <= event.day && event.day <= through)
    .sort(compareMilestones);
}

export async function listPortfolioDue(
  actor: Principal,
  dependencies: PortfolioDependencies,
  now = new Date(),
) {
  assertCoordinator(actor);
  const today = civilDay(now);
  const through = addCivilDays(today, 7);
  const [events, work] = await Promise.all([
    portfolioEvents(actor, false),
    dependencies.listEmailWork(actor, { through }),
  ]);
  const emailEvents = work.flatMap((item): PortfolioMilestone[] =>
    item.toSend && item.remindOn && item.remindOn <= today
      ? [
          {
            id: item.id,
            matterId: item.matterId,
            propertyAddress: item.propertyAddress,
            label: item.title,
            kind: "email",
            status: "pending",
            day: item.remindOn,
          },
        ]
      : [],
  );
  return {
    today,
    through,
    items: [
      ...events.filter((event) => event.day <= through),
      ...emailEvents,
    ].sort(compareMilestones),
  };
}
