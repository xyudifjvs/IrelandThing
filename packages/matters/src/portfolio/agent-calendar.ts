import { prisma } from "@weatherly/db";
import { HttpError, validDate, type Principal } from "@weatherly/platform";
import { z } from "zod";
import { matterScope } from "../access";
import { fileReviewPending } from "../file-review";
import { canonicalPortalTimeline } from "../projections/canonical-timeline";
import {
  deadlineProjection,
  audienceAllows,
} from "../projections/deadline-fields";
import { approvedWorkflowTaskDates } from "../rules";
import { peopleAudienceWhere } from "../people/projection";
import { portalClientNames } from "../projections/portal-fields";
import { calendarCompletionDays } from "./calendar-completion";
import {
  activePortfolioStages,
  addCivilDays,
  civilDay,
  compareMilestones,
  object,
  portfolioMilestones,
} from "./milestones";

const day = z.string().refine(validDate);
const range = z.object({ from: day, through: day }).strict();

export async function listAgentCalendar(
  actor: Principal,
  raw: unknown,
  now = new Date(),
) {
  if (actor.role !== "agent")
    throw new HttpError(
      403,
      "AGENT_REQUIRED",
      "Sign in as an agent to open this calendar.",
    );
  const { from, through } = range.parse(raw);
  if (from > through || through > addCivilDays(from, 62))
    throw new HttpError(
      422,
      "INVALID_CALENDAR_RANGE",
      "Choose a calendar range of up to 63 days.",
    );
  return prisma.$transaction(
    async (tx) => {
      const pending = await tx.intakeSubmission.findMany({
        where: { processedAt: null, deletedAt: null },
        select: { matterId: true },
      });
      const matters = await tx.matter.findMany({
        where: {
          AND: [
            matterScope(actor),
            { stage: { in: activePortfolioStages } },
            { id: { notIn: pending.map((row) => row.matterId) } },
          ],
        },
        include: {
          tasks: true,
          deadlines: true,
          contacts: {
            where: peopleAudienceWhere("agent"),
            select: { name: true, role: true },
          },
        },
      });
      const safe = matters
        .filter((matter) => !fileReviewPending(matter))
        .map((matter) => {
          if (matter.checklistVersion !== null) {
            const shared = new Map(
              canonicalPortalTimeline(matter.tasks, "agent", {
                timeZone: matter.deadlineTimeZone,
                side: matter.side,
              }).map((task) => [task.id, task]),
            );
            return {
              ...matter,
              deadlines: [],
              tasks: matter.tasks
                .filter((task) => shared.has(task.id))
                .map((task) => ({
                  ...task,
                  details: {
                    ...object(task.details),
                    appointmentAt: shared.get(task.id)!.appointmentAt ?? null,
                    appointmentPlace:
                      shared.get(task.id)!.appointmentPlace ?? "",
                  },
                })),
            };
          }
          const dates = deadlineProjection(
            matter.deadlines,
            matter.tasks,
            matter.details,
            "agent",
          );
          return {
            ...matter,
            deadlines: dates.deadlines,
            tasks: approvedWorkflowTaskDates(
              matter.tasks,
              matter.deadlines,
              matter.details,
            )
              .filter((task) => audienceAllows(task.visibility, "agent"))
              .map((task) => dates.task(task)),
          };
        });
      const completionDays = await calendarCompletionDays(safe, tx);
      const events = safe
        .flatMap((matter) => {
          const rows = portfolioMilestones(matter, true, true, completionDays, {
            preferAppointments: true,
            hideSkippedDeadlines: true,
          }).events;
          return rows.map((row) => ({
            ...row,
            side: matter.side,
            clientNames: portalClientNames(matter.contacts),
          }));
        })
        .sort(compareMilestones);
      const today = civilDay(now),
        nextThrough = addCivilDays(today, 7);
      return {
        today,
        through: nextThrough,
        items: events.filter(
          (event) => from <= event.day && event.day <= through,
        ),
        next7: events.filter(
          (event) =>
            !["completed", "signed"].includes(event.status) &&
            today <= event.day &&
            event.day <= nextThrough,
        ),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
