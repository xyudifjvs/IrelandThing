"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@weatherly/ui";
import s from "../login/login.module.css";
type Consent = {
  id: string;
  clientName: string;
  scope: string | string[];
  warning: string;
  expiresAt: string;
};
export default function Page() {
  const [request, setRequest] = useState(""),
    [consent, setConsent] = useState<Consent | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("request");
    if (!value) {
      setError(
        "This authorization request is incomplete. Return to the approved assistant client and start again.",
      );
      return;
    }
    setRequest(value);
    api<Consent>(`/api/v1/assistant/consent/${encodeURIComponent(value)}`)
      .then(setConsent)
      .catch((e) => setError((e as Error).message));
  }, []);
  async function decide(approved: boolean) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ redirectUrl: string }>(
        `/api/v1/assistant/consent/${encodeURIComponent(request)}`,
        { method: "POST", body: JSON.stringify({ approved }) },
      );
      if (!result.redirectUrl)
        throw new Error(
          "Authorization response did not include a return address.",
        );
      window.location.href = result.redirectUrl;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      className={s.formSide}
      style={{ minHeight: "100vh", background: "#f5efe2" }}
    >
      <div className={s.form}>
        <Link href="/" className={s.brand}>
          <strong>WEATHERLY</strong>
          <small>TRANSACTION CO.</small>
        </Link>
        <p className={s.eyebrow} style={{ marginTop: 35 }}>
          Assistant access request
        </p>
        <h2>Review this connection.</h2>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {consent ? (
          <>
            <p className={s.sub}>
              <strong>{consent.clientName}</strong> is requesting access to your
              authorized Weatherly information.
            </p>
            <div className={s.notice}>
              <strong>Requested access</strong>
              <p>
                {Array.isArray(consent.scope)
                  ? consent.scope.join(", ")
                  : consent.scope}
              </p>
              <p>{consent.warning}</p>
              <p>Expires {new Date(consent.expiresAt).toLocaleString()}.</p>
            </div>
            <p className={s.sub}>
              Only approve the client you intended to connect. Its own AI use
              must comply with Weatherly’s approved OpenRouter/ZDR policy.
            </p>
            <button
              className={s.button}
              disabled={busy || new Date(consent.expiresAt) <= new Date()}
              onClick={() => void decide(true)}
            >
              {busy ? "Saving your decision…" : "Approve this connection"}
            </button>
            <button
              className={s.demo}
              disabled={busy}
              onClick={() => void decide(false)}
            >
              Deny access
            </button>
          </>
        ) : !error ? (
          <p className={s.sub}>Checking the authorization request…</p>
        ) : null}
        <Link className={s.back} href="/account">
          Return to your account
        </Link>
      </div>
    </main>
  );
}
