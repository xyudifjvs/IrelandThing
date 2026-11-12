"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useLiveData } from "../../_components/useLiveData";
import { PortalBrand } from "../../(portal)/portal/_views/PortalBrand";
import { FeeObligations } from "./FeeObligations";
import { useFeeObligations } from "./useFeeObligations";
import { AccountProfile } from "./AccountProfile";
import { AccountSecurity } from "./AccountSecurity";
import { PaymentHistory, TransactionHistory } from "./AccountHistory";
import s from "./account.module.css";

type AccountUser = {
  id: string;
  name: string;
  role: string;
  business?: string;
  twoFactorEnabled?: boolean;
};

export default function Page() {
  const session = useLiveData<{ user: AccountUser }>(
    "/api/v1/session",
    undefined,
    true,
  );
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  return (
    <div className={`weatherly-theme ${s.page}`}>
      <header className={s.header}>
        <div className={s.headerInner}>
          <PortalBrand />
          {session.data?.user && (
            <Link
              className={s.back}
              href={
                session.data.user.role === "coordinator"
                  ? "/workspace"
                  : "/portal"
              }
            >
              <ArrowLeft size={13} aria-hidden="true" />
              {session.data.user.role === "coordinator"
                ? "Your workspace"
                : "Your portal"}
            </Link>
          )}
        </div>
      </header>
      <div className={s.main}>
        {session.loading && <p role="status">Opening your account…</p>}
        {!session.loading && !session.data?.user && (
          <>
            <h1>Your account</h1>
            <p role="alert">Sign in to open your account.</p>
            <Link className={s.button} href="/login">
              Sign in
            </Link>
          </>
        )}
        {session.data?.user && (
          <Account key={session.data.user.id} user={session.data.user} />
        )}
      </div>
    </div>
  );
}

function Account({ user }: { user: AccountUser }) {
  const coordinator = user.role === "coordinator";
  const agent = user.role === "agent";
  const hto = agent && user.business === "hto";
  const paymentAvailability = useLiveData<{ items: { kind: string }[] }>(
    hto ? "/api/v1/billing/account/payments?limit=1" : null,
    undefined,
    true,
  );
  const obligations = useFeeObligations(agent);
  const hasObligations = obligations.data.length > 0;
  const showPayments =
    coordinator ||
    (agent && (!hto || !!paymentAvailability.data?.items.length));
  return (
    <>
      <div className={s.intro}>
        <h1>Your account</h1>
      </div>
      <nav className={s.sectionNav} aria-label="Account sections">
        <a href="#profile">Profile</a>
        <a href="#security">Security</a>
        {(showPayments || hasObligations) && (
          <a href={hasObligations ? "#upcoming-payments" : "#payments"}>
            Payments
          </a>
        )}
        {(agent || coordinator) && (
          <a href="#transactions">Transaction history</a>
        )}
      </nav>
      <div className={s.settings}>
        <AccountProfile agent={agent} />
        <AccountSecurity twoFactorEnabled={user.twoFactorEnabled} />
      </div>
      {agent && <FeeObligations {...obligations} />}
      {showPayments && <PaymentHistory coordinator={coordinator} />}
      {(agent || coordinator) && (
        <TransactionHistory coordinator={coordinator} />
      )}
    </>
  );
}
