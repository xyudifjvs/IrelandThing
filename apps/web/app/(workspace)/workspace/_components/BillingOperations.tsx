"use client";
import { useState } from "react";
import { useData, mutate, label, address, type Matter } from "./data";
import s from "./workspace.module.css";
type Payment = {
  id: string;
  matterId: string;
  kind: string;
  amountCents: number;
  currency: string;
  status: string;
  details?: { refundedCents?: number };
};
type Quote = {
  description: string;
  amountCents: number;
  currency: string;
  policy: string;
};
type Gift = {
  id: string;
  matterId: string;
  paymentOrderId?: string;
  revision: number;
  status: string;
  selection: {
    tier?: string;
    choice?: string;
    personalization?: string;
    deliveryAddress?: string;
    approvedQuote?: Quote;
  };
};
const money = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    cents / 100,
  );
export default function BillingOperations({
  onChanged,
}: {
  onChanged: () => Promise<void>;
}) {
  const gifts = useData<Gift[]>("/api/v1/billing/gifts");
  const payments = useData<Payment[]>("/api/v1/billing/payments");
  const matters = useData<Matter[]>("/api/v1/matters");
  const integrations = useData<{ provider: string; status: string }[]>(
    "/api/v1/integrations",
  );
  const ready =
    integrations.data?.some(
      (i) =>
        i.provider === "stripe" &&
        ["configured", "connected"].includes(i.status),
    ) || false;
  async function refresh() {
    await Promise.all([gifts.refresh(), payments.refresh(), onChanged()]);
  }
  const name = (id: string) => {
    const m = matters.data?.find((m) => m.id === id);
    return m ? address(m) : `Transaction ${id}`;
  };
  return (
    <>
      <section className={s.section} style={{ marginTop: 25 }}>
        <div className={s.sectionHead}>
          <div>
            <h2>Closing gifts</h2>
            <p>
              Approve a specific gift, its total price and terms before
              preparing payment. Record fulfillment after the gift is paid.
            </p>
          </div>
        </div>
        <div className={s.sectionBody}>
          {gifts.error && <p className={s.error}>{gifts.error}</p>}
          {gifts.loading ? (
            <p>Loading gift requests…</p>
          ) : !gifts.data?.length ? (
            <p className={s.muted}>
              Gift requests from transaction intake will appear here. No gift
              catalog or price is assumed.
            </p>
          ) : (
            gifts.data.map((g) => (
              <GiftCard
                key={`${g.id}:${g.revision}`}
                gift={g}
                payment={payments.data?.find((p) => p.id === g.paymentOrderId)}
                name={name(g.matterId)}
                ready={ready}
                refresh={refresh}
              />
            ))
          )}
        </div>
      </section>
      <section className={s.section} style={{ marginTop: 25 }}>
        <div className={s.sectionHead}>
          <div>
            <h2>Payment follow-up</h2>
            <p>
              Reconcile with Stripe or request a refund. Refund status changes
              only after verified Stripe evidence.
            </p>
          </div>
        </div>
        <div className={s.sectionBody}>
          {!ready && (
            <p className={s.notice}>
              Connect Ireland’s own Stripe account before payment follow-up
              becomes available.
            </p>
          )}
          {payments.error && <p className={s.error}>{payments.error}</p>}
          {!payments.data?.length && (
            <p className={s.muted}>No payments to follow up yet.</p>
          )}
          {payments.data?.map((p) => (
            <PaymentFollowUp
              key={p.id}
              payment={p}
              name={name(p.matterId)}
              ready={ready}
              refresh={refresh}
            />
          ))}
        </div>
      </section>
    </>
  );
}
function GiftCard({
  gift: g,
  payment,
  name,
  ready,
  refresh,
}: {
  gift: Gift;
  payment?: Payment;
  name: string;
  ready: boolean;
  refresh: () => Promise<void>;
}) {
  const quote = g.selection.approvedQuote;
  const [description, setDescription] = useState(quote?.description || "");
  const [amount, setAmount] = useState(
    quote ? (quote.amountCents / 100).toFixed(2) : "",
  );
  const [policy, setPolicy] = useState(quote?.policy || "");
  const [approved, setApproved] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [url, setUrl] = useState("");
  const [checkoutKey] = useState(() => crypto.randomUUID());
  const editable =
    ["requested", "awaiting_catalog", "quoted"].includes(g.status) &&
    !g.paymentOrderId;
  const paid = payment?.status === "paid" && !payment.details?.refundedCents;
  async function action(path: string, body: unknown, keep = false) {
    setBusy(true);
    setError("");
    try {
      const result = await mutate<{ url?: string }>(path, body);
      if (result.url) setUrl(result.url);
      if (!keep) await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={s.integrationCard} style={{ marginBottom: 18 }}>
      <h3>{name}</h3>
      <p>
        <span className={s.pill}>{label(g.status)}</span> ·{" "}
        {label(g.selection.tier || "Gift request")}
      </p>
      {g.selection.choice && <p>Requested gift: {g.selection.choice}</p>}
      {g.selection.personalization && (
        <p>Personalization: {g.selection.personalization}</p>
      )}
      {g.selection.deliveryAddress && (
        <p>Delivery: {g.selection.deliveryAddress}</p>
      )}
      {quote && (
        <div className={s.notice}>
          <strong>
            {quote.description} · {money(quote.amountCents, quote.currency)}
          </strong>
          <p>{quote.policy}</p>
        </div>
      )}
      {editable && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(`/api/v1/billing/gifts/${g.id}/quote`, {
              revision: g.revision,
              description,
              amountCents: Math.round(Number(amount) * 100),
              currency: "USD",
              policy,
              approved: true,
            });
          }}
        >
          <label className={s.field}>
            Specific gift and included delivery
            <input
              className={s.input}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className={s.field}>
            Total price (USD)
            <input
              className={s.input}
              type="number"
              min="0.50"
              max="10000"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className={s.field}>
            Delivery, cancellation and refund terms
            <textarea
              className={s.textarea}
              required
              minLength={10}
              value={policy}
              onChange={(e) => setPolicy(e.target.value)}
            />
          </label>
          <label className={s.todo}>
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            I have confirmed this specific gift, total and terms with the payer.
          </label>
          <button className={s.buttonSecondary} disabled={busy || !approved}>
            Save approved quote
          </button>
        </form>
      )}
      {quote && !g.paymentOrderId && (
        <button
          className={s.button}
          style={{ marginTop: 12 }}
          disabled={!ready || busy}
          onClick={() =>
            void action(
              "/api/v1/billing/checkout",
              {
                matterId: g.matterId,
                kind: "gift",
                giftOrderId: g.id,
                idempotencyKey: checkoutKey,
              },
              true,
            )
          }
        >
          Prepare gift payment link
        </button>
      )}
      {url && (
        <div className={s.notice}>
          <p>Private checkout prepared. Share through an approved channel.</p>
          <input
            className={s.input}
            readOnly
            aria-label="Gift payment URL"
            value={url}
            onFocus={(e) => e.target.select()}
          />
          <a href={url} target="_blank" rel="noreferrer">
            Open secure checkout
          </a>
          <button className={s.buttonSmall} onClick={() => void refresh()}>
            Refresh gift status
          </button>
        </div>
      )}
      {!["cancelled", "delivered"].includes(g.status) && (
        <div style={{ marginTop: 18 }}>
          <label className={s.field}>
            Fulfillment note
            <textarea
              className={s.textarea}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Record the actual order, delivery or cancellation details."
            />
          </label>
          <div className={s.formRow}>
            <button
              className={s.buttonSecondary}
              disabled={busy || !paid || g.status === "ordered" || !note.trim()}
              onClick={() =>
                void action(`/api/v1/billing/gifts/${g.id}/fulfill`, {
                  revision: g.revision,
                  status: "ordered",
                  note,
                })
              }
            >
              Record gift ordered
            </button>
            <button
              className={s.buttonSecondary}
              disabled={busy || !paid || g.status !== "ordered" || !note.trim()}
              onClick={() =>
                void action(`/api/v1/billing/gifts/${g.id}/fulfill`, {
                  revision: g.revision,
                  status: "delivered",
                  note,
                })
              }
            >
              Record delivery
            </button>
            <button
              className={s.buttonSmall}
              disabled={busy || !note.trim()}
              onClick={() =>
                void action(`/api/v1/billing/gifts/${g.id}/fulfill`, {
                  revision: g.revision,
                  status: "cancelled",
                  note,
                })
              }
            >
              Record cancellation
            </button>
          </div>
          <p className={s.fieldHint}>
            These controls record fulfillment; they do not order from a vendor.
            Cancellation does not request a refund.
          </p>
        </div>
      )}
      {!ready && quote && (
        <p className={s.fieldHint}>
          Payment links await Ireland’s own Stripe account configuration.
        </p>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
function PaymentFollowUp({
  payment: p,
  name,
  ready,
  refresh,
}: {
  payment: Payment;
  name: string;
  ready: boolean;
  refresh: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sent, setSent] = useState(false),
    [message, setMessage] = useState("");
  const remaining = Math.max(
    0,
    p.amountCents - (p.details?.refundedCents || 0),
  );
  async function request(refund: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await mutate(
        `/api/v1/billing/payments/${p.id}/${refund ? "refund" : "reconcile"}`,
        refund
          ? {
              amountCents: Math.round(Number(amount) * 100),
              reason,
              idempotencyKey: key,
              confirmed: true,
            }
          : {},
      );
      if (refund) setSent(true);
      setMessage(
        refund
          ? "Refund request recorded. Reconcile or wait for verified Stripe status before treating it as refunded."
          : "Stripe status reconciled.",
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={s.integrationCard} style={{ marginBottom: 18 }}>
      <h3>
        {name} · {label(p.kind)}
      </h3>
      <p>
        {money(p.amountCents, p.currency)} · {label(p.status)}
      </p>
      {!!p.details?.refundedCents && (
        <p>Verified refunded: {money(p.details.refundedCents, p.currency)}</p>
      )}
      <button
        className={s.buttonSecondary}
        disabled={!ready || busy}
        onClick={() => void request(false)}
      >
        Reconcile Stripe status
      </button>
      {["paid", "partially_refunded"].includes(p.status) && remaining > 0 && (
        <form
          style={{ marginTop: 18 }}
          onSubmit={(e) => {
            e.preventDefault();
            void request(true);
          }}
        >
          <label className={s.field}>
            Refund amount ({p.currency}; remaining{" "}
            {money(remaining, p.currency)})
            <input
              className={s.input}
              required
              type="number"
              min="0.01"
              max={remaining / 100}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={sent}
            />
          </label>
          <label className={s.field}>
            Reason
            <textarea
              className={s.textarea}
              required
              minLength={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={sent}
            />
          </label>
          <label className={s.todo}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={sent}
            />
            I approve requesting this refund from Ireland’s Stripe account.
          </label>
          <button
            className={s.button}
            disabled={!ready || busy || !confirmed || sent}
          >
            Request refund
          </button>
        </form>
      )}
      {message && (
        <p className={s.notice} role="status">
          {message}
        </p>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
