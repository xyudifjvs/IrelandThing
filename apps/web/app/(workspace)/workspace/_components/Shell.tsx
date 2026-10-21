"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  FolderOpen,
  Inbox,
  Settings2,
  CreditCard,
  Sparkles,
  ArrowUpRight,
  Bell,
  HelpCircle,
  Plus,
  LogOut,
} from "lucide-react";
import type { ReactNode } from "react";
import { api, useData, type Session } from "./data";
import s from "./workspace.module.css";
const nav = [
  { href: "/workspace", label: "Overview", icon: LayoutDashboard },
  { href: "/workspace/transactions", label: "Transactions", icon: FolderOpen },
  { href: "/workspace/inbox", label: "Inbox", icon: Inbox },
  { href: "/workspace/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/workspace/onboarding", label: "Onboarding", icon: HelpCircle },
  { href: "/workspace/review", label: "AI review", icon: Sparkles },
  { href: "/workspace/payments", label: "Payments", icon: CreditCard },
];
export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const session = useData<Session>("/api/v1/session");
  const user = session.data?.user;
  const current =
    nav.find((n) => n.href === pathname)?.label ||
    (pathname.includes("settings")
      ? "Settings"
      : pathname.includes("new")
        ? "New transaction"
        : "Transaction workspace");
  return (
    <div className={s.shell}>
      <aside className={s.sidebar}>
        <Link href="/" className={s.brand} aria-label="Weatherly home">
          <div className={s.brandTop}>WEATHERLY</div>
          <div className={s.brandSub}>TRANSACTION CO.</div>
        </Link>
        <nav className={s.nav} aria-label="Workspace">
          <div className={s.navLabel}>Your workspace</div>
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              title={n.label}
              className={
                pathname === n.href ||
                (n.href != "/workspace" && pathname.startsWith(n.href))
                  ? s.active
                  : ""
              }
            >
              <n.icon />
              {n.label}
            </Link>
          ))}
          <div className={s.navLabel}>Quick actions</div>
          <Link href="/workspace/new" title="New transaction">
            <Plus />
            New transaction
          </Link>
        </nav>
        <div className={s.bottom}>
          <Link
            href="/workspace/settings"
            className={pathname.includes("settings") ? s.active : ""}
          >
            <Settings2 />
            Settings
          </Link>
          <Link href="/portal">
            <ArrowUpRight />
            Agent & client portal
          </Link>
          <Link href="/contact">
            <HelpCircle />
            Contact & support
          </Link>
          <div className={s.user}>
            <div className={s.avatar}>{(user?.name || "W").slice(0, 1)}</div>
            <div>
              <strong>{user?.name || "Your workspace"}</strong>
              <small>{user?.role || "Secure access"}</small>
            </div>
            <button
              aria-label="Sign out"
              title="Sign out"
              className={s.buttonSmall}
              onClick={async () => {
                await api("/api/auth/sign-out", {
                  method: "POST",
                  body: "{}",
                  headers: { "Content-Type": "application/json" },
                });
                window.location.href = "/login";
              }}
            >
              <LogOut size={12} />
            </button>
          </div>
        </div>
      </aside>
      <main className={s.main}>
        <header className={s.topbar}>
          <div className={s.breadcrumb}>
            Workspace <span>/</span> <span>{current}</span>
          </div>
          <div className={s.topActions}>
            <span className={s.topDate}>
              {new Date().toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <Link href="/workspace/inbox" aria-label="Open inbox">
              <Bell />
            </Link>
            <span
              className={s.avatar}
              style={{ width: 28, height: 28, fontSize: 12 }}
            >
              {(user?.name || "W").slice(0, 1)}
            </span>
          </div>
        </header>
        <div className={s.content}>
          {process.env.NEXT_PUBLIC_APP_ENV === "local" && (
            <div className={s.localPreview}>Local preview · synthetic data</div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
