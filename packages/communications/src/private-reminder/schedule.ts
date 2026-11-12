type Schedule = {
  timeZone: string;
  localTime: string;
  weekdays: readonly number[];
};

/** Local civil dates, independent of the host timezone and DST offset. */
export function reminderLocalClock(at: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const field = (name: string) =>
    parts.find((part) => part.type === name)!.value;
  const dateKey = `${field("year")}-${field("month")}-${field("day")}`;
  return {
    dateKey,
    minute: Number(field("hour")) * 60 + Number(field("minute")),
    weekday: new Date(`${dateKey}T12:00:00Z`).getUTCDay(),
  };
}
export function reminderScheduleDue(settings: Schedule, at: Date) {
  const clock = reminderLocalClock(at, settings.timeZone);
  const [hour, minute] = settings.localTime.split(":").map(Number);
  return {
    ...clock,
    due:
      settings.weekdays.includes(clock.weekday) &&
      clock.minute >= hour * 60 + minute,
  };
}
export function civilScheduleDate(day: string, settings: Schedule) {
  const [hour, minute] = settings.localTime.split(":").map(Number);
  const targetMinute = hour * 60 + minute;
  const target = new Date(day + "T00:00:00Z").valueOf();
  // IANA offsets are fewer than 24 hours. Find the first valid minute
  // at or after the local cutoff, including a DST gap.
  let low = (target - 86400000) / 60000;
  let high = (target + 172800000) / 60000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const clock = reminderLocalClock(
      new Date(middle * 60000),
      settings.timeZone,
    );
    if (
      clock.dateKey < day ||
      (clock.dateKey === day && clock.minute < targetMinute)
    )
      low = middle + 1;
    else high = middle;
  }
  return new Date(low * 60000);
}

export function previousScheduledDate(day: string, settings: Schedule) {
  const date = new Date(day + "T12:00:00Z");
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (!settings.weekdays.includes(date.getUTCDay()));
  return civilScheduleDate(date.toISOString().slice(0, 10), settings);
}
