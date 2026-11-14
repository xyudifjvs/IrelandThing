"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import RouteFocus from "../../(workspace)/workspace/_components/RouteFocus";
import Link from "next/link";
import { api } from "@weatherly/ui";
import { useLiveData } from "../../_components/useLiveData";
import { PortalBrand } from "./_views/PortalBrand";
import { ClientHeader } from "./_views/ClientFile";
import { PortalSessionContext } from "./_views/portal-session";
import s from "./_components/portal.module.css";

export default function Layout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/portal/intake")
    return (
      <>
        <RouteFocus />
        {children}
      </>
    );
  return <AuthenticatedPortal>{children}</AuthenticatedPortal>;
}

function AuthenticatedPortal({ children }: { children: ReactNode }) {
  const session = useLiveData<{
    user: { id: string; name: string; email: string; role: string };
  }>("/api/v1/session", undefined, true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const user = session.data?.user;
  const allowed = user?.role === "agent" || user?.role === "client";
  const signOut = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/sign-out", { method: "POST", body: "{}" });
      window.location.replace("/login");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not sign out.",
      );
      setBusy(false);
    }
  };
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  const actions = (
    <nav className={s.nav} aria-label="Portal navigation">
      <Link href="/account">Account</Link>
      <button disabled={busy} type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </nav>
  );
  return (
    <div className={`weatherly-theme ${s.page}`}>
      {user?.role === "agent" || !allowed ? (
        <header className={s.header}>
          <div className={s.headerInner}>
            <PortalBrand portalHome>
              <span className={s.headerLabel}>Agent portal</span>
            </PortalBrand>
            {allowed && actions}
          </div>
        </header>
      ) : (
        <ClientHeader>{actions}</ClientHeader>
      )}
      <main id="main-content" tabIndex={-1}>
        <RouteFocus />
        {error && (
          <p className={`${s.main} ${s.errorText}`} role="alert">
            {error}
          </p>
        )}
        {session.loading && (
          <div className={s.main} role="status">
            Opening your portal…
          </div>
        )}
        {!allowed && !session.loading && (
          <div className={s.main}>
            <h1>
              {user?.role === "coordinator"
                ? "Your coordinator account"
                : "Sign in to your portal"}
            </h1>
            <Link
              className={s.button}
              href={user?.role === "coordinator" ? "/workspace" : "/login"}
            >
              {user?.role === "coordinator" ? "Go to workspace" : "Sign in"}
            </Link>
          </div>
        )}
        {!busy && user && (user.role === "agent" || user.role === "client") && (
          <PortalSessionContext.Provider
            value={{ ...user, role: user.role }}
            key={user.id}
          >
            {children}
          </PortalSessionContext.Provider>
        )}
      </main>
    </div>
  );
}
