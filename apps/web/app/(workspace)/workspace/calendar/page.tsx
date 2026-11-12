"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useData } from "../_components/data";
import { Heading } from "../_components/WorkspaceHeading";
import {
  dayDate,
  transactionLink,
  type Milestone,
} from "../_features/portfolio/model";
import s from "../_components/workspace.module.css";
import c from "./calendar.module.css";

const zone = "America/New_York";
const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const utcKey = (date: Date) => date.toISOString().slice(0, 10);
const easternDay = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const firstOfMonth = () => dayDate(easternDay().slice(0, 7) + "-01");

function MilestoneLink({ item }: { item: Milestone }) {
  const completed = ["completed", "signed"].includes(item.status);
  return (
    <Link
      className={c.event + (completed ? " " + c.complete : "")}
      href={transactionLink(item.matterId)}
    >
      {item.label}
      <small>
        {item.propertyAddress}
        {item.at &&
          " · " +
            new Date(item.at).toLocaleTimeString("en-US", {
              timeZone: zone,
              hour: "numeric",
              minute: "2-digit",
            })}
      </small>
    </Link>
  );
}

export default function Page() {
  const [current, setCurrent] = useState(firstOfMonth);
  const year = current.getUTCFullYear();
  const month = current.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, month, 1));
  const days = Array.from(
    { length: 42 },
    (_, index) =>
      new Date(Date.UTC(year, month, 1 - firstDay.getUTCDay() + index)),
  );
  const params = new URLSearchParams({
    from: utcKey(days[0]),
    through: utcKey(days.at(-1)!),
  });
  const query = useData<Milestone[]>("/api/v1/portfolio/calendar?" + params);
  const byDay = new Map<string, Milestone[]>();
  for (const item of query.data ?? []) {
    const events = byDay.get(item.day) ?? [];
    events.push(item);
    byDay.set(item.day, events);
  }
  const monthKey = utcKey(current).slice(0, 7);
  const monthEvents = [...byDay].filter(([day]) => day.startsWith(monthKey));
  const today = easternDay();
  return (
    <>
      <Heading
        eyebrow="Upcoming dates"
        title="Your calendar"
        subtitle="Contract deadlines and scheduled appointments."
      />
      {query.error && (
        <div className={s.error} role="alert">
          Could not load the calendar.{" "}
          <button
            type="button"
            className={s.buttonSmall}
            onClick={() => void query.refresh()}
          >
            Try again
          </button>
        </div>
      )}
      <section className={s.section}>
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
              onClick={() => setCurrent(firstOfMonth())}
            >
              Today
            </button>
            <button
              type="button"
              className={s.buttonSmall}
              aria-label="Previous month"
              onClick={() => setCurrent(new Date(Date.UTC(year, month - 1, 1)))}
            >
              <ChevronLeft size={13} />
            </button>
            <button
              type="button"
              className={s.buttonSmall}
              aria-label="Next month"
              onClick={() => setCurrent(new Date(Date.UTC(year, month + 1, 1)))}
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
        {query.loading && (
          <div role="status" className={s.loading}>
            Loading dates…
          </div>
        )}
        {!query.loading && !query.error && (
          <>
            <div className={c.weekdays}>
              {daysOfWeek.map((day) => (
                <div key={day}>{day}</div>
              ))}
            </div>
            <div className={c.grid}>
              {days.map((day) => {
                const key = utcKey(day);
                return (
                  <div
                    className={[
                      c.day,
                      day.getUTCMonth() !== month ? c.outside : "",
                      key === today ? c.today : "",
                    ].join(" ")}
                    key={key}
                  >
                    <time className={c.number} dateTime={key}>
                      {day.getUTCDate()}
                    </time>
                    {byDay.get(key)?.map((item) => (
                      <MilestoneLink
                        key={item.kind + "-" + item.id}
                        item={item}
                      />
                    ))}
                  </div>
                );
              })}
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
                    {events.map((item) => (
                      <MilestoneLink
                        key={item.kind + "-" + item.id}
                        item={item}
                      />
                    ))}
                  </div>
                ))
              ) : (
                <p className={s.empty}>No dated milestones in this month.</p>
              )}
            </div>
          </>
        )}
      </section>
    </>
  );
}
