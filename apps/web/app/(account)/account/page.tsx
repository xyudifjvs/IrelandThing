"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import {
  useData,
  mutate,
  type Session,
} from "../../(workspace)/workspace/_components/data";
import { PaymentHistory, TransactionHistory } from "./AccountHistory";
import s from "./account.module.css";

export default function Page() {
  const profile = useData<{ name: string; email: string; brokerage?: string }>(
    "/api/v1/profile",
  );
  const session = useData<Session>("/api/v1/session");
  const [name, setName] = useState<string | null>(null);
  const [brokerage, setBrokerage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const role = session.data?.user?.role;
  const coordinator = role === "coordinator";
  const hasHistory = role === "agent" || coordinator;

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div className={s.headerInner}>
          <Link
            className={s.brand}
            href="/"
            aria-label="Weatherly Transaction Co. home"
          >
            WEATHERLY<span>TRANSACTION CO.</span>
          </Link>
          <Link
            className={s.back}
            href={coordinator ? "/workspace" : "/portal"}
          >
            <ArrowLeft size={13} aria-hidden="true" />
            {coordinator ? "Your workspace" : "Your portal"}
          </Link>
        </div>
      </header>
      <div className={s.main}>
        <div className={s.intro}>
          <div>
            <p className={s.eyebrow}>
              {hasHistory ? "Your agent account" : "Account settings"}
            </p>
            <h1>Your account</h1>
            <p className={s.subtitle}>
              {hasHistory
                ? "Your transaction history, payments and account details in one place."
                : "Keep your contact details up to date and your account protected."}
            </p>
          </div>
          {session.data?.user && (
            <p className={s.formHint}>{session.data.user.name}</p>
          )}
        </div>
        <nav className={s.sectionNav} aria-label="Account sections">
          {hasHistory && (
            <>
              <a href="#transactions">All transactions</a>
              <a href="#payments">Payments</a>
            </>
          )}
          <a href="#profile">Your profile</a>
          <a href="#security">Security</a>
        </nav>
        {session.loading && (
          <p className={s.loading} role="status">
            Opening your account…
          </p>
        )}
        {session.error && (
          <div className={s.error} role="alert">
            <p>Your account could not be opened. {session.error}</p>
            <div className={s.actions}>
              <button
                className={s.secondary}
                onClick={() => void session.refresh()}
              >
                Try again
              </button>
              <Link className={s.secondary} href="/login">
                Sign in
              </Link>
            </div>
          </div>
        )}
        {hasHistory && (
          <>
            <TransactionHistory coordinator={coordinator} />
            <PaymentHistory coordinator={coordinator} />
          </>
        )}
        <div className={s.settings}>
          <section
            className={s.section}
            id="profile"
            aria-labelledby="profile-title"
          >
            <div className={s.sectionHeader}>
              <div>
                <h2 id="profile-title">Your profile</h2>
                <p>Keep your contact details current.</p>
              </div>
            </div>
            <form
              className={s.body}
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError("");
                setMessage("");
                try {
                  await mutate(
                    "/api/v1/profile",
                    {
                      name: name ?? profile.data?.name,
                      brokerage: brokerage ?? profile.data?.brokerage,
                    },
                    "PATCH",
                  );
                  await profile.refresh();
                  setMessage("Your profile has been saved.");
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "Your profile could not be saved.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {profile.loading ? (
                <p className={s.loading} role="status">
                  Opening your profile…
                </p>
              ) : (
                profile.data && (
                  <>
                    <div className={s.formGrid}>
                      <label className={s.field}>
                        Your name
                        <input
                          className={s.input}
                          autoComplete="name"
                          value={name ?? profile.data.name}
                          onChange={(event) => setName(event.target.value)}
                          required
                        />
                      </label>
                      <label className={s.field}>
                        Brokerage
                        <input
                          className={s.input}
                          autoComplete="organization"
                          value={brokerage ?? profile.data.brokerage ?? ""}
                          onChange={(event) => setBrokerage(event.target.value)}
                        />
                      </label>
                    </div>
                    <p className={s.formHint}>{profile.data.email}</p>
                  </>
                )
              )}
              {(profile.error || error) && (
                <p className={s.error} role="alert">
                  {error || profile.error}
                </p>
              )}
              {message && (
                <p className={s.notice} role="status">
                  {message}
                </p>
              )}
              <div className={s.actions}>
                <button
                  className={s.button}
                  disabled={busy || profile.loading || !profile.data}
                >
                  {busy ? "Saving…" : "Save profile"}
                </button>
                {profile.error && (
                  <button
                    className={s.secondary}
                    type="button"
                    onClick={() => void profile.refresh()}
                  >
                    Reload profile
                  </button>
                )}
              </div>
            </form>
          </section>
          <section
            className={s.section}
            id="security"
            aria-labelledby="security-title"
          >
            <div className={s.sectionHeader}>
              <div>
                <h2 id="security-title">Account security</h2>
                <p>Manage your authenticator and reset your password.</p>
              </div>
            </div>
            <div className={s.body}>
              <p className={s.formHint}>
                Use an authenticator for an extra layer of account protection.
              </p>
              <div className={s.actions}>
                <Link className={s.secondary} href="/security">
                  Authenticator setup
                </Link>
                <Link className={s.secondary} href="/forgot-password">
                  Password recovery
                </Link>
              </div>
            </div>
          </section>
        </div>
        <p className={s.private}>
          <LockKeyhole size={12} aria-hidden="true" /> Only records your account
          is authorized to access appear here.
        </p>
      </div>
    </div>
  );
}
