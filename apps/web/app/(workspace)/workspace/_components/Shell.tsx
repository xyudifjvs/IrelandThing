"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { WeatherlyBrand } from "../../../_components/WeatherlyBrand";
import RouteFocus from "./RouteFocus";
import { api, useData, type Session } from "./data";
import {
  workspaceAccountLinks,
  workspaceNavigation,
  type WorkspaceLink,
} from "./workspace-navigation";
import s from "./workspace.module.css";
import shell from "./workspace-shell.module.css";

function NavigationLink({
  href,
  label,
  pathname,
}: WorkspaceLink & { pathname: string }) {
  const current =
    pathname === href ||
    (href !== "/workspace" && pathname.startsWith(`${href}/`));
  return (
    <Link href={href} aria-current={current ? "page" : undefined}>
      {label}
    </Link>
  );
}

function WorkspaceLinks({ pathname }: { pathname: string }) {
  return workspaceNavigation.map(({ label, links }) => (
    <div className={shell.navGroup} key={label ?? links[0]?.href}>
      {label && <p className={shell.navLabel}>{label}</p>}
      {links.map((link) => (
        <NavigationLink key={link.href} {...link} pathname={pathname} />
      ))}
    </div>
  ));
}

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const session = useData<Session>("/api/v1/session");
  const user = session.data?.user;
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  async function signOut() {
    setSigningOut(true);
    setSignOutError("");
    try {
      await api("/api/auth/sign-out", { method: "POST", body: "{}" });
      window.location.href = "/login";
    } catch (error) {
      setSignOutError((error as Error).message);
      setSigningOut(false);
    }
  }

  if (!user || user.role !== "coordinator") {
    return (
      <main
        id="main-content"
        tabIndex={-1}
        className={`weatherly-theme ${shell.workspaceGate}`}
      >
        <div className={s.content}>
          <h1>
            {session.loading
              ? "Opening your workspace…"
              : "Ireland’s workspace"}
          </h1>
          {!session.loading && (
            <>
              <p>
                {user
                  ? "Your shared transactions are available in your portal."
                  : "Sign in to open the coordinator workspace."}
              </p>
              <Link href={user ? "/portal" : "/login"}>
                {user ? "Open your portal" : "Sign in"}
              </Link>
            </>
          )}
          {session.error && (
            <p role="alert">
              {session.error}{" "}
              <button onClick={() => void session.refresh()}>Retry</button>
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <div className={`weatherly-theme ${shell.shell}`}>
      <aside className={shell.sidebar}>
        <Link href="/" className={shell.brand} aria-label="Weatherly home">
          <WeatherlyBrand decorative />
        </Link>
        <nav className={shell.nav} aria-label="Workspace">
          <WorkspaceLinks pathname={pathname} />
        </nav>
        <div className={shell.bottom}>
          <div className={shell.mark}>
            <WeatherlyBrand variant="mark" decorative />
          </div>
          <nav aria-label="Account and support" className={shell.accountLinks}>
            {workspaceAccountLinks.map((link) => (
              <NavigationLink key={link.href} {...link} pathname={pathname} />
            ))}
          </nav>
          <div className={shell.user}>
            <span className={s.avatar} aria-hidden="true">
              {(user.name || "W").slice(0, 1)}
            </span>
            <div className={shell.userDetails}>
              <strong>{user.name || "Your workspace"}</strong>
              <small>Coordinator</small>
            </div>
            <button
              type="button"
              aria-label={signingOut ? "Signing out" : "Sign out"}
              title="Sign out"
              className={shell.signOut}
              disabled={signingOut}
              onClick={() => void signOut()}
            >
              <LogOut size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>
      <header className={shell.mobileHeader}>
        <Link href="/" className={shell.brand} aria-label="Weatherly home">
          <WeatherlyBrand decorative />
        </Link>
        <details
          className={shell.mobileMenu}
          key={pathname}
          onKeyDown={(event) => {
            if (event.key === "Escape" && event.currentTarget.open) {
              event.preventDefault();
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary>Menu</summary>
          <nav aria-label="Workspace and account">
            <WorkspaceLinks pathname={pathname} />
            <div className={shell.mobileAccountLinks}>
              {workspaceAccountLinks.map((link) => (
                <NavigationLink key={link.href} {...link} pathname={pathname} />
              ))}
              <Link href="/account">Your profile</Link>
              <button
                type="button"
                disabled={signingOut}
                onClick={() => void signOut()}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </nav>
        </details>
      </header>
      <main className={shell.main} id="main-content" tabIndex={-1}>
        <RouteFocus />
        <div className={s.content}>
          {signOutError && (
            <p className={s.error} role="alert">
              Could not sign out: {signOutError}{" "}
              <button className={s.buttonSmall} onClick={() => void signOut()}>
                Try again
              </button>
            </p>
          )}
          {process.env.NEXT_PUBLIC_APP_ENV === "local" && (
            <div className={s.localPreview}>Local preview · synthetic data</div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
