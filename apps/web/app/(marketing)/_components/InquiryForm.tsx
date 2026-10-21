"use client";
import { useRef, useState } from "react";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { api } from "@weatherly/ui";
import s from "./marketing.module.css";
export default function InquiryForm({
  kind = "contact",
}: {
  kind?: "contact" | "meeting" | "information";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const lastRequest = useRef<{ content: string; id: string } | null>(null);
  const receipt = useRef<HTMLDivElement>(null);
  return saved ? (
    <div className={s.notice} role="status" tabIndex={-1} ref={receipt}>
      <CheckCircle2 size={22} strokeWidth={1} />
      <h3 style={{ fontFamily: "Georgia", fontSize: 23, fontWeight: 400 }}>
        Your request has been saved.
      </h3>
      <p>
        Your request is ready for Ireland to review. Any meeting time still
        needs her confirmation; no email response has been sent.
      </p>
      <button className={s.secondary} onClick={() => setSaved(false)}>
        Submit another request
      </button>
    </div>
  ) : (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const f = new FormData(e.currentTarget);
        try {
          const data = {
            website: String(f.get("website") || ""),
            name: String(f.get("name") || ""),
            email: String(f.get("email") || ""),
            kind,
            payload: {
              phone: String(f.get("phone") || ""),
              brokerage: String(f.get("brokerage") || ""),
              message: String(f.get("message") || ""),
              ...(f.get("meetingTime")
                ? {
                    meetingTime: new Date(
                      String(f.get("meetingTime")),
                    ).toISOString(),
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  }
                : {}),
            },
          };
          const content = JSON.stringify(data);
          if (lastRequest.current?.content !== content)
            lastRequest.current = { content, id: crypto.randomUUID() };
          await api("/api/v1/onboarding/inquiries", {
            method: "POST",
            body: JSON.stringify({
              ...data,
              requestId: lastRequest.current.id,
            }),
          });
          setSaved(true);
          lastRequest.current = null;
          requestAnimationFrame(() => receipt.current?.focus());
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div hidden aria-hidden="true">
        <label>
          Website
          <input name="website" autoComplete="off" tabIndex={-1} />
        </label>
      </div>
      <label className={s.field}>
        Your name
        <input
          name="name"
          autoComplete="name"
          className={s.input}
          required
          maxLength={150}
        />
      </label>
      <label className={s.field}>
        Email address
        <input
          name="email"
          type="email"
          autoComplete="email"
          className={s.input}
          required
        />
      </label>
      {kind !== "information" && (
        <div className={s.formGrid}>
          <label className={s.field}>
            Phone (optional)
            <input name="phone" type="tel" className={s.input} />
          </label>
          <label className={s.field}>
            Brokerage (optional)
            <input name="brokerage" className={s.input} />
          </label>
        </div>
      )}
      {kind === "meeting" && (
        <label className={s.field}>
          Preferred date and time
          <input
            type="datetime-local"
            name="meetingTime"
            className={s.input}
            required
          />
          <small>
            Enter the time in your local time zone. Ireland will confirm
            availability.
          </small>
        </label>
      )}
      <label className={s.field}>
        {kind === "contact"
          ? "How can I help?"
          : "Questions or details (optional)"}
        <textarea name="message" className={s.textarea} maxLength={5000} />
      </label>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <button className={s.button} disabled={busy}>
        {busy
          ? "Submitting…"
          : kind === "meeting"
            ? "Request a meeting"
            : kind === "information"
              ? "Request information"
              : "Send your inquiry"}
        <ArrowUpRight size={13} />
      </button>
    </form>
  );
}
