"use client";
import { useState } from "react";
import Link from "next/link";
import {
  useData,
  mutate,
  type Session,
} from "../../(workspace)/workspace/_components/data";
import s from "../../(workspace)/workspace/_components/workspace.module.css";
export default function Page() {
  const q = useData<{ name: string; email: string; brokerage?: string }>(
    "/api/v1/profile",
  );
  const session = useData<Session>("/api/v1/session");
  const [name, setName] = useState<string | null>(null),
    [brokerage, setBrokerage] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  return (
    <main style={{ maxWidth: 850, margin: "auto", padding: "40px 25px" }}>
      <Link
        className={s.backLink}
        href={
          session.data?.user?.role === "coordinator" ? "/workspace" : "/portal"
        }
      >
        ← Your workspace
      </Link>
      <div className={s.heading}>
        <div>
          <p className={s.eyebrow}>Make yourself at home</p>
          <h1>Your account</h1>
          <p className={s.subtitle}>
            Keep your contact details up to date and your account protected.
          </p>
        </div>
      </div>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <h2>Your profile</h2>
        </div>
        <form
          className={s.sectionBody}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setMessage("");
            try {
              await mutate(
                "/api/v1/profile",
                {
                  name: name ?? q.data?.name,
                  brokerage: brokerage ?? q.data?.brokerage,
                },
                "PATCH",
              );
              await q.refresh();
              setMessage("Your profile has been saved.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {q.loading ? (
            <div className={s.loading}>Opening your profile…</div>
          ) : (
            <>
              <div className={s.formGrid}>
                <label className={s.field}>
                  Your name
                  <input
                    className={s.input}
                    value={name ?? q.data?.name ?? ""}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </label>
                <label className={s.field}>
                  Brokerage
                  <input
                    className={s.input}
                    value={brokerage ?? q.data?.brokerage ?? ""}
                    onChange={(e) => setBrokerage(e.target.value)}
                  />
                </label>
              </div>
              <p className={s.fieldHint}>{q.data?.email}</p>
            </>
          )}
          {(q.error || error) && (
            <p className={s.error} role="alert">
              {error || q.error}
            </p>
          )}
          {message && (
            <p className={s.notice} role="status">
              {message}
            </p>
          )}
          <button className={s.button} disabled={busy || q.loading || !q.data}>
            {busy ? "Saving…" : "Save profile"}
          </button>
        </form>
      </section>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <h2>Account security</h2>
            <p>A little extra protection for your private information.</p>
          </div>
        </div>
        <div className={s.sectionBody}>
          <div className={s.formRow}>
            <Link className={s.buttonSecondary} href="/security">
              Authenticator setup
            </Link>
            <Link className={s.buttonSecondary} href="/forgot-password">
              Password recovery
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
