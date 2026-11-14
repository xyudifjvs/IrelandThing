"use client";

import Link from "next/link";
import { useData } from "../../_components/data";
import { useLiveData } from "../../../../_components/useLiveData";
import { NotesHistoryBoundary } from "../private-notes/NotesHistoryBoundary";
import { PrivateTodoPanel } from "../private-notes/PrivateTodoPanel";
import { OverviewIntakes } from "./OverviewIntakes";
import { dayDate, transactionLink, weekdayDate, type Milestone } from "./model";
import s from "../../_components/workspace.module.css";
import p from "./portfolio.module.css";

const phases = {
  inquiry: "Inquiry",
  agreement_sent: "Agreement sent",
  agreement_signed: "Agreement signed",
  invited: "Invited",
} as const;

type Signup = {
  id: string;
  name: string;
  phase: string;
  phaseOn: string | null;
  booking?: { startAt?: string | null } | null;
};
type Due = { today: string; items: Milestone[] };
type Attention = {
  id: string;
  matterId: string;
  subject: string;
  propertyAddress: string;
  status: string;
  total: number;
};

function SignupSummary() {
  const query = useData<Signup[]>("/api/v1/onboarding/roster");
  const signing =
    query.data?.filter(({ phase }) => Object.hasOwn(phases, phase)) ?? [];
  if (!signing.length) return null;
  return (
    <section className={s.section} aria-labelledby="signups-heading">
      <div className={s.sectionHead}>
        <h2 id="signups-heading">Agents signing up</h2>
        <Link href="/workspace/roster" className={p.textLink}>
          Agent roster
        </Link>
      </div>
      <ul className={p.list}>
        {signing.map((row) => (
          <li className={p.signup} key={row.id}>
            <Link
              href={"/workspace/roster?agent=" + encodeURIComponent(row.id)}
            >
              {row.name}
            </Link>
            <small>
              {phases[row.phase as keyof typeof phases]}
              {row.phaseOn
                ? " · " +
                  dayDate(row.phaseOn).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  })
                : ""}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DueThisWeek() {
  const query = useLiveData<Due>("/api/v1/portfolio/due");
  return (
    <section className={s.section} aria-labelledby="due-heading">
      <div className={s.sectionHead}>
        <h2 id="due-heading">Due this week</h2>
        <Link href="/workspace/calendar" className={p.textLink}>
          Open calendar
        </Link>
      </div>
      <div className={p.list}>
        {query.error && (
          <p role="alert" className={s.error}>
            Could not load upcoming work.
          </p>
        )}
        {query.loading && !query.data && (
          <p role="status">Loading upcoming work…</p>
        )}
        {query.data && !query.data.items.length && (
          <p className={s.muted}>No upcoming work this week.</p>
        )}
        {query.data?.items.map((item) => {
          const day = dayDate(item.day);
          const overdue = item.day < query.data!.today;
          const badge = overdue
            ? "Overdue"
            : item.day === query.data!.today
              ? "Today"
              : day.toLocaleDateString("en-US", {
                  weekday: "short",
                  timeZone: "UTC",
                });
          return (
            <Link
              className={p.dueRow}
              key={item.kind + "-" + item.id}
              href={transactionLink(
                item.matterId,
                item.kind === "email" ? "emails" : undefined,
              )}
            >
              <span className={p.dateChip}>
                <small>
                  {day.toLocaleDateString("en-US", {
                    month: "short",
                    timeZone: "UTC",
                  })}
                </small>
                {day.getUTCDate()}
              </span>
              <span>
                <strong>{item.label}</strong>
                <small className={p.meta}>{item.propertyAddress}</small>
              </span>
              <small className={overdue ? p.overdue : undefined}>{badge}</small>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function Overview() {
  const attention = useData<Attention | null>(
    "/api/v1/portfolio/email-attention",
  );
  const session = useData<{ user: { name: string } }>("/api/v1/session");
  const now = new Date();
  const firstName = session.data?.user?.name.split(/\s+/)[0];
  return (
    <>
      <div className={s.heading}>
        <div>
          <p className={s.eyebrow}>Coordinator workspace</p>
          <h1>{firstName ? "Welcome, " + firstName : "Overview"}</h1>
          <p className={s.subtitle} suppressHydrationWarning>
            {weekdayDate(now)}
          </p>
        </div>
        <Link className={p.textLink} href="/workspace/new">
          Start without an intake
        </Link>
      </div>
      {attention.data && (
        <div className={p.attention}>
          <span>
            <strong>
              {attention.data.total === 1
                ? attention.data.status === "delivery_unknown"
                  ? "1 email needs delivery review"
                  : "1 email failed to send"
                : attention.data.total + " emails need review"}
            </strong>{" "}
            · {attention.data.subject}, {attention.data.propertyAddress}
          </span>
          <Link
            className={p.textLink}
            href={transactionLink(attention.data.matterId, "emails")}
          >
            Review
          </Link>
        </div>
      )}
      <div className={p.overview}>
        <div className={p.column}>
          <OverviewIntakes />
          <DueThisWeek />
        </div>
        <div className={p.column}>
          <NotesHistoryBoundary>
            <PrivateTodoPanel overview />
          </NotesHistoryBoundary>
          <SignupSummary />
        </div>
      </div>
    </>
  );
}
