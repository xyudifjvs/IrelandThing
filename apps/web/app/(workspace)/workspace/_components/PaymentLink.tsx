"use client";
import { useState } from "react";
import { CreditCard, ArrowUpRight } from "lucide-react";
import { useData, mutate } from "./data";
import s from "./workspace.module.css";
import MatterPicker from "./MatterPicker";
export default function PaymentLink() {
  const integrations = useData<{ provider: string; status: string }[]>(
    "/api/v1/integrations",
  );
  const [matter, setMatter] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [url, setUrl] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [checkoutKey, setCheckoutKey] = useState(() => crypto.randomUUID());
  const ready = integrations.data?.some(
    (i) =>
      i.provider === "stripe" && ["configured", "connected"].includes(i.status),
  );
  return (
    <section className={s.section} style={{ marginTop: 25 }}>
      <div className={s.sectionHead}>
        <div>
          <h2>Prepare a service payment link</h2>
          <p>
            Ireland decides when the service fee is due. No payment is charged
            by this action.
          </p>
        </div>
        <CreditCard size={18} strokeWidth={1.3} />
      </div>
      <form
        className={s.sectionBody}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setUrl("");
          try {
            const result = await mutate<{
              id: string;
              status: string;
              url?: string;
            }>("/api/v1/billing/checkout", {
              matterId: matter,
              kind: "service",
              idempotencyKey: checkoutKey,
            });
            if (!result.url)
              throw new Error(
                "A checkout URL was not returned. Review Stripe configuration before proceeding.",
              );
            setUrl(result.url);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <MatterPicker
          value={matter}
          required
          onChange={(value) => {
            setMatter(value);
            setCheckoutKey(crypto.randomUUID());
            setConfirmed(false);
            setUrl("");
          }}
        />
        <label className={s.todo}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I have confirmed with the agent that the service fee is due for this
          transaction.
        </label>
        {!ready && (
          <div className={s.notice}>
            Connect Ireland’s own Stripe account before preparing payment links.
            An existing personal Stripe account is not used.
          </div>
        )}
        {error && (
          <div className={s.error} role="alert">
            {error}
          </div>
        )}
        <button
          className={s.button}
          disabled={!ready || !matter || !confirmed || busy}
        >
          {busy ? "Preparing secure checkout…" : "Create payment link"}
        </button>
        {url && (
          <div className={s.notice} role="status">
            <strong>Payment link prepared.</strong>
            <p>
              Share this private link with the authorized payer through an
              approved communication channel. No email was sent.
            </p>
            <input
              className={s.input}
              readOnly
              value={url}
              aria-label="Private payment URL"
              onFocus={(e) => e.target.select()}
            />
            <a
              className={s.buttonSecondary}
              style={{ marginTop: 12 }}
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              Open checkout <ArrowUpRight size={12} />
            </a>
          </div>
        )}
      </form>
    </section>
  );
}
