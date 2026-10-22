"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@weatherly/ui";
import s from "./marketing.module.css";
import c from "./CalendlyScheduling.module.css";

type Configuration = {
  configured: boolean;
  eventUrl: string | null;
  syncConfigured: boolean;
};
type CalendlyApi = {
  initInlineWidget: (options: {
    url: string;
    parentElement: HTMLElement;
    resize: boolean;
  }) => void;
};
export default function CalendlyScheduling() {
  const host = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<Configuration | null>(null);
  const [state, setState] = useState("loading");
  const [attempt, setAttempt] = useState(0);
  const [reported, setReported] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      controller.abort();
      if (active) setState("config-error");
    }, 15000);
    setState("loading");
    api<Configuration>("/api/v1/onboarding/scheduling", {
      signal: controller.signal,
    })
      .then((value) => {
        if (!active) return;
        if (!value.configured || !value.eventUrl) {
          setConfig(null);
          setState("unconfigured");
          return;
        }
        const url = new URL(value.eventUrl);
        if (
          url.origin !== "https://calendly.com" ||
          url.username ||
          url.password
        )
          throw new Error("Invalid scheduling URL");
        setConfig({ ...value, eventUrl: url.href });
        setState("widget-loading");
      })
      .catch(() => {
        if (active) setState("config-error");
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [attempt]);
  useEffect(() => {
    if (!config?.eventUrl || state !== "widget-loading" || !host.current)
      return;
    const container = host.current;
    let active = true;
    let initialized = false;
    const timer = window.setTimeout(() => {
      if (active) setState("timeout");
    }, 20000);
    const onMessage = (event: MessageEvent) => {
      const frame = container.querySelector("iframe");
      if (
        event.origin !== "https://calendly.com" ||
        !frame ||
        event.source !== frame.contentWindow
      )
        return;
      const name = event.data?.event;
      if (
        ![
          "calendly.profile_page_viewed",
          "calendly.event_type_viewed",
          "calendly.date_and_time_selected",
          "calendly.event_scheduled",
        ].includes(name)
      )
        return;
      window.clearTimeout(timer);
      // A browser message is only a display hint; verified bookings come from the server.
      if (name === "calendly.event_scheduled") setReported(true);
      container.dataset.ready = "true";
      setState("ready");
    };
    window.addEventListener("message", onMessage);
    const initialize = () => {
      if (!active || initialized) return;
      const widget = (window as Window & { Calendly?: CalendlyApi }).Calendly;
      if (!widget) {
        setState("widget-error");
        return;
      }
      initialized = true;
      try {
        widget.initInlineWidget({
          url: config.eventUrl!,
          parentElement: container,
          resize: true,
        });
      } catch {
        window.clearTimeout(timer);
        setState("widget-error");
        return;
      }
      const frame = container.querySelector("iframe");
      if (frame)
        frame.title = "Schedule an onboarding meeting with Ireland on Calendly";
    };
    const script = document.createElement("script");
    script.src = "https://assets.calendly.com/assets/external/widget.js";
    script.async = true;
    script.onload = initialize;
    script.onerror = () => {
      if (active) setState("widget-error");
    };
    if ((window as Window & { Calendly?: CalendlyApi }).Calendly) initialize();
    else document.head.appendChild(script);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      script.remove();
      container.replaceChildren();
    };
    // Keep the mounted iframe alive when its status changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);
  const retry = () => {
    setConfig(null);
    setReported(false);
    setAttempt((value) => value + 1);
  };
  return (
    <section className={s.panel} aria-labelledby="schedule-heading">
      <h2 id="schedule-heading">Schedule your onboarding</h2>
      <p>
        Choose an available time with Ireland. Review the time zone shown in
        Calendly before completing your booking.
      </p>
      <div role="status" aria-live="polite">
        {state === "loading" && <p>Loading scheduling options…</p>}
        {state === "unconfigured" && (
          <p>
            Online scheduling is not available yet. Use the service information
            form below to get in touch with Ireland.
          </p>
        )}
        {state === "config-error" && (
          <p>
            Scheduling options could not be loaded. Please try again or use the
            service information form below.
          </p>
        )}
        {state === "widget-loading" && (
          <p>Loading Calendly… You can also open the booking page directly.</p>
        )}
        {(state === "timeout" || state === "widget-error") && (
          <p>
            Calendly could not finish loading. Open the booking page directly or
            retry the calendar.
          </p>
        )}
        {reported && (
          <p>
            Calendly reported that you completed a booking. Refer to Calendly’s
            confirmation for your meeting details and cancellation or
            rescheduling links. Portal verification may still be pending.
          </p>
        )}
      </div>
      {config?.eventUrl && (
        <p>
          <a
            className={s.secondary}
            href={config.eventUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Calendly booking page (new tab)
          </a>
        </p>
      )}
      {["config-error", "timeout", "widget-error"].includes(state) && (
        <button className={s.secondary} type="button" onClick={retry}>
          Retry scheduling
        </button>
      )}
      <div className={c.calendar} ref={host} hidden={!config?.eventUrl} />
      <p className={c.note}>
        Scheduling is provided by Calendly. Booking a meeting does not approve
        portal access or complete your service agreement.
      </p>
    </section>
  );
}
