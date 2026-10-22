"use client";
import { useData, label } from "./data";
import s from "./workspace.module.css";
type Booking = {
  id: string;
  status: "confirmed" | "canceled" | "rescheduled";
  startAt: string;
  endAt: string;
  name: string;
  email: string;
  timezone: string | null;
  oldInviteeUri?: string | null;
  newInviteeUri?: string | null;
  provenance: string;
  verifiedAt: string;
};
function time(value: string, timezone?: string | null) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(new Date(value));
  } catch {
    return value;
  }
}
export default function CalendlyBookings() {
  const config = useData<{ configured: boolean; syncConfigured: boolean }>(
    "/api/v1/onboarding/scheduling",
  );
  const bookings = useData<Booking[]>("/api/v1/onboarding/bookings");
  return (
    <section className={s.section} aria-labelledby="verified-bookings-heading">
      <div className={s.sectionHead}>
        <div>
          <h2 id="verified-bookings-heading">Verified Calendly bookings</h2>
          <p>
            Provider-verified records are separate from public inquiries.
            Meeting bookings do not approve agreements or grant portal access.
          </p>
        </div>
        <button
          type="button"
          className={s.buttonSecondary}
          disabled={bookings.loading || config.loading}
          onClick={() => {
            void bookings.refresh();
            void config.refresh();
          }}
        >
          Refresh bookings
        </button>
      </div>
      {config.loading ? (
        <p className={s.loading}>Checking booking synchronization…</p>
      ) : config.error ? (
        <p className={s.error} role="alert">
          Could not check synchronization: {config.error}
        </p>
      ) : !config.data?.syncConfigured ? (
        <p className={s.notice}>
          Calendly synchronization is not configured. Bookings, cancellations
          and reschedules may not appear here. Check Calendly directly;
          previously verified records below may be out of date.
        </p>
      ) : (
        <p className={s.fieldHint}>
          Synchronization is configured. This list contains received and
          verified provider records; it may lag behind Calendly.
        </p>
      )}
      <details className={s.sectionBody}>
        <summary>Send the agreement through Calendly</summary>
        <p>
          Ireland can add the approved agreement link to her Calendly booking
          confirmation email on Standard or higher. A booking-triggered email
          Automation is another option on eligible plans. Account setup and
          the final agreement link are still pending.
        </p>
        <p>
          Calendly sends the link; signed evidence still needs to be recorded
          below before portal access. A booking does not prove email delivery
          or a signature.
        </p>
        <a
          href="https://calendly.com/help/how-to-set-up-basic-notifications"
          target="_blank"
          rel="noopener noreferrer"
        >
          Calendly email setup instructions (new tab)
        </a>
      </details>
      {bookings.loading ? (
        <p className={s.loading}>Loading verified bookings…</p>
      ) : bookings.error ? (
        <p className={s.error} role="alert">
          Could not load bookings: {bookings.error}
        </p>
      ) : bookings.data?.length ? (
        bookings.data.map((booking) => (
          <article
            className={s.sectionBody}
            key={booking.id}
            style={{ borderTop: "1px solid #e7dccb" }}
          >
            <h3>
              {booking.name} · {label(booking.status)}
            </h3>
            <p>{booking.email}</p>
            <p>
              {time(booking.startAt, booking.timezone)} –{" "}
              {time(booking.endAt, booking.timezone)}
              <br />
              Time zone: {booking.timezone || "your browser’s local time zone"}
            </p>
            {booking.status === "canceled" && (
              <p>This booking was canceled in Calendly.</p>
            )}
            {(booking.status === "rescheduled" ||
              booking.oldInviteeUri ||
              booking.newInviteeUri) && (
              <p>
                Reschedule history:{" "}
                {booking.oldInviteeUri ? "replaces an earlier booking" : ""}
                {booking.oldInviteeUri && booking.newInviteeUri ? "; " : ""}
                {booking.newInviteeUri
                  ? "a replacement booking was reported"
                  : ""}
                {!booking.oldInviteeUri && !booking.newInviteeUri
                  ? "Calendly reported a reschedule"
                  : ""}
                . Related records appear separately when received.
              </p>
            )}
            <p className={s.fieldHint}>
              Verified {time(booking.verifiedAt)} (your browser’s local time
              zone) · Source: {booking.provenance}
            </p>
          </article>
        ))
      ) : (
        <p className={s.empty}>
          No verified Calendly bookings have been received.
        </p>
      )}
    </section>
  );
}
