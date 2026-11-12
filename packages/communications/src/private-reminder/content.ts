import type { collectReminderDates } from "./deadline-collection";
import type { listDigestIntakes } from "./intake-window";

export const clean = (value: string, length: number) =>
  value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, length);

export function renderDigest(
  digest: Awaited<ReturnType<typeof collectReminderDates>>["digest"],
  intakes: Awaited<ReturnType<typeof listDigestIntakes>>,
) {
  const intakeClock = new Intl.DateTimeFormat("en-US", {
    timeZone: digest.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return [
    `Weatherly private reminders — ${digest.dateKey}`,
    `Only for your coordinator account. Dates use ${digest.timeZone}.`,
    `Overdue: ${digest.counts.overdue}. Upcoming through ${digest.leadDays} calendar days: ${digest.counts.upcoming}.`,
    "",
    ...digest.items.map(
      (item) =>
        `${item.bucket === "overdue" ? "OVERDUE" : "UPCOMING"} ${item.date} — ${item.propertyAddress || `Transaction ${item.matterId}`} — ${item.label}\nSources: ${item.sourceRefs.map((source) => `${source.kind}:${source.id}`).join(", ")}`,
    ),
    ...(intakes.length
      ? [
          "New intakes",
          ...intakes.map((row) =>
            [
              clean(row.agent, 200) || "Submitting agent",
              clean(row.property, 300) || "Address not provided",
              clean(row.side, 30) || "Side not provided",
              intakeClock.format(row.createdAt),
            ].join(" · "),
          ),
          "",
        ]
      : []),
    "",
    "Review the current transaction record before acting. No agent or client received this digest.",
  ].join("\n");
}
