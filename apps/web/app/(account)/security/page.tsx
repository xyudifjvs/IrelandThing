"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@weatherly/ui";
import s from "../login/login.module.css";
import { safeAuthorizationReturn } from "../_components/navigation";
export default function Page() {
  const [returnTo, setReturnTo] = useState("/workspace");
  useEffect(() => {
    setReturnTo(
      safeAuthorizationReturn(
        new URLSearchParams(window.location.search).get("next"),
        window.location.origin,
      ) || "/workspace",
    );
  }, []);
  const [setup, setSetup] = useState<{
    totpURI: string;
    backupCodes: string[];
  } | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  let secret = "";
  try {
    if (setup) secret = new URL(setup.totpURI).searchParams.get("secret") || "";
  } catch {}
  return (
    <div className={s.page}>
      <aside className={s.story}>
        <Link href="/" className={s.brand}>
          <strong>WEATHERLY</strong>
          <small>TRANSACTION CO.</small>
        </Link>
        <div>
          <h1>Set up two-step sign-in.</h1>
          <p>
            Coordinators need a password and an authenticator code to access the
            workspace.
          </p>
        </div>
      </aside>
      <main className={s.formSide}>
        <div className={s.form}>
          <p className={s.eyebrow}>Account security</p>
          <h2>
            {done ? "Authenticator connected." : "Set up your authenticator."}
          </h2>
          <p className={s.sub}>
            Use an authenticator app to generate a code when you sign in. Keep
            the setup key and recovery codes private.
          </p>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          {done ? (
            <Link className={s.button} href={returnTo}>
              Continue to workspace
            </Link>
          ) : !setup ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  setSetup(
                    await api("/api/auth/two-factor/enable", {
                      method: "POST",
                      body: JSON.stringify({ password, method: "totp" }),
                    }),
                  );
                  setPassword("");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className={s.field}>
                Confirm your password
                <input
                  className={s.input}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </label>
              <button className={s.button} disabled={busy}>
                {busy ? "Preparing…" : "Prepare authenticator setup"}
              </button>
            </form>
          ) : (
            <>
              <p className={s.sub}>
                Add a new time-based account named Weatherly in your
                authenticator, using this setup key.
              </p>
              <label className={s.field}>
                Private setup key
                <input
                  className={s.input}
                  value={secret}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <a className={s.back} href={setup.totpURI}>
                Open compatible authenticator app
              </a>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  try {
                    await api("/api/auth/two-factor/verify-totp", {
                      method: "POST",
                      body: JSON.stringify({ code, trustDevice: false }),
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
                  Six-digit authenticator code
                  <input
                    className={s.input}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    pattern="[0-9]{6}"
                  />
                </label>
                <button className={s.button} disabled={busy}>
                  {busy ? "Verifying…" : "Verify authenticator"}
                </button>
              </form>
            </>
          )}
          {setup && (
            <div className={s.notice}>
              <strong>Save your backup codes privately.</strong>
              <p>
                Each code can be used once if you lose access to your
                authenticator. These are only displayed in this session.
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  fontFamily: "monospace",
                  color: "#80603e",
                }}
              >
                {setup.backupCodes.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
              <button
                className={s.demo}
                onClick={() => {
                  const blob = new Blob(
                    [
                      `Weatherly backup codes\n${setup.backupCodes.join("\n")}\nKeep these private.`,
                    ],
                    { type: "text/plain" },
                  );
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "weatherly-backup-codes.txt";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Save backup codes
              </button>
            </div>
          )}
          <Link className={s.back} href="/account">
            Return to account
          </Link>
        </div>
      </main>
    </div>
  );
}
