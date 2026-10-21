"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Mail,
  Link2,
  Sparkles,
  CreditCard,
  ShieldCheck,
  ArrowUpRight,
  RefreshCw,
  FileText,
} from "lucide-react";
import {
  api,
  useData,
  mutate,
  label,
  date,
  address,
  type Matter,
  type Session,
} from "./data";
import s from "./workspace.module.css";
import ReviewQueue from "./ReviewQueue";
import PaymentLink from "./PaymentLink";
import BillingOperations from "./BillingOperations";
import WorkflowTemplates from "./WorkflowTemplates";
import DotloopSettings from "./DotloopSettings";
import EmailSuggestions from "./EmailSuggestions";
import {
  Composer,
  Templates,
  GmailConnection,
  MessageReview,
} from "./CommunicationTools";
type Integration = {
  provider: string;
  status: string;
  lastSyncedAt?: string;
  displayEmail?: string;
};
export function Settings() {
  const q = useData<Integration[]>("/api/v1/integrations");
  const profile = useData<{ name: string; email: string; brokerage?: string }>(
    "/api/v1/profile",
  );
  const [name, setName] = useState<string | null>(null);
  const [brokerage, setBrokerage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return (
    <>
      <Heading
        eyebrow="Make yourself at home"
        title="Your settings"
        subtitle="A thoughtful setup keeps everything running smoothly."
      />
      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <h2>Your profile</h2>
            <p>How you appear in your Weatherly workspace.</p>
          </div>
        </div>
        <form
          className={s.sectionBody}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setMessage("");
            try {
              await mutate(
                "/api/v1/profile",
                {
                  name: name ?? profile.data?.name,
                  brokerage: brokerage ?? profile.data?.brokerage,
                },
                "PATCH",
              );
              setMessage("Your profile has been saved.");
              await profile.refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {profile.error && <p className={s.error}>{profile.error}</p>}
          <div className={s.formGrid}>
            <label className={s.field}>
              Your name
              <input
                className={s.input}
                value={name ?? profile.data?.name ?? ""}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label className={s.field}>
              Brokerage
              <input
                className={s.input}
                value={brokerage ?? profile.data?.brokerage ?? ""}
                onChange={(e) => setBrokerage(e.target.value)}
              />
            </label>
          </div>
          <p className={s.fieldHint}>{profile.data?.email}</p>
          {message && (
            <p className={s.notice} role="status">
              {message}
            </p>
          )}
          {error && <p className={s.error}>{error}</p>}
          <button className={s.button} disabled={busy || profile.loading}>
            {busy ? "Saving…" : "Save profile"}
          </button>
        </form>
      </section>
      <div className={s.notice}>
        <strong>Account security</strong>
        <p>
          Authenticator verification protects coordinator access.{" "}
          <Link href="/security">Set up your authenticator</Link> ·{" "}
          <Link href="/forgot-password">Password recovery</Link>
        </p>
      </div>
      <section>
        <div className={s.sectionHead} style={{ paddingLeft: 0 }}>
          <div>
            <h2>Your connected tools</h2>
            <p>
              Provider access is verified before any data is synced or sent.
            </p>
          </div>
          <button className={s.buttonSmall} onClick={() => void q.refresh()}>
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>
        {q.error && <p className={s.error}>{q.error}</p>}
        {q.loading ? (
          <div className={s.loading}>Checking integrations…</div>
        ) : (
          <div className={s.cardGrid}>
            {["gmail", "dotloop", "openrouter", "stripe"].map((provider) => {
              const integration = q.data?.find((i) => i.provider === provider);
              const Icon =
                provider === "gmail"
                  ? Mail
                  : provider === "stripe"
                    ? CreditCard
                    : provider === "openrouter"
                      ? Sparkles
                      : Link2;
              return (
                <article className={s.integrationCard} key={provider}>
                  <Icon size={23} color="#9c8566" strokeWidth={1.25} />
                  <h3 style={{ marginTop: 20 }}>
                    {provider === "gmail"
                      ? "Gmail"
                      : provider === "dotloop"
                        ? "Dotloop"
                        : provider === "openrouter"
                          ? "Document AI"
                          : "Stripe"}
                  </h3>
                  <span
                    className={`${s.pill} ${integration?.status === "connected" ? s.pillGreen : ""}`}
                  >
                    {label(integration?.status || "not_configured")}
                  </span>
                  <p>
                    {integration?.displayEmail ||
                      (provider === "gmail"
                        ? "Mailbox approval and Google authorization are required. Placeholder: ireland@ireland.com."
                        : provider === "dotloop"
                          ? "Connect an approved account to retrieve transaction documents."
                          : provider === "openrouter"
                            ? "All AI uses the approved OpenRouter ZDR gateway."
                            : "Connect Ireland’s Stripe account to enable service and gift payments. No existing personal account is used.")}
                  </p>
                  {integration?.lastSyncedAt && (
                    <p>Last synced {date(integration.lastSyncedAt)}</p>
                  )}
                  <p className={s.fieldHint}>
                    Credentials and provider approval are managed in the server
                    environment. Contact the workspace administrator to
                    configure access.
                  </p>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <GmailConnection />
      <DotloopSettings />
      <Templates />
      <WorkflowTemplates />
      <div
        className={s.notice}
        style={{ marginTop: 24, display: "flex", gap: 13 }}
      >
        <ShieldCheck size={22} />
        <div>
          <strong>Private by design.</strong>
          <br />
          Private notes, client contact permissions and file access are enforced
          across your workspace and connected tools.
        </div>
      </div>
    </>
  );
}
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
        eyebrow="Clear, considered pricing"
        title="Payments & service levels"
        subtitle="A clear record of the support behind each transaction."
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
                    : "Confirm with Ireland"}
                </p>
                <p>
                  {c.code === "essentials"
                    ? "Contract-to-close coordination, communication and deadlines."
                    : c.code === "complete"
                      ? "Contract-to-close support with compliance and broker file coordination."
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
export function Inbox() {
  const integrations = useData<Integration[]>("/api/v1/integrations");
  const connected = integrations.data?.some(
    (i) => i.provider === "gmail" && i.status === "connected",
  );
  const q = useData<Record<string, unknown>[]>(
    connected ? "/api/v1/communications/messages" : null,
  );
  const [selected, setSelected] = useState<Record<string, unknown> | null>(
    null,
  );
  return (
    <>
      <Heading
        eyebrow="Good communication, all together"
        title="Your inbox"
        subtitle="Conversations for the people and properties you’re coordinating."
      />
      <div className={s.twoCol}>
        <section className={s.section}>
          <div className={s.sectionHead}>
            <div>
              <h2>Transaction conversations</h2>
              <p>
                Gmail sync respects your file access and contact permissions.
              </p>
            </div>
            <Mail size={18} strokeWidth={1.3} />
          </div>
          {integrations.loading ? (
            <div className={s.loading}>Checking your mailbox connection…</div>
          ) : !connected ? (
            <div className={s.sectionBody}>
              <div className={s.notice}>
                Gmail is not connected. The placeholder mailbox
                ireland@ireland.com is not an authorized sending account. No
                messages have been synced or sent.
              </div>
              <Link className={s.buttonSecondary} href="/workspace/settings">
                Review integration setup <ArrowUpRight size={12} />
              </Link>
            </div>
          ) : q.error ? (
            <div className={s.error}>{q.error}</div>
          ) : q.loading ? (
            <div className={s.loading}>Syncing conversations…</div>
          ) : q.data?.length ? (
            q.data.map((m, i) => (
              <button
                className={s.message}
                key={String(m.id || i)}
                onClick={() => setSelected(m)}
              >
                <div className={s.split}>
                  <strong>
                    {String(m.fromName || m.fromEmail || m.from || "Sender")}
                  </strong>
                  <small>
                    {date(
                      String(m.sentAt || m.receivedAt || m.createdAt || ""),
                    )}
                  </small>
                </div>
                <p>{String(m.subject || "(No subject)")}</p>
                <small>{String(m.snippet || "Open conversation")}</small>
              </button>
            ))
          ) : (
            <div className={s.empty}>
              <Mail />
              You’re all caught up.
              <br />
              Synced transaction conversations will appear here.
            </div>
          )}
        </section>
        <section className={s.section}>
          <div className={s.sectionHead}>
            <h2>{selected ? "Your conversation" : "A calmer inbox"}</h2>
          </div>
          <div className={s.sectionBody}>
            {selected ? (
              <>
                <h3 style={{ fontFamily: "Georgia", fontWeight: 400 }}>
                  {String(selected.subject)}
                </h3>
                <p className={s.fieldHint}>
                  From {String(selected.fromEmail || selected.from)}
                </p>
                <p
                  style={{
                    whiteSpace: "pre-wrap",
                    fontSize: 12,
                    lineHeight: 1.9,
                  }}
                >
                  {String(
                    selected.text ||
                      selected.bodyText ||
                      selected.snippet ||
                      "Message body unavailable.",
                  )}
                </p>
                <EmailSuggestions
                  key={"ai-" + String(selected.id)}
                  message={selected}
                />
                <MessageReview
                  key={String(selected.id)}
                  message={selected}
                  onChanged={() => {
                    void q.refresh();
                    setSelected(null);
                  }}
                />
              </>
            ) : (
              <p className={`${s.muted} ${s.tiny}`}>
                Select a conversation to read it here. Review all suggested
                changes before updating a transaction or contacting a client.
              </p>
            )}
          </div>
        </section>
      </div>
      <Composer />
    </>
  );
}
export function Review() {
  const matters = useData<Matter[]>("/api/v1/matters");
  const integrations = useData<Integration[]>("/api/v1/integrations");
  const [selected, setSelected] = useState("");
  const detail = useData<Matter>(
    selected ? `/api/v1/matters/${selected}` : null,
  );
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = integrations.data?.some(
    (i) =>
      i.provider === "openrouter" &&
      ["configured", "connected"].includes(i.status),
  );
  return (
    <>
      <Heading
        eyebrow="A second set of eyes"
        title="Document review"
        subtitle="Source-grounded assistance, with you in control of the final decision."
      />
      <div className={s.twoCol}>
        <section className={s.section}>
          <div className={s.sectionHead}>
            <div>
              <h2>From contract to clarity</h2>
              <p>
                Extract key fields and proposed dates from your transaction
                documents.
              </p>
            </div>
            <Sparkles size={19} strokeWidth={1.2} />
          </div>
          <div className={s.sectionBody}>
            <label className={s.field}>
              Choose a transaction
              <select
                className={s.select}
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setResult(null);
                }}
              >
                <option value="">Select a transaction</option>
                {matters.data?.map((m) => (
                  <option value={m.id} key={m.id}>
                    {address(m)}
                  </option>
                ))}
              </select>
            </label>
            {!ready && (
              <div className={s.notice} style={{ marginTop: 20 }}>
                Document AI is unavailable until an approved OpenRouter ZDR
                route is configured. Your files will not be sent to an alternate
                provider.
                <p>
                  <Link href="/workspace/settings">
                    Review connection requirements
                  </Link>
                </p>
              </div>
            )}
            {error && <div className={s.error}>{error}</div>}
            {selected && detail.loading ? (
              <div className={s.loading}>Loading documents…</div>
            ) : detail.data?.documents?.length ? (
              detail.data.documents.map((d) => (
                <div className={s.taskLine} key={d.id}>
                  <FileText size={17} />
                  <span style={{ flex: 1 }}>{d.name || d.filename}</span>
                  <button
                    className={s.buttonSmall}
                    disabled={!ready || busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        setResult(
                          await mutate<Record<string, unknown>>(
                            "/api/v1/ai/reviews",
                            { documentId: d.id, matterId: selected },
                          ),
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? "Queuing…" : "Request review"}
                  </button>
                </div>
              ))
            ) : selected ? (
              <div className={s.empty}>
                Upload a contract on this transaction before requesting review.
              </div>
            ) : null}
            {result && (
              <div className={s.notice} role="status">
                Review request recorded. Reference:{" "}
                {String(
                  result.id || result.jobId || "Pending worker processing",
                )}
                .
              </div>
            )}
          </div>
        </section>
        <section className={s.section}>
          <div className={s.sectionHead}>
            <h2>Your review checklist</h2>
          </div>
          <div className={s.sectionBody}>
            <p className={`${s.muted} ${s.tiny}`}>
              Confirm the source and amendment order.
              <br />
              <br />
              Check dates, parties and financial terms against the executed
              contract.
              <br />
              <br />
              Resolve uncertainty before saving proposed deadlines.
              <br />
              <br />
              Keep brokerage requirements and approved contract language in
              view.
            </p>
          </div>
        </section>
      </div>
      <ReviewQueue matterId={selected || undefined} />
    </>
  );
}
export function Heading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className={s.heading}>
      <div>
        <p className={s.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p className={s.subtitle}>{subtitle}</p>
      </div>
    </div>
  );
}
