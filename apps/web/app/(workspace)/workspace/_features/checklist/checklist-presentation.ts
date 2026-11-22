import { localWallTime } from "../../../../../../../packages/matters/src/date-graph/calendar";

/** Civil dates are formatted in UTC: a deadline date must not shift with the viewer. */
export function dueDateParts(date: string | null | undefined) {
  if (!date) return null;
  const at = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(at.valueOf())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    weekday: "short",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || "";
  return {
    month: part("month").toUpperCase(),
    day: part("day"),
    weekday: part("weekday"),
  };
}

export function dueStatus(
  date: string | null | undefined,
  done: boolean,
  now: Date,
  timeZone: string | null,
) {
  if (done) return "Done";
  if (!date) return "";
  const today = localWallTime(
    now.toISOString(),
    timeZone || "America/New_York",
  )?.slice(0, 10);
  if (!today) return "";
  const days = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
  if (!Number.isFinite(days)) return "";
  if (!days) return "Today";
  const count = Math.abs(days),
    unit = count === 1 ? "day" : "days";
  return days > 0 ? `In ${count} ${unit}` : `${count} ${unit} ago`;
}

export type AppointmentClock = {
  date: string;
  hour: string;
  minute: string;
  period: string;
};
export const emptyClock: AppointmentClock = {
  date: "",
  hour: "",
  minute: "",
  period: "",
};
export function appointmentClock(wallTime: string): AppointmentClock {
  if (!wallTime) return { ...emptyClock };
  const hour = Number(wallTime.slice(11, 13));
  return {
    date: wallTime.slice(0, 10),
    hour: String(hour % 12 || 12),
    minute: wallTime.slice(14, 16),
    period: hour < 12 ? "AM" : "PM",
  };
}
/** null means empty, an empty string means incomplete, otherwise a minute-precision local clock. */
export function clockWallTime(clock: AppointmentClock): string | null {
  if (!Object.values(clock).some(Boolean)) return null;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(clock.date) ||
    !/^(?:[1-9]|1[0-2])$/.test(clock.hour) ||
    !/^[0-5]?\d$/.test(clock.minute) ||
    !["AM", "PM"].includes(clock.period)
  )
    return "";
  const hour = (Number(clock.hour) % 12) + (clock.period === "PM" ? 12 : 0);
  return `${clock.date}T${String(hour).padStart(2, "0")}:${clock.minute.padStart(2, "0")}`;
}
