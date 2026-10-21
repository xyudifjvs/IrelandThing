"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import Link from "next/link";
import { api } from "@weatherly/ui";
import s from "./_components/portal.module.css";
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className={s.page}>
      <header className={s.header}>
        <Link className={s.brand} href="/">
          <span>WEATHERLY</span>
          <small>TRANSACTION CO.</small>
        </Link>
        <nav className={s.nav} aria-label="Portal navigation">
          <Link href="/portal">Your transactions</Link>
          <Link href="/account">Your profile</Link>
          <Link href="/contact">Contact Ireland</Link>
          <button
            onClick={async () => {
              await api("/api/auth/sign-out", { method: "POST", body: "{}" });
              window.location.href = "/login";
            }}
          >
            Sign out
          </button>
        </nav>
      </header>
      {children}
    </div>
  );
}
