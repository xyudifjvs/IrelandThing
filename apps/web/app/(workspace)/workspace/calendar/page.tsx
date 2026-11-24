"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarMonth } from "../../../_components/CalendarMonth";
import {
  dayKey,
  firstCalendarMonth,
  monthDays,
} from "../../../_components/calendar-model";
import { useData } from "../_components/data";
import { Heading } from "../_components/WorkspaceHeading";
import { transactionLink, type Milestone } from "../_features/portfolio/model";
import s from "../_components/workspace.module.css";
import c from "./calendar.module.css";

const zone = "America/New_York";

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
  const [current, setCurrent] = useState(firstCalendarMonth);
  const days = monthDays(current);
  const params = new URLSearchParams({
    from: dayKey(days[0]),
    through: dayKey(days.at(-1)!),
  });
  const query = useData<Milestone[]>("/api/v1/portfolio/calendar?" + params);
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
        <CalendarMonth
          current={current}
          onMonthChange={setCurrent}
          items={query.data ?? []}
          loading={query.loading}
          unavailable={!!query.error}
          renderItem={(item) => (
            <MilestoneLink key={item.kind + "-" + item.id} item={item} />
          )}
        />
      </section>
    </>
  );
}
