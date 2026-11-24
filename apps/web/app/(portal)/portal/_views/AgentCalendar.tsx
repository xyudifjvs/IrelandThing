"use client";

import { useState } from "react";
import Link from "next/link";
import { useLiveData } from "../../../_components/useLiveData";
import { CalendarMonth } from "../../../_components/CalendarMonth";
import {
  calendarDate,
  calendarDone,
  calendarItemKey,
  calendarTime,
  dayDate,
  dayKey,
  firstCalendarMonth,
  monthDays,
  shortPropertyAddress,
  type CalendarItem,
} from "../../../_components/calendar-model";
import { usePortalSession } from "./portal-session";
import s from "../_components/portal.module.css";
import c from "../calendar/agent-calendar.module.css";

type AgentCalendarData = {
  today: string;
  through: string;
  items: CalendarItem[];
  next7: CalendarItem[];
};

export function AgentCalendar() {
  const session = usePortalSession();
  return session.role === "agent" ? (
    <CalendarWorkspace />
  ) : (
    <div className={s.main}>
      <h1>Your calendar</h1>
      <p>This calendar is available to agents.</p>
      <Link href="/portal">Your transactions</Link>
    </div>
  );
}

export function CalendarDetails({ item }: { item?: CalendarItem }) {
  return (
    <section
      className={c.panel}
      aria-label="Calendar item details"
      aria-live="polite"
    >
      {item ? (
        <>
          <p className={c.type}>
            {calendarDone(item)
              ? "Done"
              : item.kind === "appointment"
                ? "Scheduled appointment"
                : "Contract deadline"}
          </p>
          <h2>{item.label}</h2>
          <p className={c.date}>{calendarDate(item)}</p>
          {item.location && <p>{item.location}</p>}
          <div className={c.fileDetails}>
            <p>{item.propertyAddress}</p>
            <p>
              {item.side === "seller" ? "Seller" : "Buyer"} side
              {item.clientNames?.length
                ? ` · ${item.clientNames.join(" & ")}`
                : ""}
            </p>
          </div>
          <Link
            className={s.button}
            href={`/portal/transactions/${encodeURIComponent(item.matterId)}`}
          >
            Open file →
          </Link>
        </>
      ) : (
        <p>
          Click any item on the calendar to see its details and open the file.
        </p>
      )}
    </section>
  );
}

export function CalendarWorkspace() {
  const [current, setCurrent] = useState(firstCalendarMonth);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const days = monthDays(current);
  const params = new URLSearchParams({
    from: dayKey(days[0]),
    through: dayKey(days.at(-1)!),
  });
  const query = useLiveData<AgentCalendarData>(
    `/api/v1/portfolio/agent-calendar?${params}`,
    undefined,
    true,
  );
  const selected = [
    ...(query.data?.items ?? []),
    ...(query.data?.next7 ?? []),
  ].find((item) => calendarItemKey(item) === selectedKey);
  const select = (item: CalendarItem) => setSelectedKey(calendarItemKey(item));
  return (
    <div className={`${s.main} ${c.main}`}>
      <div className={s.intro}>
        <div>
          <h1>Your calendar</h1>
          <p>
            Contract deadlines and scheduled appointments for all your active
            files.
          </p>
        </div>
      </div>
      <div className={c.legend} aria-label="Calendar legend">
        <span>
          <i className={c.deadlineSwatch} />
          Contract deadline
        </span>
        <span>
          <i className={c.appointmentSwatch} />
          Scheduled appointment
        </span>
        <span>
          <i className={c.doneSwatch} />
          Done
        </span>
      </div>
      {query.error ? (
        <div role="alert" className={s.panel}>
          <p>Could not load your calendar.</p>
          <button
            type="button"
            className={s.secondary}
            onClick={() => void query.refresh()}
          >
            Try again
          </button>
        </div>
      ) : (
        <div className={c.layout}>
          <section className={c.month} aria-label="Your calendar month">
            <CalendarMonth
              current={current}
              onMonthChange={(month) => {
                setCurrent(month);
                setSelectedKey(null);
              }}
              items={query.data?.items ?? []}
              loading={query.loading}
              today={query.data?.today}
              mobileGrid
              renderItem={(item) => (
                <button
                  key={calendarItemKey(item)}
                  type="button"
                  className={[
                    c.event,
                    item.kind === "appointment" ? c.appointment : "",
                    calendarDone(item) ? c.done : "",
                    selectedKey === calendarItemKey(item) ? c.selected : "",
                  ].join(" ")}
                  aria-label={`${item.label}, ${calendarDate(item)}, ${item.propertyAddress}${calendarDone(item) ? ", Done" : ""}`}
                  aria-pressed={selectedKey === calendarItemKey(item)}
                  onClick={() => select(item)}
                >
                  <strong>{item.label}</strong>
                  <small>
                    {item.kind === "appointment" && item.at
                      ? `${calendarTime(item.at)} · `
                      : ""}
                    {shortPropertyAddress(item.propertyAddress)}
                  </small>
                </button>
              )}
            />
            {!query.loading && !query.data?.items.length && (
              <p className={c.empty}>No dated items in this calendar range.</p>
            )}
          </section>
          <aside className={c.sidebar}>
            <CalendarDetails item={selected} />
            <section className={c.panel} aria-label="Next 7 days">
              <h2>Next 7 days</h2>
              {query.loading ? (
                <p role="status">Loading upcoming dates…</p>
              ) : query.data?.next7.length ? (
                <ul className={c.upcoming}>
                  {query.data.next7.map((item) => (
                    <li key={calendarItemKey(item)}>
                      <button
                        type="button"
                        onClick={() => select(item)}
                        aria-pressed={selectedKey === calendarItemKey(item)}
                      >
                        <span>
                          {dayDate(item.day).toLocaleDateString("en-US", {
                            timeZone: "UTC",
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}
                          {item.kind === "appointment" && item.at
                            ? ` · ${calendarTime(item.at)}`
                            : ""}
                        </span>
                        <strong>{item.label}</strong>
                        <span>
                          {shortPropertyAddress(item.propertyAddress)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No upcoming items in the next 7 days.</p>
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
