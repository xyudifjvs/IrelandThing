"use client";
import Link from "next/link";
import { useData, type Session } from "./data";
import s from "./workspace.module.css";
export type PortfolioStats = {
  checkedAt: string;
  scope: "all_transactions";
  transactions: { total: number; active: number; pendingReview: number };
  tasks: { unresolvedDates: number };
  email: {
    draft: number;
    queued: number;
    failed: number;
    deliveryUnknown: number;
    inboxReview: number;
    failedSendJobs: number;
  };
  servicePayments: { unpaidOrders: number };
};
export default function PortfolioOverview() {
  const session = useData<Session>("/api/v1/session"),
    allowed = session.data?.user?.role === "coordinator";
  const query = useData<PortfolioStats>(
      allowed ? "/api/v1/operations/portfolio" : null,
    ),
    data = query.data;
  if (!allowed) return null;
  const cards = data
    ? [
        {
          label: "Files awaiting review",
          count: data.transactions.pendingReview,
          href: "/workspace/intakes",
          hint: "Intake files waiting for Ireland's review",
        },
        {
          label: "Unresolved dates",
          count: data.tasks.unresolvedDates,
          href: "/workspace/transactions",
          hint: "Open date follow-ups on current transactions",
        },
        {
          label: "Email drafts",
          count: data.email.draft,
          href: "/workspace/inbox",
          hint: "Saved drafts awaiting review",
        },
        {
          label: "Queued / sending",
          count: data.email.queued,
          href: "/workspace/inbox",
          hint: "Approved messages in the send workflow",
        },
        {
          label: "Inbox to review",
          count: data.email.inboxReview,
          href: "/workspace/inbox",
          hint: "Unassigned or review-required threads",
        },
        {
          label: "Unpaid service requests",
          count: data.servicePayments.unpaidOrders,
          href: "/workspace/payments",
          hint: "Creating, pending or failed requests; terminated files excluded",
        },
      ]
    : [];
  return (
    <section
      className={s.section}
      style={{ marginBottom: 24 }}
      aria-label="Portfolio overview"
    >
      <div className={s.sectionHead}>
        <div>
          <h2>Across your transactions</h2>
          <p>
            {data
              ? `${data.transactions.total} total · ${data.transactions.active} active files · totals across all transactions`
              : "Counts across all saved transactions"}
          </p>
        </div>
        <button
          className={s.buttonSmall}
          disabled={query.loading}
          onClick={() => void query.refresh()}
        >
          Refresh overview
        </button>
      </div>
      <div className={s.sectionBody}>
        {query.loading ? (
          <p>Loading portfolio totals…</p>
        ) : query.error ? (
          <p role="alert" className={s.error}>
            {query.error}
          </p>
        ) : (
          <>
            <div className={s.cardGrid}>
              {cards.map((card) => (
                <Link
                  key={card.label}
                  className={s.integrationCard}
                  href={card.href}
                  style={{ textDecoration: "none" }}
                >
                  <strong style={{ display: "block", fontSize: 28 }}>
                    {card.count}
                  </strong>
                  <h3>{card.label}</h3>
                  <p>{card.hint}</p>
                </Link>
              ))}
            </div>
            {data && (
              <>
                <p className={s.fieldHint}>
                  Email attention: {data.email.failed} failed drafts ·{" "}
                  {data.email.failedSendJobs} failed send jobs ·{" "}
                  {data.email.deliveryUnknown} with unconfirmed delivery.{" "}
                  <Link href="/workspace/inbox">Review email</Link> ·{" "}
                  <Link href="/workspace/settings">Review operations</Link>.
                </p>
                <p className={s.fieldHint}>
                  Unpaid requests include closed transactions still awaiting
                  payment. Paid, refunded, expired and cancelled requests are
                  excluded. A transaction without a payment request is not
                  counted as unpaid. Closed, terminated and archived files are
                  excluded from current file/date follow-ups.
                </p>
                <p className={s.fieldHint}>
                  Checked{" "}
                  {new Date(data.checkedAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  . Email and payment states remain separate from checklist
                  completion.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
