"use client";
import { CreditCard } from "lucide-react";
import { useData, label } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import { Heading } from "../../_components/WorkspaceHeading";
import PaymentLink from "../../_components/PaymentLink";
import BillingOperations from "../../_components/BillingOperations";

export function Payments() {
  const catalog = useData<
    {
      code: string;
      name: string;
      priceCents: number;
      currency: string;
      approved: boolean;
    }[]
  >("/api/v1/billing/catalog");
  const q = useData<Record<string, unknown>[]>("/api/v1/billing/payments");
  return (
    <>
      <Heading
        eyebrow="Service fees"
        title="Payments & service levels"
        subtitle="View service prices and track payments."
      />
      <div className={s.cardGrid}>
        {catalog.loading
          ? [0, 1, 2].map((i) => <div key={i} className={s.skeleton} />)
          : catalog.data?.map((c) => (
              <section className={s.integrationCard} key={c.code}>
                <p className={s.eyebrow}>
                  {c.code === "full_listing"
                    ? "Seller side"
                    : "Buyer & seller side"}
                </p>
                <h3>{c.name}</h3>
                <p
                  style={{
                    fontFamily: "Georgia",
                    fontSize: 33,
                    color: "#69533b",
                    margin: "22px 0",
                  }}
                >
                  {c.approved
                    ? new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: c.currency || "USD",
                        maximumFractionDigits: 0,
                      }).format(c.priceCents / 100)
                    : c.code === "full_listing"
                      ? "Coming soon"
                      : "Confirm with Ireland"}
                </p>
                <p>
                  {c.code === "essentials"
                    ? "Contract-to-close coordination, communication and deadlines."
                    : c.code === "complete"
                      ? "Contract-to-close support with compliance."
                      : "Pre-listing paperwork and coordination through the final closing."}
                </p>
              </section>
            ))}
      </div>
      {catalog.error && <p className={s.error}>{catalog.error}</p>}
      <PaymentLink />
      <BillingOperations onChanged={q.refresh} />
      <section className={s.section} style={{ marginTop: 28 }}>
        <div className={s.sectionHead}>
          <div>
            <h2>Payment activity</h2>
            <p>
              Connect Ireland’s own Stripe account before payment processing.
              Payment links and final status are verified by Stripe.
            </p>
          </div>
          <CreditCard size={18} strokeWidth={1.2} />
        </div>
        {q.error ? (
          <div className={s.sectionBody}>
            <div className={s.notice}>
              {q.error} Payment processing becomes available once Stripe is
              configured.
            </div>
          </div>
        ) : q.loading ? (
          <div className={s.loading}>Loading payments…</div>
        ) : q.data?.length ? (
          <table className={s.table}>
            <thead>
              <tr>
                <th>Payment</th>
                <th>Status</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((p, i) => (
                <tr key={String(p.id || i)}>
                  <td>{String(p.description || p.kind || p.id)}</td>
                  <td>
                    <span className={s.pill}>
                      {label(String(p.status || "pending"))}
                    </span>
                  </td>
                  <td>
                    {typeof p.amountCents === "number"
                      ? new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: String(p.currency || "USD"),
                        }).format(p.amountCents / 100)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className={s.empty}>
            <CreditCard />
            Payment records will appear here.
            <br />
            Service fee timing and gift availability require Ireland’s
            confirmation.
          </div>
        )}
      </section>
    </>
  );
}
