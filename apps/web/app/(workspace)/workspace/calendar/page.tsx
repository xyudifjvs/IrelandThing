"use client";
import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import {
  useData,
  address,
  date,
  parseDate,
  type Matter,
} from "../_components/data";
import { Heading } from "../_components/Operations";
import s from "../_components/workspace.module.css";
import c from "./calendar.module.css";
type Event = {
  id: string;
  matterId: string;
  property: string;
  title: string;
  date: string;
  status: string;
  kind: string;
};
export default function Page() {
  const q = useData<Matter[]>("/api/v1/matters");
  const [current, setCurrent] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const first = new Date(
    current.getFullYear(),
    current.getMonth(),
    1 - new Date(current.getFullYear(), current.getMonth(), 1).getDay(),
  );
  const days = Array.from(
    { length: 42 },
    (_, i) =>
      new Date(first.getFullYear(), first.getMonth(), first.getDate() + i),
  );
  const events: Event[] = (q.data || []).flatMap((m) => [
    ...(m.deadlines || [])
      .filter((d) => d.date && d.status !== "rejected")
      .map((d) => ({
        id: d.id,
        matterId: m.id,
        property: address(m),
        title: d.label,
        date: d.date!,
        status: d.status,
        kind: "deadline",
      })),
    ...(m.tasks || [])
      .filter((t) => t.dueDate && t.status !== "not_applicable")
      .map((t) => ({
        id: t.id,
        matterId: m.id,
        property: address(m),
        title: t.title,
        date: t.dueDate!,
        status: t.status,
        kind: "task",
      })),
  ]);
  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const onDay = (d: Date) =>
    events.filter((e) => e.date.slice(0, 10) === key(d));
  const upcoming = events
    .filter((e) => {
      const d = parseDate(e.date);
      return (
        d.getFullYear() === current.getFullYear() &&
        d.getMonth() === current.getMonth()
      );
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  function event(e: Event) {
    return (
      <Link
        className={`${c.event} ${e.status === "proposed" ? c.proposed : ""} ${["completed", "signed"].includes(e.status) ? c.complete : ""}`}
        key={`${e.kind}-${e.id}`}
        href={`/workspace/transactions/${e.matterId}`}
      >
        {e.title}
        <small>
          {e.property}
          {e.status === "proposed" ? " · proposed" : ""}
        </small>
      </Link>
    );
  }
  return (
    <>
      <Heading
        eyebrow="A little room to plan ahead"
        title="Your calendar"
        subtitle="Contract milestones and task dates, brought into one clear view."
      />
      {q.error && <div className={s.error}>{q.error}</div>}
      <section className={s.section}>
        <div className={c.toolbar}>
          <h2>
            {current.toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })}
          </h2>
          <div className={c.controls}>
            <button
              className={s.buttonSmall}
              onClick={() => setCurrent(new Date())}
            >
              Today
            </button>
            <button
              className={s.buttonSmall}
              aria-label="Previous month"
              onClick={() =>
                setCurrent(
                  new Date(current.getFullYear(), current.getMonth() - 1, 1),
                )
              }
            >
              <ChevronLeft size={13} />
            </button>
            <button
              className={s.buttonSmall}
              aria-label="Next month"
              onClick={() =>
                setCurrent(
                  new Date(current.getFullYear(), current.getMonth() + 1, 1),
                )
              }
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
        {q.loading ? (
          <div className={s.loading}>Gathering your milestones…</div>
        ) : (
          <>
            <div className={c.weekdays}>
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((v) => (
                <div key={v}>{v}</div>
              ))}
            </div>
            <div className={c.grid}>
              {days.map((d) => (
                <div
                  className={`${c.day} ${d.getMonth() !== current.getMonth() ? c.outside : ""} ${key(d) === key(new Date()) ? c.today : ""}`}
                  key={key(d)}
                >
                  <span className={c.number}>{d.getDate()}</span>
                  {onDay(d).map(event)}
                </div>
              ))}
            </div>
            <div className={c.list}>
              {upcoming.length ? (
                Array.from(
                  new Set(upcoming.map((e) => e.date.slice(0, 10))),
                ).map((value) => (
                  <div className={c.listDay} key={value}>
                    <h3>{date(value)}</h3>
                    {upcoming
                      .filter((e) => e.date.slice(0, 10) === value)
                      .map(event)}
                  </div>
                ))
              ) : (
                <p className={s.empty}>No dated milestones in this month.</p>
              )}
            </div>
          </>
        )}
      </section>
      <div className={s.notice}>
        <CalendarDays size={16} /> Proposed dates are marked for review. Open
        the transaction to confirm or correct a date. Undated milestones remain
        in the transaction checklist.
      </div>
    </>
  );
}
