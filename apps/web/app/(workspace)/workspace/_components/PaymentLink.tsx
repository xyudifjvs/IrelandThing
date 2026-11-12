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
  const file = useData<{
    id: string;
    business: "hto" | "weatherly" | null;
    stage: string;
  }>(matter ? `/api/v1/matters/${encodeURIComponent(matter)}` : null);
  const selected = file.data?.id === matter ? file.data : null;
  const eligible =
    selected?.business !== "hto" &&
    Boolean(
      selected &&
      ["under_contract", "closing", "closed"].includes(selected.stage),
    );
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
          if (!ready || !eligible || !confirmed || busy) return;
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
              closingPaymentConfirmed: true,
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
          disabled={busy}
          onChange={(value) => {
            setMatter(value);
            setCheckoutKey(crypto.randomUUID());
            setConfirmed(false);
            setError("");
            setUrl("");
          }}
        />
        {file.error && (
          <p className={s.error} role="alert">
            {file.error}
          </p>
        )}
        {selected?.business === "hto" && (
          <p className={s.muted}>Home Team Ohio files have no service fee.</p>
        )}
        {eligible && (
          <label className={s.todo}>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I confirm that the service fee is due at closing for this
            transaction.
          </label>
        )}
        {selected?.business !== "hto" && !ready && (
          <div className={s.notice}>
            Connect Ireland’s own Stripe account before preparing payment links.
          </div>
        )}
        {error && (
          <div className={s.error} role="alert">
            {error}
          </div>
        )}
        {eligible && (
          <button className={s.button} disabled={!ready || !confirmed || busy}>
            {busy ? "Preparing secure checkout…" : "Create payment link"}
          </button>
        )}
        {eligible && url && (
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
