"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@weatherly/ui";
import { AuthFrame } from "../_components/AuthFrame";
import { PasswordField } from "../_components/PasswordField";
import s from "../_components/auth.module.css";

export default function Page() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  useEffect(() => {
    const value =
      new URLSearchParams(window.location.search).get("token") || "";
    setToken(value);
    if (!value) {
      setError("Open the complete invitation link from your coordinator.");
      setLoading(false);
      return;
    }
    let current = true;
    api<{ email: string }>("/api/v1/invitations/preview", {
      method: "POST",
      body: JSON.stringify({ token: value }),
    })
      .then((data) => {
        if (current) setEmail(data.email);
      })
      .catch((failure) => {
        if (current) setError(failure.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);
  return (
    <AuthFrame>
      <p className={s.eyebrow}>Your personal invitation</p>
      <h1>{created ? "Your account is ready" : "Create your account"}</h1>
      {created ? (
        <>
          <p className={s.sub}>
            Your invitation has been accepted and your account is created.
            Automatic sign-in could not finish. Sign in with the password you
            just chose.
          </p>
          <Link className={s.button} href="/login">
            Sign in
          </Link>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            let registered = false;
            try {
              const result = await api<{ email: string }>(
                "/api/v1/invitations/register",
                {
                  method: "POST",
                  body: JSON.stringify({
                    token,
                    name: String(form.get("name")),
                    password,
                  }),
                },
              );
              registered = true;
              await api("/api/auth/sign-in/email", {
                method: "POST",
                body: JSON.stringify({
                  email: result.email,
                  password,
                  rememberMe: true,
                }),
              });
              setPassword("");
              window.location.replace("/portal");
            } catch (failure) {
              if (registered) setCreated(true);
              setError((failure as Error).message);
            } finally {
              setPassword("");
              setBusy(false);
            }
          }}
        >
          <label className={s.field}>
            Email
            <input
              className={s.input}
              type="email"
              value={email}
              readOnly
              autoComplete="username"
              placeholder={loading ? "Checking your invitation…" : ""}
            />
          </label>
          <label className={s.field}>
            Your name
            <input
              className={s.input}
              name="name"
              required
              maxLength={150}
              autoComplete="name"
              placeholder="First and last name"
            />
          </label>
          <PasswordField creating value={password} onChange={setPassword} />
          <button className={s.button} disabled={busy || loading || !email}>
            {busy
              ? "Opening your portal…"
              : "Accept invitation & create account"}
          </button>
        </form>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {!created && (
        <p className={s.help}>
          Already have an account?{" "}
          <Link
            href={
              token
                ? `/login?invitation=${encodeURIComponent(token)}`
                : "/login"
            }
          >
            Sign in
          </Link>
        </p>
      )}
      <p className={s.contact}>
        Questions? Email Ireland at{" "}
        <a href="mailto:ireland@weatherlytc.com">ireland@weatherlytc.com</a>
      </p>
    </AuthFrame>
  );
}
