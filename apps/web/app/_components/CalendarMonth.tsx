"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  calendarToday,
  dayDate,
  dayKey,
  firstCalendarMonth,
  monthDays,
  type CalendarItem,
} from "./calendar-model";
import s from "../(workspace)/workspace/_components/workspace.module.css";
import c from "../(workspace)/workspace/calendar/calendar.module.css";

/** Shared month navigation/grid. Each portal owns its event rendering and access. */
export function CalendarMonth<T extends CalendarItem>({
  current,
  onMonthChange,
  items,
  renderItem,
  loading = false,
  unavailable = false,
  today = calendarToday(),
  mobileGrid = false,
}: {
  current: Date;
  onMonthChange: (month: Date) => void;
  items: readonly T[];
  renderItem: (item: T) => ReactNode;
  loading?: boolean;
  unavailable?: boolean;
  today?: string;
  mobileGrid?: boolean;
}) {
  const year = current.getUTCFullYear(),
    month = current.getUTCMonth();
  const days = monthDays(current);
  const byDay = new Map<string, T[]>();
  for (const item of items)
    byDay.set(item.day, [...(byDay.get(item.day) ?? []), item]);
  const monthEvents = [...byDay].filter(([day]) =>
    day.startsWith(dayKey(current).slice(0, 7)),
  );
  return (
    <div className={mobileGrid ? c.mobileGrid : undefined}>
      <div className={c.toolbar}>
        <h2>
          {current.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
        </h2>
        <div className={c.controls}>
          <button
            type="button"
            className={s.buttonSmall}
            onClick={() => onMonthChange(firstCalendarMonth())}
          >
            Today
          </button>
          <button
            type="button"
            className={s.buttonSmall}
            aria-label="Previous month"
            onClick={() =>
              onMonthChange(new Date(Date.UTC(year, month - 1, 1)))
            }
          >
            <ChevronLeft size={13} />
          </button>
          <button
            type="button"
            className={s.buttonSmall}
            aria-label="Next month"
            onClick={() =>
              onMonthChange(new Date(Date.UTC(year, month + 1, 1)))
            }
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
      {loading ? (
        <div role="status" className={s.loading}>
          Loading dates…
        </div>
      ) : !unavailable ? (
        <>
          <div
            className={c.scroll}
            tabIndex={mobileGrid ? 0 : undefined}
            role={mobileGrid ? "region" : undefined}
            aria-label={
              mobileGrid
                ? "Calendar month; scroll horizontally on small screens"
                : undefined
            }
          >
            <div className={c.weekdays}>
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div key={day}>{day}</div>
              ))}
            </div>
            <div className={c.grid}>
              {days.map((day) => {
                const key = dayKey(day);
                return (
                  <div
                    className={[
                      c.day,
                      day.getUTCMonth() !== month ? c.outside : "",
                      key === today ? c.today : "",
                    ].join(" ")}
                    key={key}
                  >
                    <time
                      className={c.number}
                      dateTime={key}
                      aria-current={key === today ? "date" : undefined}
                    >
                      {day.getUTCDate()}
                    </time>
                    {byDay.get(key)?.map(renderItem)}
                  </div>
                );
              })}
            </div>
          </div>
          <div className={c.list}>
            {monthEvents.length ? (
              monthEvents.map(([key, events]) => (
                <div className={c.listDay} key={key}>
                  <h3>
                    {dayDate(key).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      timeZone: "UTC",
                    })}
                  </h3>
                  {events.map(renderItem)}
                </div>
              ))
            ) : (
              <p className={s.empty}>No dated milestones in this month.</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
