export type CalendarItem = {
  id: string;
  matterId: string;
  propertyAddress: string;
  label: string;
  day: string;
  at?: string;
  kind: "deadline" | "task" | "appointment" | "email";
  status: string;
  location?: string;
  side?: string;
  clientNames?: string[];
};
export const calendarZone = "America/New_York";
export const dayDate = (day: string) => new Date(day + "T12:00:00Z");
export const dayKey = (date: Date) => date.toISOString().slice(0, 10);
export const calendarToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: calendarZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const firstCalendarMonth = () =>
  dayDate(calendarToday().slice(0, 7) + "-01");
export function monthDays(current: Date) {
  const year = current.getUTCFullYear(),
    month = current.getUTCMonth();
  const offset = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return Array.from(
    { length: 42 },
    (_, index) => new Date(Date.UTC(year, month, 1 - offset + index)),
  );
}
export const calendarItemKey = (item: CalendarItem) =>
  `${item.matterId}:${item.kind}:${item.id}`;
export const calendarDone = (item: CalendarItem) =>
  ["completed", "signed"].includes(item.status);
export const shortPropertyAddress = (address: string) =>
  address.split(",")[0].trim();
export function calendarDate(item: CalendarItem) {
  const day = dayDate(item.day).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return item.kind === "appointment" && item.at
    ? `${day} at ${calendarTime(item.at)}`
    : `By ${day}`;
}
export function calendarTime(at: string) {
  return new Date(at).toLocaleTimeString("en-US", {
    timeZone: calendarZone,
    hour: "numeric",
    minute: "2-digit",
  });
}
