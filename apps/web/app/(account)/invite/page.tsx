"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@weatherly/ui";
import s from "../login/login.module.css";
export default function Page() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") || "");
  }, []);
  return (
    <div className={s.page}>
      <aside className={s.story}>
        <Link className={s.brand} href="/">
          <strong>WEATHERLY</strong>
          <small>TRANSACTION CO.</small>
        </Link>
        <div>
          <h1>Welcome to Weatherly.</h1>
          <p>
            Use your invitation to open the transaction files shared with you.
          </p>
        </div>
      </aside>
      <main className={s.formSide}>
        <div className={s.form}>
          <p className={s.eyebrow}>Your personal invitation</p>
          <h2>{done ? "Account created." : "Create your account."}</h2>
          {done ? (
            <>
              <p className={s.sub}>
                Your invitation has been accepted. Sign in with your email and
                the password you just chose.
              </p>
              <Link className={s.button} href="/login">
                Continue to sign in
              </Link>
            </>
          ) : (
            <>
              <p className={s.sub}>
                Create your account using the invitation shared by your
                coordinator.
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  setBusy(true);
                  setError("");
                  try {
                    await api("/api/v1/invitations/register", {
                      method: "POST",
                      body: JSON.stringify({
                        token,
                        name: String(f.get("name")),
                        password: String(f.get("password")),
                      }),
                    });
                    setDone(true);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label className={s.field}>
                  Your name
                  <input
                    className={s.input}
                    name="name"
                    required
                    autoComplete="name"
                  />
                </label>
                <label className={s.field}>
                  Choose a password
                  <input
                    className={s.input}
                    name="password"
                    type="password"
                    minLength={12}
                    maxLength={128}
                    required
                    autoComplete="new-password"
                  />
                  <small>At least 12 characters.</small>
                </label>
                {!token && (
                  <p className={s.error}>
                    Open the complete invitation link from your coordinator.
                  </p>
                )}
                {error && (
                  <p className={s.error} role="alert">
                    {error}
                  </p>
                )}
                <button className={s.button} disabled={busy || !token}>
                  {busy
                    ? "Creating your account…"
                    : "Accept invitation & create account"}
                </button>
              </form>
              <p className={s.help}>
                Already have an account? Sign in first, then{" "}
                <button
                  className={s.demo}
                  disabled={!token || busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await api("/api/v1/invitations/accept", {
                        method: "POST",
                        body: JSON.stringify({ token }),
                      });
                      window.location.href = "/portal";
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Accept for signed-in account
                </button>
              </p>
            </>
          )}
          <Link className={s.back} href="/contact">
            Need help? Contact Ireland.
          </Link>
        </div>
      </main>
    </div>
  );
}
