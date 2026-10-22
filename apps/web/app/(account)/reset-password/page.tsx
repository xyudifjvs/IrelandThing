"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@weatherly/ui";
import s from "../login/login.module.css";
export default function Page() {
  const [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setToken(p.get("token") || "");
    if (p.get("error"))
      setError("This recovery link is invalid or expired. Request a new link.");
  }, []);
  return (
    <div
      className={s.formSide}
      style={{ minHeight: "100vh", background: "#f5efe2" }}
    >
      <div className={s.form}>
        <p className={s.eyebrow}>Account recovery</p>
        <h2>{done ? "Your password is updated." : "Choose a new password."}</h2>
        <p className={s.sub}>
          Use at least 12 characters. Your previous sessions will be revoked
          after a successful reset.
        </p>
        {done ? (
          <Link className={s.button} href="/login">
            Continue to sign in
          </Link>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const password = String(f.get("password"));
              if (password !== String(f.get("confirm"))) {
                setError("The two passwords do not match.");
                return;
              }
              setBusy(true);
              setError("");
              try {
                await api("/api/auth/reset-password", {
                  method: "POST",
                  body: JSON.stringify({ token, newPassword: password }),
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
              New password
              <input
                className={s.input}
                type="password"
                name="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
            <label className={s.field}>
              Confirm new password
              <input
                className={s.input}
                type="password"
                name="confirm"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
            {!token && (
              <p className={s.error}>
                Open a valid recovery link from your email.
              </p>
            )}
            <button className={s.button} disabled={!token || busy}>
              {busy ? "Updating…" : "Update password"}
            </button>
          </form>
        )}
        <Link className={s.back} href="/forgot-password">
          Request a new recovery link
        </Link>
      </div>
    </div>
  );
}
