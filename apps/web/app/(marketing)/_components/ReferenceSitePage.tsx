"use client";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { api } from "@weatherly/ui";
import { completeSite, type CompleteSitePage } from "./complete-site-reference";
import "./complete-site.css";
type Result = { message: string; error?: boolean; id?: string };
type Scheduling = { configured: boolean; eventUrl: string | null };
export default function ReferenceSitePage({
  page,
}: {
  page: CompleteSitePage;
}) {
  const source = completeSite[page],
    root = useRef<HTMLDivElement>(null),
    active = useRef(false),
    loginChallenge = useRef(false);
  const requests = useRef(
    new Map<
      string,
      { content: string; requestId: string; receivedId?: string }
    >(),
  );
  const [results, setResults] = useState<Record<string, Result>>({}),
    [booking, setBooking] = useState(false),
    [scheduling, setScheduling] = useState<Scheduling | null>(null),
    [challenge, setChallenge] = useState(false),
    [code, setCode] = useState(""),
    [backup, setBackup] = useState(false),
    [verifying, setVerifying] = useState(false);
  const [hosts, setHosts] = useState<{
    status: Record<string, HTMLElement>;
    booking?: HTMLElement;
    challenge?: HTMLElement;
  }>({ status: {} });
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const status = Object.fromEntries(
      [
        ...el.querySelectorAll<HTMLFormElement>("form[data-reference-form]"),
      ].map((form) => [
        form.dataset.referenceForm!,
        form.querySelector<HTMLElement>("[data-form-status]")!,
      ]),
    );
    setHosts({
      status,
      booking:
        el.querySelector<HTMLElement>("[data-booking-request]") || undefined,
      challenge:
        el.querySelector<HTMLElement>("[data-login-challenge]") || undefined,
    });
  }, [page]);
  useEffect(() => {
    for (const [key, host] of Object.entries(hosts.status))
      host.hidden = !results[key];
    if (hosts.booking) hosts.booking.hidden = !booking;
    if (hosts.challenge) hosts.challenge.hidden = !challenge;
  }, [hosts, results, booking, challenge]);
  useEffect(() => {
    if (page !== "onboarding") return;
    let live = true;
    api<Scheduling>("/api/v1/onboarding/scheduling")
      .then((value) => {
        if (live) setScheduling(value);
      })
      .catch(() => {
        if (live) setScheduling(null);
      });
    return () => {
      live = false;
    };
  }, [page]);
  useEffect(() => {
    if (!root.current || page !== "agentPortal") return;
    const form = root.current.querySelector<HTMLFormElement>(
      '[data-reference-form="login"]',
    );
    if (form)
      for (const el of form.querySelectorAll<
        HTMLInputElement | HTMLButtonElement
      >('input[name="email"],input[name="password"],button[type="submit"]'))
        el.disabled = challenge;
  }, [challenge, page]);
  async function enter() {
    const session = await api<{ user: { role: string } }>("/api/v1/session");
    location.href =
      session.user.role === "coordinator" ? "/workspace" : "/portal";
  }
  async function submit(event: FormEvent<HTMLDivElement>) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.dataset.referenceForm)
      return;
    event.preventDefault();
    if (active.current) return;
    const kind = form.dataset.referenceForm;
    if (kind === "login" && loginChallenge.current) return;
    const fields = new FormData(form),
      controls = [
        ...form.querySelectorAll<
          HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement
        >("input,button,textarea"),
      ].map((el) => ({ el, disabled: el.disabled }));
    active.current = true;
    controls.forEach(({ el }) => (el.disabled = true));
    setResults((old) => ({ ...old, [kind]: { message: "Saving…" } }));
    try {
      if (kind === "login") {
        const result = await api<{ twoFactorRedirect?: boolean }>(
          "/api/auth/sign-in/email",
          {
            method: "POST",
            body: JSON.stringify({
              email: String(fields.get("email") || ""),
              password: String(fields.get("password") || ""),
            }),
          },
        );
        if (result.twoFactorRedirect) {
          loginChallenge.current = true;
          setChallenge(true);
          const password =
            form.querySelector<HTMLInputElement>('[name="password"]');
          if (password) password.value = "";
          setResults((old) => ({
            ...old,
            [kind]: {
              message:
                "Enter your authenticator or backup code to finish signing in.",
            },
          }));
        } else await enter();
      } else {
        const payload = {
          name: String(fields.get("name") || ""),
          email: String(fields.get("email") || ""),
          kind: kind === "contact" ? "contact" : "information",
          payload: {
            brokerage: "Howard Hanna",
            ...(kind === "service_agreement"
              ? {
                  requestType: "service_agreement",
                  team: String(fields.get("team") || ""),
                  officeAddress: String(fields.get("officeAddress") || ""),
                }
              : {}),
            ...(kind === "contact"
              ? { message: String(fields.get("message") || "") }
              : {}),
          },
        };
        const content = JSON.stringify(payload),
          previous = requests.current.get(kind);
        if (previous?.content === content && previous.receivedId) {
          setResults((old) => ({
            ...old,
            [kind]: {
              message:
                "Your request is already saved for Ireland to review. No email or invitation was sent.",
              id: previous.receivedId,
            },
          }));
          return;
        }
        const request =
          previous?.content === content
            ? previous
            : { content, requestId: crypto.randomUUID() };
        requests.current.set(kind, request);
        const saved = await api<{ id: string; status: string }>(
          "/api/v1/onboarding/inquiries",
          {
            method: "POST",
            body: JSON.stringify({ ...payload, requestId: request.requestId }),
          },
        );
        if (!saved.id || saved.status !== "received")
          throw Error("The request was not confirmed saved. Please retry.");
        request.receivedId = saved.id;
        setResults((old) => ({
          ...old,
          [kind]: {
            message:
              kind === "service_agreement"
                ? "Service-agreement request saved for Ireland to review. No agreement or invitation has been sent."
                : kind === "contact"
                  ? "Message saved for Ireland to review. This form has not sent an email."
                  : "Information request saved for Ireland to review. No email has been sent yet.",
            id: saved.id,
          },
        }));
      }
    } catch (error) {
      setResults((old) => ({
        ...old,
        [kind]: { message: (error as Error).message, error: true },
      }));
    } finally {
      controls.forEach(
        ({ el, disabled }) =>
          (el.disabled =
            disabled || (kind === "login" && loginChallenge.current)),
      );
      active.current = false;
    }
  }
  function click(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as Element;
    if (!target.closest("[data-book-call]")) return;
    event.preventDefault();
    if (scheduling?.configured && scheduling.eventUrl) {
      try {
        const url = new URL(scheduling.eventUrl);
        if (
          url.origin === "https://calendly.com" &&
          !url.username &&
          !url.password
        ) {
          location.href = url.href;
          return;
        }
      } catch {
        /* Keep the saved-request fallback. */
      }
    }
    setBooking(true);
  }
  async function verify() {
    if (verifying) return;
    setVerifying(true);
    try {
      await api(
        `/api/auth/two-factor/${backup ? "verify-backup-code" : "verify-totp"}`,
        { method: "POST", body: JSON.stringify({ code, trustDevice: false }) },
      );
      await enter();
    } catch (error) {
      setResults((old) => ({
        ...old,
        login: { message: (error as Error).message, error: true },
      }));
    } finally {
      setVerifying(false);
    }
  }
  return (
    <div
      className="weatherly-complete-site"
      style={{ background: source.background }}
    >
      <div
        ref={root}
        onSubmit={submit}
        onClick={click}
        dangerouslySetInnerHTML={{ __html: source.body }}
      />
      {Object.entries(hosts.status).map(([kind, host]) =>
        results[kind]
          ? createPortal(
              <p
                className="weatherly-site-message"
                role={results[kind].error ? "alert" : "status"}
              >
                {results[kind].message}
                {results[kind].id && (
                  <small>Saved request {results[kind].id}</small>
                )}
                {kind === "login" && results[kind].error && (
                  <a href="/forgot-password">Password recovery</a>
                )}
              </p>,
              host,
            )
          : null,
      )}
      {hosts.challenge &&
        challenge &&
        createPortal(
          <div className="weatherly-site-operation">
            <label>
              Verification code
              <input
                aria-label="Verification code"
                autoComplete="one-time-code"
                disabled={verifying}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (code.trim()) void verify();
                  }
                }}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={backup}
                disabled={verifying}
                onChange={(e) => setBackup(e.target.checked)}
              />{" "}
              Use a backup code
            </label>
            <button
              type="button"
              disabled={verifying || !code.trim()}
              onClick={() => void verify()}
            >
              {verifying ? "Verifying…" : "Verify and continue"}
            </button>
          </div>,
          hosts.challenge,
        )}
      {hosts.booking &&
        booking &&
        createPortal(<BookingRequest />, hosts.booking)}
    </div>
  );
}
function BookingRequest() {
  const [result, setResult] = useState<Result | null>(null),
    [busy, setBusy] = useState(false);
  const request = useRef<{
    content: string;
    id: string;
    received?: string;
  } | null>(null);
  return (
    <form
      className="weatherly-site-operation"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const fields = new FormData(e.currentTarget);
        setBusy(true);
        setResult(null);
        try {
          const input = {
              name: String(fields.get("name")),
              email: String(fields.get("email")),
              kind: "meeting",
              payload: {
                brokerage: "Howard Hanna",
                meetingTime: new Date(
                  String(fields.get("meetingTime")),
                ).toISOString(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              },
            },
            content = JSON.stringify(input);
          if (request.current?.content !== content)
            request.current = { content, id: crypto.randomUUID() };
          if (request.current.received) {
            setResult({
              message:
                "This call request is already saved. Ireland will confirm availability.",
              id: request.current.received,
            });
            return;
          }
          const saved = await api<{ id: string; status: string }>(
            "/api/v1/onboarding/inquiries",
            {
              method: "POST",
              body: JSON.stringify({ ...input, requestId: request.current.id }),
            },
          );
          if (!saved.id || saved.status !== "received")
            throw Error("The request was not confirmed saved. Please retry.");
          request.current.received = saved.id;
          setResult({
            message:
              "Call request saved. Ireland will confirm availability; no meeting, Zoom link or email has been created.",
            id: saved.id,
          });
        } catch (error) {
          setResult({ message: (error as Error).message, error: true });
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        Scheduling is not connected yet. Request a call for Ireland to review.
      </p>
      <fieldset disabled={busy}>
        <label>
          Name
          <input name="name" required maxLength={150} />
        </label>
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <label>
          Preferred time (your local time)
          <input name="meetingTime" type="datetime-local" required />
        </label>
        <button type="submit">{busy ? "Saving…" : "Request this call"}</button>
      </fieldset>
      {result && (
        <p role={result.error ? "alert" : "status"}>{result.message}</p>
      )}
    </form>
  );
}
