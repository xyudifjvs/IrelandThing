"use client";
import { useState } from "react";
import RouteFocus from "../../(workspace)/workspace/_components/RouteFocus";
import type { ReactNode } from "react";
import Link from "next/link";
import { api } from "@weatherly/ui";
import s from "./_components/portal.module.css";
export default function Layout({ children }: { children: ReactNode }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className={s.page}>
      <header className={s.header}>
        <Link className={s.brand} href="/">
          <span>WEATHERLY</span>
          <small>TRANSACTION CO.</small>
        </Link>
        <nav className={s.nav} aria-label="Portal navigation">
          <Link href="/portal">Your transactions</Link>
          <Link href="/account">Your account</Link>
          <Link href="/contact">Contact Ireland</Link>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api("/api/auth/sign-out", { method: "POST", body: "{}" });
                window.location.href = "/login";
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            Sign out
          </button>
        </nav>
      </header>
      <main id="main-content" tabIndex={-1}>
        <RouteFocus />
        {error && (
          <p className={s.error} role="alert">
            Could not sign out: {error}
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
