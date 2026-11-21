"use client";
import { useState } from "react";
import { api } from "@weatherly/ui";
import { safeAuthorizationReturn } from "../_components/navigation";
import { AuthFrame } from "../_components/AuthFrame";
import { PasswordField } from "../_components/PasswordField";
import s from "../_components/auth.module.css";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [challenge, setChallenge] = useState(false);
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  async function enter() {
    const params = new URLSearchParams(window.location.search);
    const invitation = params.get("invitation");
    if (invitation) {
      await api("/api/v1/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token: invitation }),
      });
      window.location.replace("/portal");
      return;
    }
    const session = await api<{ user: { role: string } }>("/api/v1/session");
    const next = safeAuthorizationReturn(
      params.get("next"),
      window.location.origin,
    );
    window.location.replace(
      next || (session.user.role === "coordinator" ? "/workspace" : "/portal"),
    );
  }
  async function signIn(mail = email, secret = password) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ twoFactorRedirect?: boolean }>(
        "/api/auth/sign-in/email",
        {
          method: "POST",
          body: JSON.stringify({ email: mail, password: secret, rememberMe }),
        },
      );
      if (result.twoFactorRedirect) {
        setChallenge(true);
        setPassword("");
      } else await enter();
    } catch (failure) {
      setError((failure as Error).message);
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
        {
          method: "POST",
          body: JSON.stringify({ code, trustDevice: false }),
        },
      );
      await enter();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthFrame>
      <p className={s.eyebrow}>
        {challenge ? "Account verification" : "Welcome back"}
      </p>
      <h1 className={challenge ? undefined : s.signInHeading}>
        {challenge
          ? "Enter your verification code"
          : "Sign in to your agent portal"}
      </h1>
      {challenge && (
        <p className={s.sub}>
          Use a code from your authenticator app or one of your backup codes.
        </p>
      )}
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
              Email
              <input
                type="email"
                className={s.input}
                value={email}
                autoComplete="username"
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <PasswordField value={password} onChange={setPassword} />
            <label className={s.remember}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              Keep me signed in on this device
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
            ? "Opening your portal…"
            : challenge
              ? "Verify & continue"
              : "Sign in"}
        </button>
      </form>
      {challenge && (
        <button
          type="button"
          className={s.secondary}
          onClick={() => {
            setBackup(!backup);
            setCode("");
          }}
        >
          {backup ? "Use authenticator code" : "Use a backup code"}
        </button>
      )}
      {!challenge && process.env.NEXT_PUBLIC_APP_ENV === "local" && (
        <button
          type="button"
          className={s.secondary}
          disabled={busy}
          onClick={() =>
            void signIn("ireland@example.test", "Weatherly-Local-2026!")
          }
        >
          Use local demo workspace
        </button>
      )}
    </AuthFrame>
  );
}
