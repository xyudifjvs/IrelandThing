"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@weatherly/ui";
import s from "../login/login.module.css";
export default function Page() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  return (
    <main
      className={s.formSide}
      style={{ minHeight: "100vh", background: "#f5efe2" }}
    >
      <div className={s.form}>
        <p className={s.eyebrow}>Account recovery</p>
        <h2>Reset your password.</h2>
        <p className={s.sub}>Enter the email address you use for Weatherly.</p>
        {done ? (
          <p className={s.notice} role="status">
            If reset emails are enabled and this address matches an account,
            you’ll receive a reset link. Contact Ireland if it doesn’t arrive.
          </p>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                await api("/api/auth/request-password-reset", {
                  method: "POST",
                  body: JSON.stringify({
                    email: String(f.get("email")),
                    redirectTo: `${window.location.origin}/reset-password`,
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
              Email address
              <input
                name="email"
                type="email"
                className={s.input}
                required
                autoComplete="email"
              />
            </label>
            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
            <button className={s.button} disabled={busy}>
              {busy ? "Requesting…" : "Request reset link"}
            </button>
          </form>
        )}
        <Link className={s.back} href="/login">
          ← Return to sign in
        </Link>
      </div>
    </main>
  );
}
