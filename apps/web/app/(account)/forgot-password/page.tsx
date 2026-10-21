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
        <h2>A fresh start.</h2>
        <p className={s.sub}>
          Request a private password reset link. Email recovery requires the
          approved system mail provider.
        </p>
        {done ? (
          <p className={s.notice} role="status">
            Your request was accepted. If an eligible account matches this email
            and recovery delivery is configured, follow the link in your inbox.
            Contact Ireland if you need help.
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
