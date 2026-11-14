"use client";

import { useState } from "react";
import { Mail, Link2, RefreshCw } from "lucide-react";
import { api, useData, mutate } from "../../_components/data";
import s from "../../_components/workspace.module.css";

export function GmailConnection() {
  const integrations = useData<{ provider: string; status: string }[]>(
    "/api/v1/integrations",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const status = integrations.data?.find((i) => i.provider === "gmail")?.status;
  const available = status === "configured" || status === "connected";
  async function perform(action: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await mutate<{ url?: string; status?: string }>(
        `/api/v1/communications/${action}`,
        {},
      );
      if (action === "connect") {
        if (!result.url)
          throw new Error("Google authorization URL was not returned.");
        window.location.href = result.url;
      } else {
        setMessage(
          action === "disconnect"
            ? "Mailbox access has been disconnected."
            : "Mailbox sync request recorded.",
        );
        await integrations.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={s.section} style={{ marginTop: 25 }}>
      <div className={s.sectionHead}>
        <div>
          <h2>Your Gmail connection</h2>
          <p>Only an approved, authorized mailbox can sync or send.</p>
        </div>
        <Mail size={18} strokeWidth={1.3} />
      </div>
      <div className={s.sectionBody}>
        {!available && (
          <div className={s.notice}>
            Configure approved Google OAuth credentials and the real sending
            mailbox before connecting. The approved transaction mailbox is
            ireland@weatherlytc.com; account activation is still required.
          </div>
        )}
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className={s.notice} role="status">
            {message}
          </p>
        )}
        <div className={s.formRow}>
          {status !== "connected" ? (
            <button
              className={s.buttonSecondary}
              disabled={!available || busy}
              onClick={() => void perform("connect")}
            >
              <Link2 />
              Connect approved Gmail
            </button>
          ) : (
            <>
              <button
                className={s.buttonSecondary}
                disabled={busy}
                onClick={() => void perform("sync")}
              >
                <RefreshCw />
                Sync mailbox
              </button>
              <button
                className={s.buttonSecondary}
                disabled={busy}
                onClick={() => void perform("disconnect")}
              >
                Disconnect Gmail
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
