"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@weatherly/ui";
import { PortalBrand } from "./PortalBrand";
import s from "../_components/portal.module.css";

export function AgentPortalHeader() {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function signOut() {
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/sign-out", { method: "POST", body: "{}" });
      window.location.replace("/login");
    } catch {
      setError("Could not sign out. Please try again.");
      setBusy(false);
    }
  }
  const calendar = pathname === "/portal/calendar";
  const account = pathname === "/account";
  return (
    <header className={`${s.header} ${s.agentHeader}`}>
      <div className={s.headerInner}>
        <PortalBrand portalHome>
          <span className={s.headerLabel}>Agent portal</span>
        </PortalBrand>
        <nav
          className={`${s.nav} ${s.agentNav}`}
          aria-label="Portal navigation"
        >
          <Link
            href="/portal"
            aria-current={!calendar && !account ? "page" : undefined}
          >
            Files
          </Link>
          <Link
            href="/portal/calendar"
            aria-current={calendar ? "page" : undefined}
          >
            Calendar
          </Link>
          <span className={s.navDivider} aria-hidden="true" />
          <Link href="/account" aria-current={account ? "page" : undefined}>
            Account
          </Link>
          <button disabled={busy} type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </nav>
      </div>
      {error && (
        <p className={s.main} role="alert">
          {error}
        </p>
      )}
    </header>
  );
}
