export type Milestone = {
  id: string;
  matterId: string;
  propertyAddress: string;
  label: string;
  day: string;
  at?: string;
  kind: "deadline" | "task" | "appointment" | "email";
  status: string;
};

export type ListPage<T> = {
  total: number;
  page: number;
  limit: number;
  items: T[];
};

export function transactionLink(id: string, tab?: "emails") {
  return (
    "/workspace/transactions/" +
    encodeURIComponent(id) +
    (tab ? "?tab=" + tab : "")
  );
}

export function weekdayDate(value: Date) {
  return value.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function dayDate(day: string) {
  return new Date(day + "T12:00:00Z");
}
