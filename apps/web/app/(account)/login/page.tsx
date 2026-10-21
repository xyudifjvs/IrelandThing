"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowLeft, LockKeyhole } from "lucide-react";
import { api } from "@weatherly/ui";
import s from "./login.module.css";
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn(mail = email, secret = password) {
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/sign-in/email", {
        method: "POST",
        body: JSON.stringify({ email: mail, password: secret }),
      });
      const session = await api<{ user: { role: string } }>("/api/v1/session");
      window.location.href =
        session.user.role === "coordinator" ? "/workspace" : "/portal";
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
          <h1>
            A little more clarity.
            <br />
            <em>A lot less to carry.</em>
          </h1>
          <p>
            Your people, properties and next steps — thoughtfully brought
            together.
          </p>
        </div>
        <p className={s.copyright}>
          © {new Date().getFullYear()} Weatherly Transaction Co.
        </p>
      </aside>
      <main className={s.formSide}>
        <div className={s.form}>
          <p className={s.eyebrow}>Your secure workspace</p>
          <h2>Welcome back.</h2>
          <p className={s.sub}>The next step is right where you left it.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void signIn();
            }}
          >
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
            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
            <button type="submit" className={s.button} disabled={busy}>
              {busy ? "Opening your workspace…" : "Sign in"}
              <ArrowRight size={13} />
            </button>
          </form>
          {process.env.NEXT_PUBLIC_APP_ENV === "local" && (
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
            New to Weatherly?{" "}
            <Link href="/onboarding">Let’s get acquainted.</Link>
            <br />
            Need access or help signing in?{" "}
            <Link href="/contact">Contact Ireland.</Link>
          </p>
          <p className={s.help}>
            <LockKeyhole size={11} /> Private files. Thoughtful access.
          </p>
          <Link className={s.back} href="/">
            <ArrowLeft size={10} /> Back to Weatherly
          </Link>
        </div>
      </main>
    </div>
  );
}
