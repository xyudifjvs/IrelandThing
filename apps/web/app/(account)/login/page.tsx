"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowLeft, LockKeyhole } from "lucide-react";
import { api } from "@weatherly/ui";
import s from "./login.module.css";
import { safeAuthorizationReturn } from "../_components/navigation";
export default function Login() {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [challenge, setChallenge] = useState(false),
    [code, setCode] = useState(""),
    [backup, setBackup] = useState(false);
  async function enter() {
    const session = await api<{ user: { role: string } }>(
      "/api/v1/session",
    );
    const next = safeAuthorizationReturn(
      new URLSearchParams(window.location.search).get("next"),
      window.location.origin,
    );
    window.location.href =
      next || (session.user.role === "coordinator" ? "/workspace" : "/portal");
  }
  async function signIn(mail = email, secret = password) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ twoFactorRedirect?: boolean }>(
        "/api/auth/sign-in/email",
        {
          method: "POST",
          body: JSON.stringify({ email: mail, password: secret }),
        },
      );
      if (result.twoFactorRedirect) {
        setChallenge(true);
        setPassword("");
      } else await enter();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    setError("");
    try {
      await api(
        `/api/auth/two-factor/${backup ? "verify-backup-code" : "verify-totp"}`,
        { method: "POST", body: JSON.stringify({ code, trustDevice: false }) },
      );
      await enter();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={s.page}>
      <aside className={s.story}>
        <Link href="/" className={s.brand}>
          <strong>WEATHERLY</strong>
          <small>TRANSACTION CO.</small>
        </Link>
        <div>
          <h1>Your transaction workspace.</h1>
          <p>
            Sign in to review documents, check deadlines and see the latest
            updates on your transactions.
          </p>
        </div>
        <p className={s.copyright}>
          © {new Date().getFullYear()} Weatherly Transaction Co.
        </p>
      </aside>
      <div className={s.formSide}>
        <div className={s.form}>
          <p className={s.eyebrow}>Account sign-in</p>
          <h2>
            {challenge ? "Enter your verification code." : "Welcome back."}
          </h2>
          <p className={s.sub}>
            {challenge
              ? "Use a code from your authenticator app or one of your backup codes."
              : "Use the email address associated with your Weatherly account."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void (challenge ? verify() : signIn());
            }}
          >
            {challenge ? (
              <label className={s.field}>
                {backup ? "Backup code" : "Authenticator code"}
                <input
                  className={s.input}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="one-time-code"
                  inputMode={backup ? "text" : "numeric"}
                  required
                  autoFocus
                />
              </label>
            ) : (
              <>
                <label className={s.field}>
                  Email address
                  <input
                    type="email"
                    className={s.input}
                    value={email}
                    autoComplete="username"
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </label>
                <label className={s.field}>
                  Password
                  <input
                    type="password"
                    className={s.input}
                    value={password}
                    autoComplete="current-password"
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </label>
              </>
            )}
            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
            <button type="submit" className={s.button} disabled={busy}>
              {busy
                ? "Opening your workspace…"
                : challenge
                  ? "Verify & continue"
                  : "Sign in"}
              <ArrowRight size={13} />
            </button>
          </form>
          {challenge && (
            <button
              className={s.demo}
              onClick={() => {
                setBackup(!backup);
                setCode("");
              }}
            >
              {backup ? "Use authenticator code" : "Use a backup code"}
            </button>
          )}
          {!challenge && process.env.NEXT_PUBLIC_APP_ENV === "local" && (
            <>
              <button
                className={s.demo}
                disabled={busy}
                onClick={() =>
                  void signIn("ireland@example.test", "Weatherly-Local-2026!")
                }
              >
                Use local demo workspace
              </button>
              <p className={s.notice}>
                Development preview only. Uses a seeded synthetic coordinator
                account. No real customer data or connected mailbox.
              </p>
            </>
          )}
          <p className={s.help}>
            {!challenge && (
              <>
                <Link href="/forgot-password">Forgot your password?</Link>
                <br />
              </>
            )}
            New to Weatherly?{" "}
            <Link href="/onboarding">Ask about working with Ireland.</Link>
            <br />
            Need access or help signing in?{" "}
            <Link href="/contact">Contact Ireland.</Link>
          </p>
          <p className={s.help}>
            <LockKeyhole size={11} /> Access by invitation
          </p>
          <Link className={s.back} href="/">
            <ArrowLeft size={10} /> Back to Weatherly
          </Link>
        </div>
      </div>
    </div>
  );
}
