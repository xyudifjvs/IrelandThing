"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Mail,
  Link2,
  Sparkles,
  CreditCard,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { useData, mutate, label, date } from "../data";
import s from "../workspace.module.css";
import { Heading } from "../WorkspaceHeading";
import OperationsStatus from "../OperationsStatus";
import PrivateReminders from "../PrivateReminders";
import WorkflowTemplates from "../WorkflowTemplates";
import DotloopSettings from "../DotloopSettings";
import { Templates, GmailConnection } from "../CommunicationTools";
import type { Integration } from "../integration-summary";

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
        eyebrow="Workspace settings"
        title="Your settings"
        subtitle="Manage your profile, account security and connected services."
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
          Authenticator verification is optional.{" "}
          <Link href="/security">Set up your authenticator</Link> ·{" "}
          <Link href="/forgot-password">Password recovery</Link>
        </p>
      </div>
      <OperationsStatus />
      <PrivateReminders />
      <section id="connected-tools">
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
          <strong>File access & permissions</strong>
          <br />
          Private notes, client contact permissions and file access are enforced
          across your workspace and connected tools.
        </div>
      </div>
    </>
  );
}
