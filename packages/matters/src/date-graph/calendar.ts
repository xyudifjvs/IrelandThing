import {
  civilDateSchema,
  dateValueSchema,
  type DateValue,
} from "@weatherly/platform/handoff-contracts";
import {
  ChecklistDateError,
  type DateAdjustment,
  type DateOffset,
} from "./types";

const millisecondsPerHour = 3_600_000;
const millisecondsPerDay = 24 * millisecondsPerHour;

export function deadlineCalendar(timeZone: string | null) {
  if (!timeZone) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      era: "short",
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  } catch {
    throw new ChecklistDateError(
      "INVALID_DATE",
      "Use a valid deadline timezone.",
    );
  }
}

function localDateTime(instant: number, calendar: Intl.DateTimeFormat) {
  if (!Number.isFinite(instant) || Math.abs(instant) > 8.64e15) return null;
  const parts = calendar.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  const year = Number(part("year"));
  const civilYear = part("era") === "BC" ? 1 - year : year;
  const date = `${String(civilYear).padStart(4, "0")}-${part("month")}-${part("day")}`;
  if (!civilDateSchema.safeParse(date).success) return null;
  return `${date}T${part("hour")}:${part("minute")}:${part("second")}.${part("fractionalSecond")}`;
}

function civilDateAt(instant: number, calendar: Intl.DateTimeFormat) {
  return localDateTime(instant, calendar)?.slice(0, 10) ?? null;
}

function instantForLocalTime(
  localTime: string,
  calendar: Intl.DateTimeFormat,
): string | null {
  const wallClock = Date.parse(`${localTime}Z`);
  const candidates = new Set<number>();
  // Test the UTC offsets on both sides of the local day to detect a gap or fold.
  for (const sample of [
    wallClock - millisecondsPerDay,
    wallClock,
    wallClock + millisecondsPerDay,
  ]) {
    const sampleLocal = localDateTime(sample, calendar);
    if (!sampleLocal) continue;
    const candidate = wallClock + sample - Date.parse(`${sampleLocal}Z`);
    if (localDateTime(candidate, calendar) === localTime)
      candidates.add(candidate);
  }
  if (candidates.size !== 1) return null;
  const [candidate] = candidates;
  return new Date(candidate).toISOString();
}

export function localDeadlineClock(
  instant: string | null | undefined,
  timeZone: string | null,
) {
  const calendar = deadlineCalendar(timeZone);
  return instant && calendar
    ? (localDateTime(Date.parse(instant), calendar)?.slice(11) ?? "")
    : "";
}

export function dateValueAtLocalTime(
  date: string,
  time: string,
  timeZone: string | null,
): DateValue {
  if (!civilDateSchema.safeParse(date).success)
    throw new ChecklistDateError("INVALID_DATE", "Enter a valid date.");
  if (!time) return { date, instant: null };
  const calendar = deadlineCalendar(timeZone);
  if (!calendar)
    throw new ChecklistDateError(
      "INVALID_DATE",
      "Set the file's deadline timezone before entering an exact time.",
    );
  const clock = /^(\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(time);
  const instant = clock
    ? instantForLocalTime(
        `${date}T${clock[1]}:${clock[2] ?? "00"}.${(clock[3] ?? "").padEnd(3, "0")}`,
        calendar,
      )
    : null;
  if (!instant)
    throw new ChecklistDateError(
      "INVALID_DATE",
      "Choose a time that occurs once on this date in the file's timezone.",
    );
  return { date, instant };
}

export function validateDateValue(
  value: DateValue | null,
  calendar: Intl.DateTimeFormat | null,
  requireTimeZone = false,
) {
  if (!value) return;
  if (!dateValueSchema.safeParse(value).success)
    throw new ChecklistDateError("INVALID_DATE", "Use a valid date and time.");
  if (!value.instant) return;
  const exact = Date.parse(value.instant);
  if (!Number.isFinite(exact))
    throw new ChecklistDateError("INVALID_DATE", "Use a valid exact time.");
  if (requireTimeZone && !calendar)
    throw new ChecklistDateError(
      "INVALID_DATE",
      "Set the file's deadline timezone before entering an exact time.",
    );
  if (calendar && civilDateAt(exact, calendar) !== value.date)
    throw new ChecklistDateError(
      "INVALID_DATE",
      "The exact time must fall on the selected date in the file's deadline timezone.",
    );
}

export function sameDateValue(a: DateValue | null, b: DateValue | null) {
  if (!a || !b) return a === b;
  return (
    a.date === b.date &&
    (a.instant && b.instant
      ? Date.parse(a.instant) === Date.parse(b.instant)
      : a.instant === b.instant)
  );
}

function epochDay(date: string) {
  return Date.parse(`${date}T00:00:00.000Z`) / millisecondsPerDay;
}

function civilDate(day: number) {
  const value = new Date(day * millisecondsPerDay);
  if (value.getUTCFullYear() < 0 || value.getUTCFullYear() > 9999) return null;
  return Number.isNaN(value.getTime())
    ? null
    : value.toISOString().slice(0, 10);
}

function workingCalendar(settings: NonNullable<DateOffset["calendar"]>) {
  const weekdays = new Set(settings.workingWeekdays);
  const holidays = new Set(settings.excludedDates.map(epochDay));
  return (day: number) =>
    weekdays.has((((day + 4) % 7) + 7) % 7) && !holidays.has(day);
}

function workingDate(
  initialDay: number,
  amount: number,
  isWorkingDay: (day: number) => boolean,
) {
  const direction = Math.sign(amount);
  let day = initialDay;
  for (let remaining = Math.abs(amount); remaining > 0;) {
    day += direction;
    if (isWorkingDay(day)) remaining -= 1;
  }
  return day;
}

function applyRollover(day: number, offset: DateOffset) {
  if (offset.rollover === "none") return day;
  if (!offset.calendar || offset.rollover === "unspecified") return null;
  const isWorkingDay = workingCalendar(offset.calendar);
  if (isWorkingDay(day)) return day;
  return workingDate(
    day,
    offset.rollover === "next_workday" ? 1 : -1,
    isWorkingDay,
  );
}

export function adjustDate(
  anchor: DateValue,
  adjustment: DateAdjustment,
  calendar: Intl.DateTimeFormat | null,
): DateValue | null {
  if (adjustment.unit === "days") {
    const date = civilDate(epochDay(anchor.date) + adjustment.amount);
    if (!date) return null;
    if (!anchor.instant) return { date, instant: null };
    if (!calendar) return null;
    const oldClock = localDateTime(Date.parse(anchor.instant), calendar);
    if (!oldClock) return null;
    const instant = instantForLocalTime(
      `${date}${oldClock.slice(10)}`,
      calendar,
    );
    return instant ? { date, instant } : null;
  }
  if (!anchor.instant || !calendar) return null;
  const instant =
    Date.parse(anchor.instant) + adjustment.amount * millisecondsPerHour;
  const date = civilDateAt(instant, calendar);
  return date ? { date, instant: new Date(instant).toISOString() } : null;
}

export function resolveOffset(
  anchor: DateValue | null,
  offset: DateOffset,
  calendar: Intl.DateTimeFormat | null,
): DateValue | null {
  if (
    !anchor ||
    offset.counting === "unspecified" ||
    offset.rollover === "unspecified"
  )
    return null;

  let result: DateValue | null;
  if (offset.counting === "business") {
    if (offset.unit === "hours" || !offset.calendar) return null;
    const date = civilDate(
      workingDate(
        epochDay(anchor.date),
        offset.amount,
        workingCalendar(offset.calendar),
      ),
    );
    result = date ? { date, instant: null } : null;
  } else if (offset.unit === "days") {
    const date = civilDate(epochDay(anchor.date) + offset.amount);
    result = date ? { date, instant: null } : null;
  } else {
    result = adjustDate(anchor, offset, calendar);
  }
  if (!result || offset.rollover === "none") return result;

  const resolvedDay = epochDay(result.date);
  const rolledDay = applyRollover(resolvedDay, offset);
  if (rolledDay === resolvedDay) return result;
  return rolledDay === null
    ? null
    : adjustDate(
        result,
        { amount: rolledDay - resolvedDay, unit: "days" },
        calendar,
      );
}
